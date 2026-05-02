import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { analyzeKoreanImage, consolidateAnalyses, determinePageOrder } from './services/geminiService';
import type { AnalysisResult } from './types';
import ImageUploader from './components/ImageUploader';
import ResultsDisplay from './components/ResultsDisplay';
import Spinner from './components/Spinner';
import { PlusIcon, ResetIcon, StarIcon, ChevronUpIcon, ChevronDownIcon, UploadIcon, DocumentArrowDownIcon, ArrowUpIcon, ArrowDownIcon, ArrowPathIcon } from './components/icons';

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
            className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 sm:p-6 md:p-8 relative"
            onDragEnter={handleDragEvents}
            onDragOver={handleDragEvents}
            onDragLeave={handleDragEvents}
            onDrop={handleDrop}
        >
            {isDragging && analysisItems.length > 0 && (
                <div className="absolute inset-0 bg-blue-900/70 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-none border-4 border-dashed border-blue-400 rounded-lg">
                    <div className="text-center text-white">
                        <UploadIcon className="w-24 h-24 mx-auto mb-4" />
                        <p className="text-2xl font-bold">여기에 파일을 드롭하여 추가하세요</p>
                    </div>
                </div>
            )}
            
            <header className="w-full max-w-6xl text-center mb-8">
                <h1 className="text-4xl sm:text-5xl font-bold text-white">이미지로 배우는 한국어</h1>
                <p className="text-lg sm:text-xl text-gray-400 mt-2">
                    일본인 학습자를 위한 한국어 텍스트 분석기
                </p>
            </header>

            <main className="w-full max-w-6xl flex-grow">
                 {globalError && (
                    <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg mb-4" role="alert">
                        <strong className="font-bold">파일 오류!</strong>
                        <span className="block sm:inline ml-2">{globalError}</span>
                    </div>
                )}
                
                {analysisItems.length === 0 ? (
                    <ImageUploader onImageUpload={handleImageUploads} />
                ) : (
                    <div>
                        <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
                            <h2 className="text-3xl font-bold text-white">분석 결과</h2>
                             <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/png, image/jpeg, image/webp"
                                multiple
                                onChange={handleFileInputChange}
                            />
                            <div className="flex gap-4">
                                <button
                                    onClick={handleAddMoreClick}
                                    className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-900 transition-transform transform hover:scale-105"
                                >
                                    <PlusIcon className="w-5 h-5 mr-2" />
                                    이미지 추가
                                </button>
                                <button
                                    onClick={handleReset}
                                    className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-offset-gray-900 transition-transform transform hover:scale-105"
                                >
                                    <ResetIcon className="w-5 h-5 mr-2" />
                                    모두 지우기
                                </button>
                            </div>
                        </div>

                        {isSorting && (
                            <div className="text-center my-4 p-4 bg-gray-800/70 rounded-lg animate-pulse">
                                <p className="text-lg text-blue-300">콘텐츠 순서를 자동으로 정리하는 중...</p>
                            </div>
                        )}

                        <div className="space-y-12">
                            {shouldShowConsolidatedCard && (
                                <div className="p-4 sm:p-6 bg-gradient-to-br from-blue-900/70 to-gray-800/50 rounded-2xl shadow-2xl border-2 border-blue-500">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <StarIcon className="w-8 h-8 text-yellow-400 flex-shrink-0" />
                                            <div>
                                                <h3 className="text-2xl font-bold text-white">페이지 1</h3>
                                                <p className="text-sm text-gray-300">
                                                    {consolidatedItem.loading ? '통합 중...' : '전체 통합본'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={handleRefreshConsolidated}
                                                disabled={consolidatedItem.loading || successfulAnalyses.length < 2}
                                                className="inline-flex items-center px-3 py-1.5 border border-gray-600 text-sm font-medium rounded-md shadow-sm text-gray-300 bg-gray-800 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                aria-label="Refresh consolidated view"
                                            >
                                                <ArrowPathIcon className="w-4 h-4 mr-2" />
                                                새로고침
                                            </button>
                                            <button
                                                onClick={() => handleDownloadTxt(consolidatedItem.result)}
                                                disabled={!consolidatedItem.result || consolidatedItem.loading}
                                                className="inline-flex items-center px-3 py-1.5 border border-gray-600 text-sm font-medium rounded-md shadow-sm text-gray-300 bg-gray-800 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                aria-label="Download analysis as TXT"
                                            >
                                                <DocumentArrowDownIcon className="w-4 h-4 mr-2" />
                                                TXT 다운로드
                                            </button>
                                            <button
                                                onClick={() => setIsConsolidatedExpanded(!isConsolidatedExpanded)}
                                                className="inline-flex items-center px-3 py-1.5 border border-gray-600 text-sm font-medium rounded-md shadow-sm text-gray-300 bg-gray-800 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-900 transition-all"
                                                aria-expanded={isConsolidatedExpanded}
                                            >
                                                {isConsolidatedExpanded ? (
                                                    <>
                                                        <ChevronUpIcon className="w-4 h-4 mr-2" />
                                                        접기
                                                    </>
                                                ) : (
                                                    <>
                                                        <ChevronDownIcon className="w-4 h-4 mr-2" />
                                                        펼치기
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                    {isConsolidatedExpanded && (
                                        <div className="mt-6 animate-fade-in">
                                            {consolidatedItem.loading && <Spinner />}
                                            {consolidatedItem.error && (
                                                <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg h-full flex flex-col justify-center" role="alert">
                                                    <strong className="font-bold">통합 분석 오류!</strong>
                                                    <span className="block mt-1">{consolidatedItem.error}</span>
                                                </div>
                                            )}
                                            {consolidatedItem.result && !consolidatedItem.loading && <ResultsDisplay result={consolidatedItem.result} isConsolidated={true} />}
                                        </div>
                                    )}
                                </div>
                            )}

                            {analysisItems.map((item, index) => {
                                const isExpanded = expandedItems.has(item.id);
                                return (
                                <div key={item.id} className="p-4 sm:p-6 bg-gray-800/50 rounded-2xl shadow-xl border border-gray-700">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <div className="bg-black/50 text-white font-bold rounded-full w-8 h-8 flex items-center justify-center text-lg flex-shrink-0">
                                                {index + (shouldShowConsolidatedCard ? 2 : 1)}
                                            </div>
                                            <div className="overflow-hidden">
                                                <h3 className="text-xl font-bold text-white truncate" title={item.file.name}>{item.file.name}</h3>
                                                {item.loading && <p className="text-sm text-gray-300">분석 중...</p>}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {analysisItems.length > 1 && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleMoveItem(index, 'up')}
                                                        disabled={index === 0 || isSorting}
                                                        className="p-1.5 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                        aria-label="Move item up"
                                                    >
                                                        <ArrowUpIcon className="w-4 h-4 text-gray-300" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleMoveItem(index, 'down')}
                                                        disabled={index === analysisItems.length - 1 || isSorting}
                                                        className="p-1.5 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                                        aria-label="Move item down"
                                                    >
                                                        <ArrowDownIcon className="w-4 h-4 text-gray-300" />
                                                    </button>
                                                </div>
                                            )}
                                            <button
                                                onClick={() => toggleItemExpansion(item.id)}
                                                className="inline-flex items-center px-3 py-1.5 border border-gray-600 text-sm font-medium rounded-md shadow-sm text-gray-300 bg-gray-800 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-900 transition-all"
                                                aria-expanded={isExpanded}
                                            >
                                                {isExpanded ? (
                                                    <>
                                                        <ChevronUpIcon className="w-4 h-4 mr-2" />
                                                        접기
                                                    </>
                                                ) : (
                                                    <>
                                                        <ChevronDownIcon className="w-4 h-4 mr-2" />
                                                        펼치기
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {isExpanded && (
                                        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
                                            <div className="lg:col-span-1 flex flex-col items-center">
                                                <div className="relative w-full aspect-w-1 aspect-h-1 rounded-lg overflow-hidden shadow-lg border-2 border-gray-700 bg-black/20">
                                                    <img src={item.image} alt={item.file.name} className="w-full h-full object-contain" />
                                                </div>
                                            </div>
                                            <div className="lg:col-span-2">
                                                {item.loading && <Spinner />}
                                                {item.error && (
                                                    <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg h-full flex flex-col justify-center" role="alert">
                                                        <strong className="font-bold">오류 발생!</strong>
                                                        <span className="block mt-1">{item.error}</span>
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
                                    )}
                                </div>
                            )})}
                        </div>
                    </div>
                )}
            </main>

            <footer className="w-full max-w-6xl text-center mt-12 py-4 border-t border-gray-700">
                <p className="text-gray-500">Powered by Gemini API</p>
            </footer>
        </div>
    );
};

export default App;