
import React from 'react';
import { SavedSession } from '../App';
import { TrashIcon, EyeIcon, DownloadIcon, CloudIcon } from './icons';

interface CloudStorageProps {
    allSessions: SavedSession[]; // Nhận toàn bộ danh sách biên bản
    onLoad: (sessionId: string) => void;
    onDelete: (sessionId: string) => void;
    disabled: boolean;
}

const CloudStorage: React.FC<CloudStorageProps> = ({ allSessions, onLoad, onDelete, disabled }) => {
    // Lọc ra các biên bản đã có Link Cloud
    const cloudSessions = allSessions.filter(s => s.cloudUrl);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 border-b border-gray-700 pb-4">
                <CloudIcon className="w-8 h-8 text-cyan-400" />
                <h3 className="text-xl font-bold">Quản lý Biên bản trên Cloud</h3>
            </div>

            {cloudSessions.length === 0 ? (
                <div className="text-center py-20 bg-gray-800/30 rounded-2xl border border-dashed border-gray-700">
                    <p className="text-gray-500">Chưa có biên bản nào được tải lên Cloud.<br/>Hãy nhấn nút "Lưu Cloud" ở kết quả biên bản để hiển thị tại đây.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {cloudSessions.map((session) => (
                        <div key={session.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700 hover:border-cyan-500/50 transition-all shadow-lg group">
                            <div className="flex justify-between items-start mb-3">
                                <div className="min-w-0 pr-2">
                                    <h4 className="font-bold text-white truncate" title={session.name}>{session.name}</h4>
                                    <p className="text-[10px] text-gray-500 mt-1">
                                        {new Date(session.createdAt).toLocaleString('vi-VN')}
                                    </p>
                                </div>
                                <button onClick={() => onDelete(session.id)} className="text-gray-600 hover:text-red-400 p-1">
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                            </div>
                            
                            <div className="flex gap-2">
                                <a 
                                    href={session.cloudUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="flex-1 py-2 bg-cyan-900/30 text-cyan-400 text-center rounded-lg text-[10px] font-bold border border-cyan-800 hover:bg-cyan-600 hover:text-white transition-all flex items-center justify-center gap-1"
                                >
                                    <EyeIcon className="w-3 h-3" /> Mở Link
                                </a>
                                <button 
                                    onClick={() => onLoad(session.id)} 
                                    className="px-3 py-2 bg-gray-700 text-white rounded-lg text-[10px] font-bold hover:bg-gray-600 transition-colors"
                                >
                                    Nạp lại
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            
            <div className="mt-8 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                <p className="text-xs text-gray-400 italic">
                    * Mẹo: Cơ chế mới (2.4.4) lưu link Cloud trực tiếp vào Lịch sử duyệt web của anh. 
                    Khi anh Backup dữ liệu ở tab Cloud này, các link này cũng sẽ được sao lưu an toàn.
                </p>
            </div>
        </div>
    );
};

export default CloudStorage;
