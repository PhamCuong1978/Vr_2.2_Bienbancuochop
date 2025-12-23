
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
    const [cloudError, setCloudError] = useState<string | null>(null);

    const fetchCloudFiles = useCallback(async () => {
        setIsLoadingCloud(true);
        setCloudError(null);
        try {
            const files = await listCloudReports();
            setCloudFiles(files || []);
            if (!files || files.length === 0) {
                console.log("Không tìm thấy tệp nào trên Cloud với tiền tố bien-ban/");
            }
        } catch (err: any) {
            console.error("Component fetchCloudFiles error:", err);
            setCloudError("Không thể kết nối với Vercel Cloud.");
        } finally {
            // Đảm bảo luôn dừng xoay vòng quay
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

    const handleDeleteCloudFile = async (url: string) => {
        if (window.confirm("Anh có chắc chắn muốn xóa tệp này vĩnh viễn trên Cloud không?")) {
            try {
                await deleteCloudReport(url);
                alert("✅ Đã xóa tệp trên Cloud thành công!");
                fetchCloudFiles();
            } catch (e) {
                alert("Lỗi khi xóa tệp.");
            }
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

    const handleImportClick = () => {
        if (dbInputRef.current) dbInputRef.current.click();
    };

    const handleDbFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onImportDatabase(e.target.files[0]);
            e.target.value = '';
        }
    };

    return (
        <div className="space-y-8">
            {/* Section 1: Backup & Restore */}
            <div className="bg-gray-700/30 p-4 rounded-lg border border-gray-600 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-start gap-3">
                     <div className="p-2 bg-blue-900/50 rounded-lg text-blue-300">
                        <CloudIcon className="w-8 h-8" />
                     </div>
                     <div>
                        <h3 className="font-bold text-gray-200">Quản lý Dữ liệu</h3>
                        <p className="text-xs text-gray-400 mt-1 max-w-md">
                            Sao lưu toàn bộ lịch sử biên bản cục bộ của trình duyệt để phòng trường hợp mất dữ liệu.
                        </p>
                     </div>
                </div>
                
                <div className="flex items-center gap-2 w-full sm:w-auto">
                     <button
                        onClick={handleImportClick}
                        disabled={disabled}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold rounded-lg border border-gray-500 transition-colors"
                    >
                        <UploadCloudIcon className="w-4 h-4" />
                        <span>Restore</span>
                    </button>
                    <button
                        onClick={handleExportAll}
                        disabled={disabled || sessions.length === 0}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-lg shadow-blue-900/20 transition-colors disabled:bg-gray-600 disabled:shadow-none"
                    >
                        <DownloadCloudIcon className="w-4 h-4" />
                        <span>Backup All</span>
                    </button>
                    <input ref={dbInputRef} type="file" accept=".json" className="hidden" onChange={handleDbFileChange} />
                </div>
            </div>

            {/* Section 2: ACTUAL VERCEL BLOB FILES */}
            <div className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                        <h3 className="text-blue-400 font-bold text-sm uppercase tracking-wide">Tệp tin trên Vercel Cloud</h3>
                    </div>
                    <button 
                        onClick={fetchCloudFiles} 
                        disabled={isLoadingCloud}
                        className={`p-1 hover:bg-gray-700 rounded text-gray-400 transition-colors ${isLoadingCloud ? 'cursor-not-allowed opacity-50' : ''}`}
                        title="Làm mới danh sách cloud"
                    >
                        <RefreshIcon className={`w-4 h-4 ${isLoadingCloud ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {isLoadingCloud ? (
                    <div className="text-center py-12 bg-gray-800/20 rounded-lg border border-gray-700/50">
                        <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                        <p className="text-gray-500 text-sm animate-pulse">Đang tải danh sách từ Vercel Cloud...</p>
                    </div>
                ) : cloudError ? (
                    <div className="text-center py-8 bg-red-900/10 rounded-lg border border-red-900/30 text-red-400 text-xs">
                        {cloudError} <button onClick={fetchCloudFiles} className="underline ml-2">Thử lại</button>
                    </div>
                ) : cloudFiles.length === 0 ? (
                    <div className="text-center py-10 bg-gray-800/30 rounded-lg border border-dashed border-gray-700 text-gray-500 text-xs italic">
                        Không tìm thấy tệp nào trong thư mục "bien-ban/" trên Cloud.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {cloudFiles.map((file) => (
                            <div key={file.url} className="bg-gray-800 p-3 rounded-lg border border-gray-700 flex justify-between items-center group hover:border-blue-500/50 transition-colors shadow-sm">
                                <div className="min-w-0 pr-2">
                                    <p className="text-sm font-medium text-gray-200 truncate" title={file.pathname}>
                                        {file.pathname.replace('bien-ban/', '')}
                                    </p>
                                    <p className="text-[10px] text-gray-500 mt-1">
                                        Tải lên: {new Date(file.uploadedAt).toLocaleString('vi-VN')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <a 
                                        href={file.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="p-1.5 bg-blue-900/30 text-blue-400 hover:bg-blue-600 hover:text-white rounded transition-all"
                                        title="Xem trực tuyến"
                                    >
                                        <EyeIcon className="w-4 h-4" />
                                    </a>
                                    <button 
                                        onClick={() => handleDeleteCloudFile(file.url)}
                                        className="p-1.5 bg-red-900/30 text-red-400 hover:bg-red-600 hover:text-white rounded transition-all"
                                        title="Xóa khỏi cloud"
                                    >
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Section 3: LOCAL ARCHIVE LIST */}
            <div className="space-y-4">
                 <div className="flex justify-between items-center pb-2 border-b border-gray-700">
                    <h3 className="text-gray-300 font-semibold text-sm uppercase tracking-wide">Kho lưu trữ nội bộ ({sessions.length})</h3>
                </div>

                {sessions.length === 0 ? (
                     <div className="text-center p-12 bg-gray-800/50 rounded-lg border border-dashed border-gray-700">
                        <CloudIcon className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                        <h3 className="text-lg font-semibold text-gray-400">Kho lưu trữ nội bộ trống</h3>
                        <p className="text-gray-500 mt-2 text-sm">Chuyển biên bản từ tab "History" sang đây để lưu trữ lâu dài trên trình duyệt này.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {sessions.map(session => (
                            <div key={session.id} className="bg-gray-800 p-4 rounded-lg border border-gray-700 flex flex-col gap-4 shadow-sm hover:border-gray-500 transition-colors">
                                <div className="flex justify-between items-start">
                                    <div className="min-w-0 pr-4">
                                        <h4 className="font-bold text-white text-lg truncate" title={session.name}>{session.name}</h4>
                                        <p className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                                            <span>📅 {new Date(session.createdAt).toLocaleDateString()}</span>
                                            <span className="w-1 h-1 rounded-full bg-gray-600"></span>
                                            <span>⏰ {new Date(session.createdAt).toLocaleTimeString()}</span>
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => onDelete(session.id)}
                                        disabled={disabled}
                                        className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                                        title="Xóa khỏi bộ nhớ trình duyệt"
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                                
                                <div className="flex items-center gap-2 pt-2 border-t border-gray-700/50">
                                    <button
                                        onClick={() => onPreview(session)}
                                        disabled={disabled}
                                        className="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-md transition-colors flex items-center justify-center gap-2"
                                    >
                                        <EyeIcon className="w-4 h-4" />
                                        Xem Local
                                    </button>
                                    <button
                                        onClick={() => handleDownloadHtml(session)}
                                        disabled={disabled}
                                        className="flex-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-md transition-colors flex items-center justify-center gap-2"
                                    >
                                        <DownloadIcon className="w-4 h-4" />
                                        Tải HTML
                                    </button>
                                    <button
                                        onClick={() => onLoad(session.id)}
                                        disabled={disabled}
                                        className="flex-1 px-3 py-2 text-sm bg-cyan-700 hover:bg-cyan-600 text-white font-medium rounded-md transition-colors"
                                    >
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
