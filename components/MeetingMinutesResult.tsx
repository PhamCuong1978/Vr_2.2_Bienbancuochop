
import React, { useState } from 'react';
import { DownloadIcon, EyeIcon, UploadCloudIcon } from './icons';
import { saveReportToCloud } from './storageService';

interface MeetingMinutesResultProps {
    htmlContent: string;
    onCloudSaved?: (url: string) => void; // Thêm callback đồng bộ link
    className?: string;
}

const MeetingMinutesResult: React.FC<MeetingMinutesResultProps> = ({ htmlContent, onCloudSaved, className }) => {
    const [isSaving, setIsSaving] = useState(false);
    
    const getFileName = () => {
        try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            const titleEl = tempDiv.querySelector('h3');
            let baseName = "Bien_ban_hop";
            if (titleEl && titleEl.textContent) {
                const text = titleEl.textContent.replace('V/v:', '').trim();
                if (text) baseName = text;
            }
            return baseName.replace(/[/\\?%*:|"<>]/g, '-');
        } catch (e) {
            return `Bien_ban_${Date.now()}`;
        }
    };

    const handleCloudSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        const url = await saveReportToCloud(getFileName(), htmlContent);
        if (url) {
            alert("✅ Tải lên Cloud thành công!");
            if (onCloudSaved) onCloudSaved(url);
        }
        setIsSaving(false);
    };

    const handlePreview = () => {
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        window.open(URL.createObjectURL(blob), '_blank');
    };

    const handleDownload = () => {
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${getFileName()}.html`;
        a.click();
    };

    return (
        <div className={`relative bg-gray-700/50 p-4 rounded-lg space-y-4 mt-6 ${className || ''}`}>
            <div className="absolute top-2 right-2 flex space-x-2 z-10">
                <button
                    onClick={handleCloudSave}
                    disabled={isSaving}
                    className={`p-1.5 rounded-md transition flex items-center gap-1 ${isSaving ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-500'} text-white`}
                    title="Lưu lên Vercel Cloud"
                >
                    <UploadCloudIcon className={`w-5 h-5 ${isSaving ? 'animate-bounce' : ''}`} />
                    <span className="text-xs font-bold pr-1 hidden sm:inline">{isSaving ? 'Đang lưu...' : 'Lưu Cloud'}</span>
                </button>
                <button onClick={handlePreview} className="p-1.5 bg-gray-600 rounded-md text-gray-300" title="Xem trước"><EyeIcon className="w-5 h-5" /></button>
                <button onClick={handleDownload} className="p-1.5 bg-gray-600 rounded-md text-gray-300" title="Tải về"><DownloadIcon className="w-5 h-5" /></button>
            </div>
            <div className="w-full bg-white rounded-md h-80 overflow-hidden">
                 <iframe srcDoc={htmlContent} title="Preview" className="w-full h-full border-0" />
            </div>
        </div>
    );
};

export default MeetingMinutesResult;
