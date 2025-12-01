
import React from 'react';
import { TrashIcon, CheckIcon } from './icons';

export interface QueueItem {
    id: string;
    file: File;
    originalName: string;
    partIndex: number; // 0 for single files, 1+ for parts
    totalParts: number;
    status: 'idle' | 'processing' | 'completed' | 'error';
    transcription: string | null;
    isSelected: boolean;
    errorMsg?: string;
}

interface FileQueueListProps {
    queue: QueueItem[];
    onToggleSelect: (id: string) => void;
    onRemove: (id: string) => void;
    disabled: boolean;
}

const FileQueueList: React.FC<FileQueueListProps> = ({ queue, onToggleSelect, onRemove, disabled }) => {
    if (queue.length === 0) return null;

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="mt-4 space-y-3">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider pl-1">
                Processing Queue ({queue.length})
            </h3>
            {/* Mobile-friendly table wrapper */}
            <div className="bg-gray-900/50 rounded-lg overflow-hidden border border-gray-600">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-300 min-w-[600px] sm:min-w-full">
                        <thead className="bg-gray-700/80 text-xs uppercase font-bold text-gray-400">
                            <tr>
                                <th className="px-4 py-3 w-10 text-center">
                                    {/* Header checkbox logic could go here */}
                                </th>
                                <th className="px-4 py-3">File Name</th>
                                <th className="px-4 py-3 w-24">Size</th>
                                <th className="px-4 py-3 w-32">Status</th>
                                <th className="px-4 py-3 w-16 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {queue.map((item) => (
                                <tr key={item.id} className={`hover:bg-gray-700/30 transition-colors ${item.isSelected ? 'bg-gray-800/50' : 'opacity-60 bg-gray-900/30'}`}>
                                    <td className="px-4 py-3 text-center">
                                        <input
                                            type="checkbox"
                                            checked={item.isSelected}
                                            onChange={() => onToggleSelect(item.id)}
                                            disabled={disabled || item.status === 'processing'}
                                            className="form-checkbox h-4 w-4 text-cyan-500 bg-gray-700 border-gray-500 rounded focus:ring-cyan-500 cursor-pointer disabled:opacity-50"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-white truncate max-w-[150px] sm:max-w-xs" title={item.file.name}>
                                            {item.file.name}
                                        </div>
                                        {item.totalParts > 1 && (
                                            <div className="text-xs text-cyan-400 mt-0.5">
                                                Part {item.partIndex}/{item.totalParts}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs sm:text-sm">
                                        {formatSize(item.file.size)}
                                    </td>
                                    <td className="px-4 py-3">
                                        {item.status === 'idle' && <span className="inline-block px-2 py-0.5 rounded bg-gray-700 text-gray-300 text-xs border border-gray-600">Waiting</span>}
                                        {item.status === 'processing' && <span className="inline-block px-2 py-0.5 rounded bg-yellow-900/30 text-yellow-400 text-xs animate-pulse border border-yellow-800/50">Processing...</span>}
                                        {item.status === 'completed' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-900/30 text-green-400 text-xs border border-green-800/50"><CheckIcon className="w-3 h-3"/> Done</span>}
                                        {item.status === 'error' && <span className="inline-block px-2 py-0.5 rounded bg-red-900/30 text-red-400 text-xs border border-red-800/50" title={item.errorMsg}>Error</span>}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            onClick={() => onRemove(item.id)}
                                            disabled={disabled || item.status === 'processing'}
                                            className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-30"
                                            title="Remove file"
                                        >
                                            <TrashIcon className="w-5 h-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default FileQueueList;
