
import React, { useCallback, useState } from 'react';
import { UploadIcon } from './icons';

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
        <div className="w-full max-w-3xl mx-auto flex flex-col items-center justify-center bg-gray-800 p-8 rounded-2xl shadow-2xl border-2 border-dashed border-gray-600">
            <div
                className={`w-full p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-all duration-300 ${isDragging ? 'border-blue-400 bg-gray-700 scale-105' : 'border-gray-500'}`}
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
                <div className="flex flex-col items-center text-gray-400">
                    <UploadIcon className="w-16 h-16 mb-4 text-gray-500" />
                    <p className="text-xl font-semibold text-gray-300">이미지 파일들을 여기로 드래그 앤 드롭</p>
                    <p className="mt-2">또는</p>
                    <button
                        type="button"
                        className="mt-4 px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors duration-200"
                    >
                        파일들 선택하기
                    </button>
                     <p className="mt-4 text-sm text-gray-500">PNG, JPG, WEBP 지원</p>
                </div>
            </div>
        </div>
    );
};

export default ImageUploader;
