
import React from 'react';

const Spinner: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center p-8 bg-gray-800/80 rounded-lg">
            <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent border-solid rounded-full animate-spin"></div>
            <p className="mt-4 text-lg font-semibold text-white">텍스트를 분석하는 중...</p>
            <p className="text-gray-400">잠시만 기다려 주세요.</p>
        </div>
    );
};

export default Spinner;
