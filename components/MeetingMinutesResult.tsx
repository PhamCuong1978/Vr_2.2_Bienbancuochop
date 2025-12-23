
import React, { useState } from 'react';
import { DownloadIcon, EyeIcon, UploadCloudIcon } from './icons';
import { saveReportToCloud } from './storageService';

interface MeetingMinutesResultProps {
    htmlContent: string;
    className?: string;
}

const MeetingMinutesResult: React.FC<MeetingMinutesResultProps> = ({ htmlContent, className }) => {
    const [isSaving, setIsSaving] = useState(false);
    
    const getHtmlBlob = () => new Blob([htmlContent], { type: 'text/html;charset=utf-8' });

    // Hàm trích xuất tiêu đề từ HTML để đặt tên file
    const getFileName = () => {
        try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            const titleEl = tempDiv.querySelector('h3'); // Thường là V/v: [Tiêu đề]
            let baseName = "Bien_ban_hop";
            
            if (titleEl && titleEl.textContent) {
                const text = titleEl.textContent.replace('V/v:', '').trim();
                if (text) baseName = text;
            }
            
            const dateStr = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
            return `${baseName.replace(/[/\\?%*:|"<>]/g, '-')}_${dateStr}`;
        } catch (e) {
            return `Bien_ban_hop_${Date.now()}`;
        }
    };

    const handleDownload = () => {
        const blob = getHtmlBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${getFileName()}.html`;
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

    const handleCloudSave = async () => {
        if (isSaving) return;
        
        setIsSaving(true);
        try {
            const fileName = getFileName();
            // Hàm này bây giờ đã có Timeout 15s bên trong
            const cloudUrl = await saveReportToCloud(fileName, htmlContent);
            if (cloudUrl) {
                console.log("Biên bản đã được lưu tại:", cloudUrl);
            }
        } catch (error) {
            console.error("Lỗi khi lưu Cloud:", error);
        } finally {
            // Đảm bảo nút được mở lại kể cả khi lỗi
            setIsSaving(false);
        }
    };

    return (
        <div className={`relative bg-gray-700/50 p-4 rounded-lg space-y-4 ${className || ''}`}>
            <div className="absolute top-2 right-2 flex space-x-2 z-10">
                <button
                    onClick={handleCloudSave}
                    disabled={isSaving}
                    className={`p-1.5 rounded-md transition flex items-center gap-1 ${isSaving ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                    title="Lưu lên Vercel Blob Cloud"
                >
                    <UploadCloudIcon className={`w-5 h-5 ${isSaving ? 'animate-bounce' : ''}`} />
                    <span className="text-xs font-bold pr-1 hidden sm:inline">
                        {isSaving ? 'Đang lưu...' : 'Lưu Cloud'}
                    </span>
                </button>
                <button
                    onClick={handlePreview}
                    className="p-1.5 bg-gray-600 rounded-md hover:bg-gray-500 text-gray-300 hover:text-white transition"
                    title="Xem trước biên bản"
                >
                    <EyeIcon className="w-5 h-5" />
                </button>
                <button
                    onClick={handleDownload}
                    className="p-1.5 bg-gray-600 rounded-md hover:bg-gray-500 text-gray-300 hover:text-white transition"
                    title="Tải về máy (.html)"
                >
                    <DownloadIcon className="w-5 h-5" />
                </button>
            </div>
            
            <div className={`w-full bg-white rounded-md overflow-hidden ${className ? 'h-full' : 'h-72 sm:h-80'}`}>
                 <iframe
                    srcDoc={htmlContent}
                    title="Meeting Minutes Preview"
                    className="w-full h-full border-0"
                    sandbox="allow-scripts"
                />
            </div>
            
            {isSaving && (
                <div className="absolute inset-x-4 bottom-4">
                    <div className="bg-blue-900/80 text-blue-100 text-[10px] px-3 py-1 rounded-full animate-pulse text-center">
                        Đang truyền dữ liệu lên hệ thống Vercel Storage...
                    </div>
                </div>
            )}
        </div>
    );
};

export default MeetingMinutesResult;
