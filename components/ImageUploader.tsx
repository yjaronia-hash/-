
import React, { useCallback, useState } from 'react';
import { Upload, Image as ImageIcon, FileWarning } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

interface ImageUploaderProps {
    onImageUpload: (files: File[]) => void;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageUpload }) => {
    const [isDragging, setIsDragging] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onImageUpload(Array.from(e.target.files));
        }
    };

    const handleDragEvents = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setIsDragging(true);
        } else if (e.type === 'dragleave') {
            setIsDragging(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onImageUpload(Array.from(e.dataTransfer.files));
        }
    }, [onImageUpload]);

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-3xl mx-auto"
        >
            <div
                className={cn(
                    "relative group flex flex-col items-center justify-center p-12 rounded-3xl transition-all duration-500 border-2 border-dashed overflow-hidden",
                    isDragging 
                        ? "border-blue-500 bg-blue-500/5 scale-[1.02]" 
                        : "border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800"
                )}
                onDragEnter={handleDragEvents}
                onDragOver={handleDragEvents}
                onDragLeave={handleDragEvents}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-upload')?.click()}
            >
                <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    accept="image/png, image/jpeg, image/webp"
                    onChange={handleFileChange}
                    multiple
                />
                
                <div className="relative z-10 flex flex-col items-center text-center">
                    <div className={cn(
                        "mb-6 p-6 rounded-2xl bg-gray-900/50 text-gray-400 transition-colors duration-300",
                        isDragging ? "text-blue-500 bg-blue-500/10" : "group-hover:text-gray-300"
                    )}>
                        <Upload className="w-12 h-12" />
                    </div>
                    
                    <h3 className="text-2xl font-bold text-white mb-2 font-sans">이미지를 업로드하세요</h3>
                    <p className="text-gray-400 mb-8 max-w-sm">
                        학습하고 싶은 한국어 이미지를 드래그하거나 클릭하여 추가하세요.
                    </p>
                    
                    <button
                        type="button"
                        className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-full hover:bg-blue-500 transition-all duration-300 shadow-lg shadow-blue-900/20 active:scale-95"
                    >
                        파일 선택하기
                    </button>
                    
                    <div className="mt-8 flex gap-6 text-gray-500 text-sm">
                        <div className="flex items-center gap-1.5">
                            <ImageIcon className="w-4 h-4" />
                            <span>PNG, JPG, WEBP</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <FileWarning className="w-4 h-4" />
                            <span>최대 10MB</span>
                        </div>
                    </div>
                </div>

                {/* Decorative backgrounds */}
                <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl" />
            </div>
        </motion.div>
    );
};

export default ImageUploader;
