import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AnalysisResult, VocabularyItem, FormattedTextItem } from '../types';
import { generateSpeech } from '../services/geminiService';
import { TextIcon, VocabIcon, TranslateIcon, ClipboardIcon, CheckIcon, SpeakerIcon, PlayIcon, PauseIcon, StopIcon, DownloadIcon, TrashIcon } from './icons';

interface ResultsDisplayProps {
    result: AnalysisResult;
    isConsolidated: boolean;
    onDeleteItemContent?: (index: number) => void;
}

type View = 'original' | 'vocabulary' | 'translation' | 'speech';
type Voice = 'female' | 'male';

// --- Audio Helper Functions ---
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeSingleAudioData(
  data: Uint8Array,
  ctx: AudioContext,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length;
  const buffer = ctx.createBuffer(1, frameCount, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}

function concatAudioBuffers(buffers: AudioBuffer[], ctx: AudioContext): AudioBuffer {
    if (buffers.length === 0) {
        return ctx.createBuffer(1, 1, 24000);
    }
    const totalLength = buffers.reduce((acc, buffer) => acc + buffer.length, 0);
    const result = ctx.createBuffer(1, totalLength, 24000);
    const channelData = result.getChannelData(0);
    let offset = 0;
    for (const buffer of buffers) {
        channelData.set(buffer.getChannelData(0), offset);
        offset += buffer.length;
    }
    return result;
}


function createWavBlob(audioBuffer: AudioBuffer): Blob {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const pcmData = audioBuffer.getChannelData(0); // Assuming mono
    const bitsPerSample = 16;
    
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    
    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length * 2, true); // ChunkSize
    writeString(view, 8, 'WAVE');
    
    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // ByteRate
    view.setUint16(32, numChannels * (bitsPerSample / 8), true); // BlockAlign
    view.setUint16(34, bitsPerSample, true);
    
    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.length * 2, true); // Subchunk2Size

    const pcmInt16 = new Int16Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
        pcmInt16[i] = Math.max(-1, Math.min(1, pcmData[i])) * 32767;
    }

    return new Blob([header, pcmInt16], { type: 'audio/wav' });
}


// --- Speech Player Component ---
const SpeechPlayer: React.FC<{ textItems: FormattedTextItem[] }> = ({ textItems }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [playbackState, setPlaybackState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [currentParaIndex, setCurrentParaIndex] = useState(-1);
    const [voice, setVoice] = useState<Voice>('female');
    const [speed, setSpeed] = useState(1.0);

    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const audioBufferRef = useRef<AudioBuffer | null>(null);
    const paragraphTimingsRef = useRef<{ start: number, end: number }[]>([]);
    
    const animationFrameRef = useRef<number>();
    const playbackOffsetRef = useRef(0);
    const playbackStartedAtRef = useRef(0);
    
    const paragraphs = useMemo(() => textItems.filter(item => item.type === 'paragraph'), [textItems]);

    const speedLevels = [
        { label: '느리게', value: 0.75 },
        { label: '조금 느리게', value: 0.9 },
        { label: '보통', value: 1.0 },
        { label: '조금 빠르게', value: 1.25 },
        { label: '빠르게', value: 1.5 },
    ];

    const stopPlayback = useCallback((resetTime = true) => {
        if (sourceNodeRef.current) {
            // FIX: The stop() method on AudioBufferSourceNode requires an argument in some environments. Passing 0 stops playback immediately.
            // FIX: Add argument to stop() to fix "Expected 1 arguments, but got 0." error.
            try { sourceNodeRef.current.stop(0); } catch (e) { /* already stopped */ }
            sourceNodeRef.current.disconnect();
            sourceNodeRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        setPlaybackState('stopped');
        setCurrentParaIndex(-1);
        if (resetTime) {
            setCurrentTime(0);
            playbackOffsetRef.current = 0;
        }
    }, []);

    const playAudio = useCallback((offset: number) => {
        if (!audioBufferRef.current || !audioContextRef.current) return;
        if (sourceNodeRef.current) {
            stopPlayback(false);
        }
        if(audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBufferRef.current;
        source.playbackRate.value = speed;
        source.connect(audioContextRef.current.destination);
        source.onended = () => {
            if (playbackState === 'playing') { // Reached end naturally
                stopPlayback(true);
            }
        };

        source.start(0, offset);
        sourceNodeRef.current = source;
        playbackStartedAtRef.current = audioContextRef.current.currentTime;
        setPlaybackState('playing');

        const tick = () => {
            if (sourceNodeRef.current && audioContextRef.current) {
                const elapsedTime = audioContextRef.current.currentTime - playbackStartedAtRef.current;
                const newCurrentTime = playbackOffsetRef.current + (elapsedTime * speed);
                setCurrentTime(newCurrentTime);

                const paraIndex = paragraphTimingsRef.current.findIndex(
                    p => newCurrentTime >= p.start && newCurrentTime < p.end
                );
                setCurrentParaIndex(paraIndex);

                if (newCurrentTime < duration) {
                    animationFrameRef.current = requestAnimationFrame(tick);
                }
            }
        };
        tick();

    }, [speed, stopPlayback, duration, playbackState]);
    
    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        return () => {
            stopPlayback();
            audioContextRef.current?.close();
        };
    }, [stopPlayback]);

    useEffect(() => {
        const prepareAudio = async () => {
            stopPlayback();
            setIsLoading(true);
            setError(null);
            setCurrentTime(0);
            setDuration(0);
            
            if (!audioContextRef.current || paragraphs.length === 0) {
                setIsLoading(false);
                return;
            };
            
            try {
                const audioDataPromises = paragraphs.map(p => generateSpeech(p.content, voice));
                const base64Audios = await Promise.all(audioDataPromises);

                const decodedAudioPromises = base64Audios.map(b64 => decodeSingleAudioData(decode(b64), audioContextRef.current!));
                const audioBuffers = await Promise.all(decodedAudioPromises);

                const timings: { start: number, end: number }[] = [];
                let currentOffset = 0;
                for (const buffer of audioBuffers) {
                    timings.push({ start: currentOffset, end: currentOffset + buffer.duration });
                    currentOffset += buffer.duration;
                }
                paragraphTimingsRef.current = timings;
                
                const concatenatedBuffer = concatAudioBuffers(audioBuffers, audioContextRef.current);
                audioBufferRef.current = concatenatedBuffer;
                setDuration(concatenatedBuffer.duration);

            } catch (e) {
                console.error("Error preparing audio:", e);
                setError('오디오를 준비하는 데 실패했습니다. API 키를 확인하거나 다시 시도해 주세요.');
            } finally {
                setIsLoading(false);
            }
        };

        prepareAudio();

    }, [paragraphs, voice, stopPlayback]);

    useEffect(() => {
        if (sourceNodeRef.current) {
            sourceNodeRef.current.playbackRate.value = speed;
        }
    }, [speed]);


    const handlePlayPause = useCallback(() => {
        if (isLoading || !audioBufferRef.current) return;
        
        if (playbackState === 'playing') {
            audioContextRef.current?.suspend();
            if (sourceNodeRef.current && audioContextRef.current) {
                 const elapsedTime = audioContextRef.current.currentTime - playbackStartedAtRef.current;
                 playbackOffsetRef.current += elapsedTime * speed;
            }
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            setPlaybackState('paused');
        } else { // paused or stopped
            if (currentTime >= duration) { // If at the end, restart
                playbackOffsetRef.current = 0;
            } else {
                playbackOffsetRef.current = currentTime;
            }
            playAudio(playbackOffsetRef.current);
        }
    }, [playbackState, isLoading, playAudio, currentTime, duration, speed]);

    const handleStopClick = useCallback(() => {
        stopPlayback(true);
    }, [stopPlayback]);

    const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newTime = parseFloat(event.target.value);
        setCurrentTime(newTime);
        playbackOffsetRef.current = newTime;
        if (playbackState === 'playing') {
            playAudio(newTime);
        } else if(playbackState === 'paused') {
            stopPlayback(false); // Stop but keep the time for next play
        }
    };
    
    const handleDownload = () => {
        if (!audioBufferRef.current || isLoading) return;
        try {
            const wavBlob = createWavBlob(audioBufferRef.current);
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.href = url;
            const title = textItems.find(i => i.type === 'title')?.content || 'korean_audio';
            a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.wav`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Download failed:', e);
            setError('다운로드에 실패했습니다.');
        }
    };

    const formatTime = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    if (isLoading) {
        return (
            <div className="bg-gray-800 p-6 rounded-b-lg relative flex flex-col items-center justify-center min-h-[300px]">
                 <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent border-solid rounded-full animate-spin"></div>
                 <p className="mt-4 text-lg text-white">오디오 생성 중...</p>
                 <p className="text-gray-400">잠시만 기다려 주세요.</p>
            </div>
        );
    }
    
    if (error) {
         return (
             <div className="bg-gray-800 p-6 rounded-b-lg relative flex flex-col items-center justify-center min-h-[300px]">
                <p className="text-center text-red-400">{error}</p>
            </div>
         );
    }

    return (
        <div className="bg-gray-800 p-6 rounded-b-lg relative">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">성우 선택</label>
                    <div className="flex rounded-md shadow-sm bg-gray-900/50 p-1">
                         <button onClick={() => setVoice('female')} className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${voice === 'female' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>여자 성우</button>
                         <button onClick={() => setVoice('male')} className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${voice === 'male' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>남자 성우</button>
                    </div>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">속도 조절</label>
                    <div className="flex rounded-md shadow-sm bg-gray-900/50 p-1">
                        {speedLevels.map(level => (
                             <button key={level.label} onClick={() => setSpeed(level.value)} className={`flex-1 px-2 py-2 text-xs font-medium rounded-md transition-colors ${speed === level.value ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>{level.label}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-4 mb-4">
                <span className="text-sm font-mono text-gray-400">{formatTime(currentTime)}</span>
                <input
                    type="range"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={currentTime}
                    onChange={handleSeek}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    disabled={isLoading || duration === 0}
                />
                <span className="text-sm font-mono text-gray-400">{formatTime(duration)}</span>
            </div>

            <div className="flex items-center justify-center gap-4 mb-6">
                 <button onClick={handlePlayPause} disabled={isLoading || duration === 0} className="p-3 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all transform hover:scale-110" aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}>
                    {playbackState === 'playing' ? <PauseIcon className="w-8 h-8"/> : <PlayIcon className="w-8 h-8"/>}
                </button>
                <button onClick={handleStopClick} disabled={playbackState === 'stopped'} className="p-3 rounded-full bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-600 transition-all transform hover:scale-110" aria-label="Stop">
                    <StopIcon className="w-8 h-8"/>
                </button>
                 <button onClick={handleDownload} disabled={isLoading || duration === 0} className="p-3 rounded-full bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all transform hover:scale-110" aria-label="Download audio">
                    <DownloadIcon className="w-8 h-8"/>
                </button>
            </div>
            
            <div className="prose prose-invert prose-lg max-w-none space-y-4 max-h-[40vh] overflow-y-auto pr-2">
                 {textItems.map((item, index) => {
                    const isPara = item.type === 'paragraph';
                    const paraIndex = isPara ? paragraphs.findIndex(p => p.content === item.content) : -1;
                    const isCurrent = paraIndex !== -1 && paraIndex === currentParaIndex;

                    if (item.type === 'title') {
                        return <h2 key={index} className="text-3xl font-bold mb-6 text-blue-300 !mt-0">{item.content}</h2>;
                    }
                    return <p key={index} className={`transition-all duration-300 p-2 rounded-md ${isCurrent ? 'bg-blue-900/50 ring-2 ring-blue-500' : ''}`} style={{ lineHeight: '1.8' }}>{item.content}</p>;
                })}
            </div>
        </div>
    );
};


// --- Main Display Component ---
const formatVocabularyForCopy = (vocabAnalysis: VocabularyItem[]): string => {
    return vocabAnalysis.map(item => {
        const keywordsText = item.keywords.map(kw => 
            `  - ${kw.korean} (${kw.japanese}): ${kw.explanation}`
        ).join('\n');
        return `문장: "${item.sentence}"\n${keywordsText}`;
    }).join('\n\n');
};

const formatOriginalTextForCopy = (formattedText: FormattedTextItem[]): string => {
    return formattedText.map(item => {
        if(item.type === 'title') return `# ${item.content}`;
        return item.content;
    }).join('\n\n');
};

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ result, isConsolidated, onDeleteItemContent }) => {
    const [activeView, setActiveView] = useState<View>('vocabulary');
    const [copiedView, setCopiedView] = useState<View | 'speech' | null>(null);

    const handleCopy = (content: string, view: View) => {
        if (!navigator.clipboard) {
            console.error("Clipboard API not available");
            return;
        }
        navigator.clipboard.writeText(content).then(() => {
            setCopiedView(view);
            setTimeout(() => setCopiedView(null), 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    };

    const CopyButton = ({ content, view }: { content: string; view: View }) => (
        <button
            onClick={() => handleCopy(content, view)}
            className="absolute top-3 right-3 p-2 bg-gray-700/50 hover:bg-gray-600/50 rounded-full text-gray-300 hover:text-white transition-all duration-200"
            aria-label="Copy content"
        >
            {copiedView === view ? (
                <CheckIcon className="w-5 h-5 text-green-400" />
            ) : (
                <ClipboardIcon className="w-5 h-5" />
            )}
        </button>
    );

    const renderContent = () => {
        switch (activeView) {
            case 'original':
                return (
                    <div className="prose prose-invert prose-lg max-w-none bg-gray-800 p-6 rounded-b-lg relative">
                        <CopyButton content={formatOriginalTextForCopy(result.originalText)} view="original" />
                        {result.originalText.map((item, index) => (
                            <div key={index} className="group relative pr-10">
                                {item.type === 'title' ? (
                                    <h2 className="text-3xl font-bold mb-6 text-blue-300 !mt-0">{item.content}</h2>
                                ) : (
                                    <p className="mb-4" style={{ lineHeight: '1.8' }}>{item.content}</p>
                                )}
                                {!isConsolidated && onDeleteItemContent && (
                                    <button
                                        onClick={() => onDeleteItemContent(index)}
                                        className="absolute top-0 right-0 p-2 bg-red-800/50 hover:bg-red-700/80 rounded-full text-red-300 hover:text-white transition-all duration-200 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        aria-label="Delete this item"
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                );
            case 'vocabulary':
                return (
                    <div className="space-y-6 bg-gray-800 p-6 rounded-b-lg relative">
                        <CopyButton content={formatVocabularyForCopy(result.vocabularyAnalysis)} view="vocabulary" />
                        {result.vocabularyAnalysis.map((item, index) => (
                            <div key={index} className="bg-gray-900/50 p-5 rounded-lg border border-gray-700 shadow-md">
                                <p className="text-lg font-semibold text-blue-300 mb-4 pb-2 border-b border-gray-600">
                                    "{item.sentence}"
                                </p>
                                <ul className="space-y-3">
                                    {item.keywords.map((keyword, kwIndex) => (
                                        <li key={kwIndex} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start">
                                           <div className="md:col-span-1 font-bold text-lg text-white">{keyword.korean}</div>
                                           <div className="md:col-span-2 text-gray-300">
                                                <span className="text-green-300">{keyword.japanese}</span>
                                                <p className="text-sm text-gray-400 mt-1">{keyword.explanation}</p>
                                           </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                );
            case 'translation':
                return (
                    <div className="prose prose-invert prose-lg max-w-none bg-gray-800 p-6 rounded-b-lg relative">
                        <CopyButton content={formatOriginalTextForCopy(result.japaneseTranslation)} view="translation" />
                        {result.japaneseTranslation.map((item, index) => {
                            if (item.type === 'title') {
                                return <h2 key={index} className="text-3xl font-bold mb-6 text-blue-300 !mt-0">{item.content}</h2>;
                            }
                            return <p key={index} className="mb-4" style={{ lineHeight: '1.8' }}>{item.content}</p>;
                        })}
                    </div>
                );
            case 'speech':
                return <SpeechPlayer textItems={result.originalText} />;
            default:
                return null;
        }
    };

    const TabButton: React.FC<{ view: View; label: string; icon: React.ReactNode }> = ({ view, label, icon }) => {
        const isActive = activeView === view;
        return (
            <button
                onClick={() => setActiveView(view)}
                className={`flex-1 inline-flex items-center justify-center px-4 py-3 text-sm sm:text-base font-medium transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500
                    ${isActive
                        ? 'bg-blue-600 text-white rounded-t-lg'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600 first:rounded-tl-lg last:rounded-tr-lg'
                    }`}
            >
                {icon}
                <span className="ml-2">{label}</span>
            </button>
        );
    };

    return (
        <div className="w-full">
            <div className="flex">
                <TabButton view="vocabulary" label="어휘 분석" icon={<VocabIcon className="w-5 h-5"/>} />
                <TabButton view="original" label="한국어 원문" icon={<TextIcon className="w-5 h-5"/>} />
                <TabButton view="speech" label="읽어보기" icon={<SpeakerIcon className="w-5 h-5"/>} />
                <TabButton view="translation" label="일본어 번역" icon={<TranslateIcon className="w-5 h-5"/>} />
            </div>
            <div className="animate-fade-in">{renderContent()}</div>
        </div>
    );
};

export default ResultsDisplay;