
import React from 'react';
import { DownloadIcon, EyeIcon } from './icons';

interface MeetingMinutesResultProps {
    htmlContent: string;
    className?: string;
}

const MeetingMinutesResult: React.FC<MeetingMinutesResultProps> = ({ htmlContent, className }) => {
    
    const getHtmlBlob = () => new Blob([htmlContent], { type: 'text/html;charset=utf-8' });

    const handleDownload = () => {
        const blob = getHtmlBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Generate filename with current date: Bien_ban_hop_DD-MM-YYYY.html
        const dateStr = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
        a.download = `Bien_ban_hop_${dateStr}.html`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handlePreview = () => {
        const blob = getHtmlBlob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    };

    return (
        <div className={`relative bg-gray-700/50 p-4 rounded-lg space-y-4 ${className || ''}`}>
            <div className="absolute top-2 right-2 flex space-x-2 z-10">
                <button
                    onClick={handlePreview}
                    className="p-1.5 bg-gray-600 rounded-md hover:bg-gray-500 text-gray-300 hover:text-white transition"
                    title="Preview in new tab"
                    aria-label="Preview in new tab"
                >
                    <EyeIcon className="w-5 h-5" />
                </button>
                <button
                    onClick={handleDownload}
                    className="p-1.5 bg-gray-600 rounded-md hover:bg-gray-500 text-gray-300 hover:text-white transition"
                    title="Download as .html"
                    aria-label="Download as .html"
                >
                    <DownloadIcon className="w-5 h-5" />
                </button>
            </div>
            {/* Use h-full if className is provided to fill parent, otherwise default to fixed height */}
            <div className={`w-full bg-white rounded-md overflow-hidden ${className ? 'h-full' : 'h-72 sm:h-80'}`}>
                 <iframe
                    srcDoc={htmlContent}
                    title="Meeting Minutes Preview"
                    className="w-full h-full border-0"
                    sandbox="allow-scripts"
                />
            </div>
        </div>
    );
};

export default MeetingMinutesResult;
