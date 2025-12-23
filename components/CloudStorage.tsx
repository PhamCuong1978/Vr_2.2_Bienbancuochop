
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { SavedSession } from '../App';
import { TrashIcon, EyeIcon, DownloadIcon, UploadCloudIcon, DownloadCloudIcon, CloudIcon, RefreshIcon } from './icons';
import { listCloudReports, deleteCloudReport } from './storageService';

interface CloudStorageProps {
    sessions: SavedSession[];
    onLoad: (sessionId: string) => void;
    onDelete: (sessionId: string) => void;
    onPreview: (session: SavedSession) => void;
    onImportDatabase: (file: File) => void;
    disabled: boolean;
}

const CloudStorage: React.FC<CloudStorageProps> = ({ sessions, onLoad, onDelete, onPreview, onImportDatabase, disabled }) => {
    const dbInputRef = useRef<HTMLInputElement>(null);
    const [cloudFiles, setCloudFiles] = useState<any[]>([]);
    const [isLoadingCloud, setIsLoadingCloud] = useState(false);

    const fetchCloudFiles = useCallback(async () => {
        setIsLoadingCloud(true);
        try {
            const files = await listCloudReports();
            setCloudFiles(files);
        } finally {
            setIsLoadingCloud(false);
        }
    }, []);

    useEffect(() => {
        fetchCloudFiles();
    }, [fetchCloudFiles]);

    const handleDownloadHtml = (session: SavedSession) => {
        const blob = new Blob([session.meetingMinutesHtml], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date(session.createdAt).toLocaleDateString('vi-VN').replace(/\//g, '-');
        const safeName = (session.name || 'bien-ban-hop').replace(/[/\\?%*:|"<>]/g, '-').substring(0, 30);
        a.download = `Bien_ban_${safeName}_${dateStr}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDeleteCloudItem = async (url: string) => {
        if (window.confirm("Xóa vết lưu này khỏi danh sách? (Tệp tin gốc trên Vercel sẽ không bị xóa, anh cần tự truy cập hệ thống lưu trữ để xóa tệp gốc)")) {
            await deleteCloudReport(url);
            fetchCloudFiles();
        }
    };

    const handleExportAll = () => {
        if (sessions.length === 0) return;
        const dataStr = JSON.stringify(sessions, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `Gemini_Backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-8">
            {/* Section 1: Backup & Restore */}
            <div className="bg-gray-700/30 p-4 rounded-lg border border-gray-600 flex flex-col sm:flex-row justify-between items-center gap-4 shadow-inner">
                <div className="flex items-start gap-3">
                     <div className="p-2 bg-blue-900/50 rounded-lg text-blue-300">
                        <CloudIcon className="w-8 h-8" />
                     </div>
                     <div>
                        <h3 className="font-bold text-gray-200">Quản lý Dữ liệu</h3>
                        <p className="text-[10px] text-gray-400 mt-1 max-w-md">
                            Sao lưu và khôi phục toàn bộ lịch sử biên bản nội bộ của trình duyệt này.
                        </p>
                     </div>
                </div>
                
                <div className="flex items-center gap-2 w-full sm:w-auto">
                     <button onClick={() => dbInputRef.current?.click()} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-semibold rounded-lg border border-gray-500 transition-colors">
                        <UploadCloudIcon className="w-4 h-4" /> Restore
                    </button>
                    <button onClick={handleExportAll} disabled={sessions.length === 0} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-lg shadow-blue-900/20 transition-colors">
                        <DownloadCloudIcon className="w-4 h-4" /> Backup All
                    </button>
                    <input ref={dbInputRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files && onImportDatabase(e.target.files[0])} />
                </div>
            </div>

            {/* Section 2: VERCEL CLOUD INDEX */}
            <div className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-cyan-500"></div>
                        <h3 className="text-cyan-400 font-bold text-sm uppercase tracking-wide">Chỉ mục tệp trên Cloud</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={fetchCloudFiles} className="p-1 hover:bg-gray-700 rounded text-gray-400 transition-colors">
                            <RefreshIcon className={`w-4 h-4 ${isLoadingCloud ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {cloudFiles.length === 0 ? (
                    <div className="text-center py-8 bg-gray-800/20 rounded-lg border border-dashed border-gray-700 text-gray-500 text-[10px] italic">
                        Chưa có lịch sử tệp nào được tải lên Cloud từ trình duyệt này.<br/>
                        (Hãy nhấn nút "Lưu Cloud" tại kết quả biên bản để bắt đầu)
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {cloudFiles.map((file) => (
                            <div key={file.url} className="bg-gray-800/60 p-3 rounded-lg border border-gray-700 flex justify-between items-center group hover:border-cyan-500/50 transition-colors shadow-sm">
                                <div className="min-w-0 pr-2">
                                    <p className="text-xs font-medium text-gray-200 truncate" title={file.pathname}>
                                        {file.pathname.replace('bien-ban/', '')}
                                    </p>
                                    <p className="text-[9px] text-gray-500 mt-1">
                                        Đã tải lên: {new Date(file.uploadedAt).toLocaleString('vi-VN')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-cyan-900/30 text-cyan-400 hover:bg-cyan-600 hover:text-white rounded transition-all" title="Xem trực tuyến">
                                        <EyeIcon className="w-3.5 h-3.5" />
                                    </a>
                                    <button onClick={() => handleDeleteCloudItem(file.url)} className="p-1.5 bg-red-900/30 text-red-400 hover:bg-red-600 hover:text-white rounded transition-all" title="Xóa khỏi danh sách">
                                        <TrashIcon className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <p className="text-[9px] text-gray-500 italic">
                    * Lưu ý: Danh sách này chỉ hiển thị các tệp anh đã tải lên từ trình duyệt này. Tệp gốc luôn an toàn trên Vercel.
                </p>
            </div>

            {/* Section 3: LOCAL ARCHIVE */}
            <div className="space-y-4">
                 <div className="flex justify-between items-center pb-2 border-b border-gray-700">
                    <h3 className="text-gray-300 font-semibold text-sm uppercase tracking-wide">Kho lưu trữ nội bộ ({sessions.length})</h3>
                </div>

                {sessions.length === 0 ? (
                     <div className="text-center p-10 bg-gray-800/50 rounded-lg border border-dashed border-gray-700">
                        <CloudIcon className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                        <p className="text-gray-500 text-xs">Kho lưu trữ nội bộ trống.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {sessions.map(session => (
                            <div key={session.id} className="bg-gray-800 p-3 rounded-lg border border-gray-700 flex flex-col gap-3 shadow-sm hover:border-gray-500 transition-colors">
                                <div className="flex justify-between items-start">
                                    <div className="min-w-0 pr-4">
                                        <h4 className="font-bold text-white text-sm truncate" title={session.name}>{session.name}</h4>
                                        <p className="text-[10px] text-gray-400 mt-1">
                                            {new Date(session.createdAt).toLocaleString('vi-VN')}
                                        </p>
                                    </div>
                                    <button onClick={() => onDelete(session.id)} className="p-1 text-gray-500 hover:text-red-400 transition-colors">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                    <button onClick={() => onPreview(session)} className="flex-1 px-3 py-1.5 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded transition-colors flex items-center justify-center gap-1">
                                        <EyeIcon className="w-3 h-3" /> Xem
                                    </button>
                                    <button onClick={() => handleDownloadHtml(session)} className="flex-1 px-3 py-1.5 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded transition-colors flex items-center justify-center gap-1">
                                        <DownloadIcon className="w-3 h-3" /> Tải
                                    </button>
                                    <button onClick={() => onLoad(session.id)} className="flex-1 px-3 py-1.5 text-[10px] bg-cyan-700 hover:bg-cyan-600 text-white font-medium rounded transition-colors">
                                        Mở lại
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CloudStorage;
