import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { analyzeKoreanImage, consolidateAnalyses, determinePageOrder } from './services/geminiService';
import type { AnalysisResult } from './types';
import ImageUploader from './components/ImageUploader';
import ResultsDisplay from './components/ResultsDisplay';
import Spinner from './components/Spinner';
import { 
    Plus, 
    RotateCcw, 
    Star, 
    ChevronUp, 
    ChevronDown, 
    Upload, 
    FileText as FileTextIcon, 
    ArrowUp, 
    ArrowDown, 
    RefreshCcw,
    Sparkles,
    Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';

interface AnalysisItem {
    id: string;
    image: string;
    file: File;
    result: AnalysisResult | null;
    loading: boolean;
    error: string | null;
}

interface ConsolidatedAnalysisItem {
    result: AnalysisResult | null;
    loading: boolean;
    error: string | null;
}

// Helper function to format the result data into a string for the TXT file
const formatResultForTxt = (result: AnalysisResult): string => {
    let content = '### 한국어 원문 ###\n\n';

    result.originalText.forEach(item => {
        content += item.type === 'title' 
            ? `# ${item.content}\n\n` 
            : `${item.content}\n\n`;
    });

    content += '\n---\n\n';
    content += '### 일본어 번역 ###\n\n';

    result.japaneseTranslation.forEach(item => {
        content += item.type === 'title' 
            ? `# ${item.content}\n\n` 
            : `${item.content}\n\n`;
    });

    content += '\n---\n\n';
    content += '### 어휘 분석 ###\n\n';

    result.vocabularyAnalysis.forEach(item => {
        content += `문장: "${item.sentence}"\n`;
        item.keywords.forEach(kw => {
            content += `  - ${kw.korean} (${kw.japanese}): ${kw.explanation}\n`;
        });
        content += '\n';
    });

    return content.trim();
};


const App: React.FC = () => {
    const [analysisItems, setAnalysisItems] = useState<AnalysisItem[]>([]);
    const [consolidatedItem, setConsolidatedItem] = useState<ConsolidatedAnalysisItem>({
        result: null,
        loading: false,
        error: null,
    });
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [isConsolidatedExpanded, setIsConsolidatedExpanded] = useState(false);
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isSorting, setIsSorting] = useState(false);
    const [hasBeenAutoSorted, setHasBeenAutoSorted] = useState(false);

    const triggerAnalysis = useCallback(async (itemId: string, imageDataUrl: string, mimeType: string) => {
        try {
            const base64Data = imageDataUrl.split(',')[1];
            if (!base64Data) {
                throw new Error('Invalid image data URL.');
            }
            const result = await analyzeKoreanImage(base64Data, mimeType);
            setAnalysisItems(prev =>
                prev.map(item =>
                    item.id === itemId
                        ? { ...item, result, loading: false }
                        : item
                )
            );
        } catch (e) {
            console.error(e);
            const errorMessage = e instanceof Error
                ? `분석에 실패했습니다. Gemini API 키를 확인하거나 다시 시도해 주세요. Error: ${e.message}`
                : '분석 중 알 수 없는 오류가 발생했습니다.';
            setAnalysisItems(prev =>
                prev.map(item =>
                    item.id === itemId
                        ? { ...item, error: errorMessage, loading: false }
                        : item
                )
            );
        }
    }, []);

    const handleImageUploads = useCallback((files: File[]) => {
        setGlobalError(null);
        setHasBeenAutoSorted(false); // Reset auto-sort flag for the new batch
        const fileReadPromises = files.map(file => {
            return new Promise<{ file: File, dataUrl: string }>((resolve, reject) => {
                if (!file.type.startsWith('image/')) {
                    reject(new Error(`'${file.name}'은(는) 이미지 파일이 아닙니다.`));
                    return;
                }
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve({ file, dataUrl: reader.result as string });
                };
                reader.onerror = () => {
                    reject(new Error(`'${file.name}' 파일을 읽는 데 실패했습니다.`));
                };
                reader.readAsDataURL(file);
            });
        });

        Promise.all(fileReadPromises)
            .then(results => {
                const newItems: AnalysisItem[] = results.map(({ file, dataUrl }) => ({
                    id: `${file.name}-${performance.now()}`,
                    image: dataUrl,
                    file: file,
                    result: null,
                    loading: true,
                    error: null,
                }));

                setAnalysisItems(prev => [...prev, ...newItems]);

                newItems.forEach(item => {
                    triggerAnalysis(item.id, item.image, item.file.type);
                });
            })
            .catch(err => {
                if (err instanceof Error) {
                    setGlobalError(err.message);
                } else {
                    setGlobalError('파일을 처리하는 중 알 수 없는 오류가 발생했습니다.');
                }
            });
    }, [triggerAnalysis]);


    const handleReset = () => {
        setAnalysisItems([]);
        setGlobalError(null);
        setConsolidatedItem({ result: null, loading: false, error: null });
        setExpandedItems(new Set());
        setHasBeenAutoSorted(false);
        setIsSorting(false);
    };

    const handleAddMoreClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleImageUploads(Array.from(e.target.files));
            e.target.value = ''; // Allow re-uploading same file(s)
        }
    };
    
    const successfulAnalyses = useMemo(() => analysisItems.filter(
        (item) => item.result && !item.loading && !item.error
    ), [analysisItems]);
    
    const pendingAnalysesCount = useMemo(() => analysisItems.filter(item => item.loading).length, [analysisItems]);

    // Auto-sorting effect
    useEffect(() => {
        if (pendingAnalysesCount === 0 && successfulAnalyses.length > 1 && !hasBeenAutoSorted && !isSorting) {
            const autoSort = async () => {
                setIsSorting(true);
                try {
                    const itemsToSort = analysisItems.filter(item => item.result);
                    if (itemsToSort.length <= 1) {
                         setHasBeenAutoSorted(true); // Not enough items to sort
                         setIsSorting(false);
                         return;
                    }
                    const resultsToSort = itemsToSort.map(item => item.result!);
                    
                    const newOrderIndices = await determinePageOrder(resultsToSort);

                    if (Array.isArray(newOrderIndices) && newOrderIndices.length === itemsToSort.length) {
                        const sortedItems = newOrderIndices.map(index => itemsToSort[index]);
                        const failedItems = analysisItems.filter(item => !item.result);
                        setAnalysisItems([...sortedItems, ...failedItems]);
                    } else {
                        console.warn("Auto-sorting returned an invalid order. Skipping.");
                    }
                } catch (e) {
                    console.error("Auto-sorting failed:", e);
                } finally {
                    setIsSorting(false);
                    setHasBeenAutoSorted(true);
                }
            };
            autoSort();
        }
    }, [pendingAnalysesCount, successfulAnalyses.length, hasBeenAutoSorted, isSorting, analysisItems]);

    const triggerConsolidation = useCallback(async () => {
        if (successfulAnalyses.length >= 2) {
            setConsolidatedItem({ result: null, loading: true, error: null });
            try {
                const resultsToConsolidate = successfulAnalyses.map(item => item.result!);
                const consolidatedData = await consolidateAnalyses(resultsToConsolidate);
                setConsolidatedItem({ result: consolidatedData, loading: false, error: null });
            } catch (e) {
                console.error(e);
                const errorMessage = e instanceof Error
                    ? `통합 분석에 실패했습니다. Error: ${e.message}`
                    : '통합 분석 중 알 수 없는 오류가 발생했습니다.';
                setConsolidatedItem({ result: null, loading: false, error: errorMessage });
            }
        } else if (successfulAnalyses.length === 1) {
            setConsolidatedItem({ result: successfulAnalyses[0].result, loading: false, error: null });
        } else {
            setConsolidatedItem({ result: null, loading: false, error: null });
        }
    }, [successfulAnalyses]);


    useEffect(() => {
        const handler = setTimeout(() => {
            if (!isSorting) { // Don't consolidate while auto-sorting is in progress
                triggerConsolidation();
            }
        }, 300);

        return () => {
            clearTimeout(handler);
        };
    }, [triggerConsolidation, isSorting]);
    
    const handleRefreshConsolidated = () => {
        triggerConsolidation();
    };


    const handleDragEvents = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (analysisItems.length > 0) {
            if (e.type === 'dragenter' || e.type === 'dragover') {
                setIsDragging(true);
            } else if (e.type === 'dragleave') {
                setIsDragging(false);
            }
        }
    }, [analysisItems.length]);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (analysisItems.length > 0) {
            setIsDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleImageUploads(Array.from(e.dataTransfer.files));
            }
        }
    }, [analysisItems.length, handleImageUploads]);

    const handleDownloadTxt = (result: AnalysisResult | null) => {
        if (!result) return;

        const fileContent = formatResultForTxt(result);
        const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const title = result.originalText.find(i => i.type === 'title')?.content || 'korean_analysis';
        // Sanitize the title to remove characters that are invalid in filenames, but keep Korean characters.
        a.download = `${title.replace(/[\\/:\*\?"<>\|]/g, '_')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleMoveItem = (currentIndex: number, direction: 'up' | 'down') => {
        setHasBeenAutoSorted(true); // User takes control, disable auto-sorting for this batch
        setAnalysisItems(prevItems => {
            const newItems = [...prevItems];
            const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

            if (targetIndex < 0 || targetIndex >= newItems.length) {
                return newItems;
            }

            [newItems[currentIndex], newItems[targetIndex]] = [newItems[targetIndex], newItems[currentIndex]];
            
            return newItems;
        });
    };

    const handleDeleteItemContent = (itemId: string, contentIndex: number) => {
        setAnalysisItems(prevItems => {
            return prevItems.map(item => {
                if (item.id === itemId && item.result) {
                    const newResult: AnalysisResult = JSON.parse(JSON.stringify(item.result));
                    const itemToDelete = newResult.originalText[contentIndex];

                    if (!itemToDelete) return item;

                    newResult.originalText = newResult.originalText.filter((_, i) => i !== contentIndex);

                    if (newResult.japaneseTranslation.length > contentIndex) {
                        newResult.japaneseTranslation = newResult.japaneseTranslation.filter((_, i) => i !== contentIndex);
                    }

                    if (itemToDelete.type === 'paragraph') {
                        newResult.vocabularyAnalysis = newResult.vocabularyAnalysis.filter(
                            vocabItem => !itemToDelete.content.includes(vocabItem.sentence)
                        );
                    }
                    
                    return { ...item, result: newResult };
                }
                return item;
            });
        });
    };

    const toggleItemExpansion = (itemId: string) => {
        setExpandedItems(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemId)) {
                newSet.delete(itemId);
            } else {
                newSet.add(itemId);
            }
            return newSet;
        });
    };


    const shouldShowConsolidatedCard = consolidatedItem.loading || consolidatedItem.result || consolidatedItem.error;

    return (
        <div 
            className="min-h-screen bg-[#0f172a] text-gray-100 flex flex-col items-center p-4 sm:p-8 relative selection:bg-blue-500/30 selection:text-blue-200"
            onDragEnter={handleDragEvents}
            onDragOver={handleDragEvents}
            onDragLeave={handleDragEvents}
            onDrop={handleDrop}
        >
            <AnimatePresence>
                {isDragging && analysisItems.length > 0 && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-blue-600/20 backdrop-blur-[6px] flex items-center justify-center z-[100] pointer-events-none"
                    >
                        <div className="text-center p-12 rounded-[2.5rem] bg-gray-900/80 border border-blue-500/30 shadow-2xl">
                            <Upload className="w-20 h-20 mx-auto mb-6 text-blue-400 animate-bounce" />
                            <p className="text-3xl font-black text-white tracking-tight">여기에 드롭하여 추가</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            
            <header className="w-full max-w-6xl flex flex-col items-center mb-16 mt-8">
                <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-3 mb-4"
                >
                    <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-900/40">
                        <Sparkles className="w-8 h-8 text-white fill-current" />
                    </div>
                </motion.div>
                <motion.h1 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-5xl sm:text-6xl font-black text-white tracking-tighter mb-4 text-center"
                >
                    이미지로 배우는 한국어
                </motion.h1>
                <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="text-lg sm:text-xl text-gray-400 font-medium text-center max-w-2xl"
                >
                    이미지 속 텍스트를 정밀하게 분석하고 번역하여 당신의 한국어 학습을 돕습니다.
                </motion.p>
            </header>

            <main className="w-full max-w-6xl mb-24">
                 {globalError && (
                    <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-red-500/10 border border-red-500/20 text-red-400 px-6 py-4 rounded-2xl mb-8 flex items-center gap-3 backdrop-blur-md"
                    >
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="font-semibold">{globalError}</span>
                    </motion.div>
                )}
                
                {analysisItems.length === 0 ? (
                    <ImageUploader onImageUpload={handleImageUploads} />
                ) : (
                    <div className="space-y-12">
                        <div className="flex flex-col md:flex-row justify-between items-end gap-6 border-b border-gray-800 pb-8">
                            <div className="space-y-1">
                                <h2 className="text-3xl font-black text-white">학습 리스트</h2>
                                <p className="text-gray-500 font-medium">총 {analysisItems.length}개의 항목이 준비되었습니다.</p>
                            </div>
                             <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/png, image/jpeg, image/webp"
                                multiple
                                onChange={handleFileInputChange}
                            />
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleAddMoreClick}
                                    className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-bold rounded-2xl text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20 transition-all active:scale-95"
                                >
                                    <Plus className="w-5 h-5 mr-2" />
                                    이미지 추가
                                </button>
                                <button
                                    onClick={handleReset}
                                    className="inline-flex items-center px-4 py-3 border border-gray-700 text-sm font-bold rounded-2xl text-gray-400 hover:text-white hover:bg-gray-800 transition-all active:scale-95"
                                >
                                    <RotateCcw className="w-5 h-5 mr-2" />
                                    초기화
                                </button>
                            </div>
                        </div>

                        <AnimatePresence>
                            {isSorting && (
                                <motion.div 
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="bg-blue-500/5 rounded-3xl border border-blue-500/20 p-6 flex items-center justify-center gap-4 text-blue-400"
                                >
                                    <RefreshCcw className="w-5 h-5 animate-spin" />
                                    <span className="font-bold">최적의 페이지 순서로 정리하는 중...</span>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="space-y-10">
                            {shouldShowConsolidatedCard && (
                                <motion.div 
                                    layout
                                    className="p-1 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-[2rem] shadow-2xl shadow-blue-900/20 overflow-hidden"
                                >
                                    <div className="bg-gray-900 rounded-[1.8rem] p-6 sm:p-8">
                                        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                                            <div className="flex items-center gap-5">
                                                <div className="p-4 bg-blue-600/10 rounded-2xl border border-blue-600/20">
                                                    <Star className="w-8 h-8 text-blue-400 fill-current" />
                                                </div>
                                                <div>
                                                    <h3 className="text-2xl font-black text-white tracking-tight">통합 학습 가이드</h3>
                                                    <p className="text-gray-500 font-medium">모든 페이지를 하나로 모은 종합 분석입니다.</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={handleRefreshConsolidated}
                                                    disabled={consolidatedItem.loading || successfulAnalyses.length < 2}
                                                    className="p-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl border border-gray-700 transition-all disabled:opacity-30 active:scale-95"
                                                    title="Refresh Analysis"
                                                >
                                                    <RefreshCcw className={cn("w-5 h-5", consolidatedItem.loading && "animate-spin")} />
                                                </button>
                                                <button
                                                    onClick={() => handleDownloadTxt(consolidatedItem.result)}
                                                    disabled={!consolidatedItem.result || consolidatedItem.loading}
                                                    className="inline-flex items-center px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all disabled:opacity-30 active:scale-95"
                                                >
                                                    <FileTextIcon className="w-5 h-5 mr-2" />
                                                    TXT 저장
                                                </button>
                                                <button
                                                    onClick={() => setIsConsolidatedExpanded(!isConsolidatedExpanded)}
                                                    className="p-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl border border-gray-700 transition-all active:scale-95"
                                                >
                                                    {isConsolidatedExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                                </button>
                                            </div>
                                        </div>
                                        <AnimatePresence>
                                            {isConsolidatedExpanded && (
                                                <motion.div 
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    className="mt-10 pt-10 border-t border-gray-800 overflow-hidden"
                                                >
                                                    {consolidatedItem.loading && (
                                                        <div className="py-20 flex flex-col items-center gap-4">
                                                            <Spinner />
                                                            <p className="text-gray-500 font-bold">인공지능이 통합 분석을 수행하고 있습니다...</p>
                                                        </div>
                                                    )}
                                                    {consolidatedItem.error && (
                                                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-6 rounded-2xl">
                                                            <p className="font-bold mb-2">분석 오류</p>
                                                            <p className="text-sm">{consolidatedItem.error}</p>
                                                        </div>
                                                    )}
                                                    {consolidatedItem.result && !consolidatedItem.loading && (
                                                        <ResultsDisplay result={consolidatedItem.result} isConsolidated={true} />
                                                    )}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </motion.div>
                            )}

                            {analysisItems.map((item, index) => {
                                const isExpanded = expandedItems.has(item.id);
                                return (
                                <motion.div 
                                    layout
                                    key={item.id} 
                                    className="bg-gray-800/20 rounded-[2rem] border border-gray-800 hover:border-gray-700 transition-colors px-6 py-6 sm:px-8 sm:py-8"
                                >
                                    <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                                        <div className="flex items-center gap-5 w-full">
                                            <div className="bg-gray-900 border border-gray-700 text-blue-400 font-black rounded-2xl w-12 h-12 flex items-center justify-center text-xl flex-shrink-0">
                                                {index + (shouldShowConsolidatedCard ? 2 : 1)}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <h3 className="text-xl font-bold text-white truncate max-w-xs md:max-w-md" title={item.file.name}>
                                                    {item.file.name}
                                                </h3>
                                                {item.loading ? (
                                                    <div className="flex items-center gap-2 text-blue-500 text-sm font-bold mt-1">
                                                        <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                                                        분석 중...
                                                    </div>
                                                ) : (
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-1">Ready</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 flex-shrink-0 ml-auto sm:ml-0">
                                            {analysisItems.length > 1 && (
                                                <div className="flex items-center bg-gray-900/50 p-1.5 rounded-2xl border border-gray-800">
                                                    <button
                                                        onClick={() => handleMoveItem(index, 'up')}
                                                        disabled={index === 0 || isSorting}
                                                        className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-20 transition-all rounded-xl"
                                                    >
                                                        <ArrowUp className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleMoveItem(index, 'down')}
                                                        disabled={index === analysisItems.length - 1 || isSorting}
                                                        className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-20 transition-all rounded-xl"
                                                    >
                                                        <ArrowDown className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            )}
                                            <button
                                                onClick={() => toggleItemExpansion(item.id)}
                                                className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-gray-300 font-bold text-sm rounded-xl border border-gray-700 transition-all active:scale-95"
                                            >
                                                {isExpanded ? '접기' : '결과 보기'}
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div 
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="mt-10 pt-10 border-t border-gray-800 overflow-hidden"
                                            >
                                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                                                    <div className="lg:col-span-4">
                                                        <div className="relative group rounded-3xl overflow-hidden border-4 border-gray-800 bg-black shadow-2xl transition-transform hover:scale-[1.02]">
                                                            <img 
                                                                src={item.image} 
                                                                alt={item.file.name} 
                                                                className="w-full h-auto max-h-[500px] object-contain" 
                                                            />
                                                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                                        </div>
                                                    </div>
                                                    <div className="lg:col-span-8">
                                                        {item.loading && (
                                                            <div className="flex flex-col items-center justify-center h-full py-20 gap-4">
                                                                <Spinner />
                                                                <p className="text-gray-500 font-bold tracking-tight">AI 텍스트 추출 중...</p>
                                                            </div>
                                                        )}
                                                        {item.error && (
                                                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-8 rounded-3xl h-full flex flex-col justify-center">
                                                                <p className="text-xl font-bold mb-4">분석할 수 없습니다</p>
                                                                <p className="opacity-80 leading-relaxed">{item.error}</p>
                                                            </div>
                                                        )}
                                                        {item.result && !item.loading && (
                                                            <ResultsDisplay 
                                                                result={item.result} 
                                                                isConsolidated={false}
                                                                onDeleteItemContent={(contentIndex) => handleDeleteItemContent(item.id, contentIndex)}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            )})}
                        </div>
                    </div>
                )}
            </main>

            <footer className="w-full max-w-6xl text-center py-12 border-t border-gray-900">
                <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-6">
                        <span className="text-xs font-bold text-gray-600 uppercase tracking-[0.3em] font-mono">Gemini AI Engine</span>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default App;