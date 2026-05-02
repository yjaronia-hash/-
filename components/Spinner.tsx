import React from 'react';
import { motion } from 'framer-motion';

const Spinner: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center p-12 bg-gray-900/50 backdrop-blur-sm rounded-[2rem] border border-gray-800">
            <div className="relative">
                <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="w-16 h-16 border-4 border-blue-500 border-t-transparent border-solid rounded-full"
                />
                <motion.div 
                    animate={{ rotate: -360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                    className="absolute inset-2 border-4 border-indigo-500 border-b-transparent border-solid rounded-full opacity-50"
                />
            </div>
            <div className="mt-8 text-center">
                <p className="text-xl font-black text-white tracking-tight">분석 진행 중</p>
                <p className="text-gray-500 font-medium mt-1">인공지능이 정밀하게 텍스트를 파악하고 있습니다.</p>
            </div>
        </div>
    );
};

export default Spinner;
