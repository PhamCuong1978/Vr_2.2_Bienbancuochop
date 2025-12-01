
import React, { useRef } from 'react';
import { SavedSession } from '../App';
import { TrashIcon, EyeIcon, DownloadIcon, ImportIcon, ArchiveBoxIcon } from './icons';

interface SavedSessionsListProps {
    sessions: SavedSession[];
    onLoad: (sessionId: string) => void;
    onDelete: (sessionId: string) => void;
    onArchive?: (sessionId: string) => void;
    onPreview: (session: SavedSession) => void;
    onImport: (files: File[]) => void;
    disabled: boolean;
}

const SavedSessionsList: React.FC<SavedSessionsListProps> = ({ sessions, onLoad, onDelete, onArchive, onPreview, onImport, disabled }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDownload = (session: SavedSession) => {
        const blob = new Blob([session.meetingMinutesHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Use a safe filename based on session name
        const safeName = (session.name || 'bien-ban-hop').replace(/[/\\?%*:|"<>]/g, '-');
        a.download = `${safeName}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImportClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onImport(Array.from(e.target.files));
            // Reset input
            e.target.value = '';
        }
    };

    return (
        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-gray-300 font-semibold text-sm uppercase tracking-wide">Đã lưu ({sessions.length})</h3>
                <button
                    onClick={handleImportClick}
                    disabled={disabled}
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-cyan-400 text-sm font-medium rounded-lg transition-colors border border-gray-600 hover:border-cyan-500/50"
                >
                    <ImportIcon className="w-5 h-5" />
                    <span>Nhập biên bản</span>
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".html,.htm"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                />
            </div>

            {sessions.length === 0 ? (
                 <div className="text-center p-8 bg-gray-700/50 rounded-lg border border-dashed border-gray-600">
                    <h3 className="text-lg font-semibold text-gray-300">Không có biên bản nào được lưu</h3>
                    <p className="text-gray-400 mt-2 text-sm">Sau khi bạn tạo một biên bản, nó sẽ xuất hiện ở đây. Hoặc nhấn "Nhập biên bản" để tải lên file cũ.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {sessions.map(session => (
                        <div key={session.id} className="bg-gray-700/80 p-4 rounded-lg border border-gray-600 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-colors hover:bg-gray-700 hover:border-gray-500">
                            <div className="flex-grow min-w-0">
                                <h4 className="font-bold text-white truncate text-base" title={session.name}>{session.name}</h4>
                                <p className="text-xs text-gray-400 mt-1">
                                    Lưu lúc: {new Date(session.createdAt).toLocaleString()}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                                <button
                                    onClick={() => onPreview(session)}
                                    disabled={disabled}
                                    className="w-full sm:w-auto px-3 py-2 text-sm bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:bg-gray-500 transition-colors flex items-center justify-center gap-1"
                                    title="Xem trước biên bản (HTML)"
                                >
                                    <EyeIcon className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDownload(session)}
                                    disabled={disabled}
                                    className="w-full sm:w-auto px-3 py-2 text-sm bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 disabled:bg-gray-500 transition-colors flex items-center justify-center gap-1"
                                    title="Tải về biên bản (HTML)"
                                >
                                    <DownloadIcon className="w-4 h-4" />
                                </button>
                                {onArchive && (
                                    <button
                                        onClick={() => onArchive(session.id)}
                                        disabled={disabled}
                                        className="w-full sm:w-auto px-3 py-2 text-sm bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:bg-gray-500 transition-colors flex items-center justify-center gap-1"
                                        title="Chuyển sang Lưu trữ vĩnh viễn"
                                    >
                                        <ArchiveBoxIcon className="w-4 h-4" />
                                    </button>
                                )}
                                <button
                                    onClick={() => onLoad(session.id)}
                                    disabled={disabled}
                                    className="w-full sm:w-auto flex-1 sm:flex-initial px-4 py-2 text-sm bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-700 disabled:bg-gray-500 transition-colors"
                                >
                                    Tải lại
                                </button>
                                <button
                                    onClick={() => onDelete(session.id)}
                                    disabled={disabled}
                                    className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-500 transition-colors flex items-center justify-center"
                                    title="Xóa biên bản"
                                    aria-label="Xóa biên bản"
                                >
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SavedSessionsList;
