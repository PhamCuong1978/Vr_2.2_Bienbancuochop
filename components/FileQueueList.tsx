
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
        <div className="mt-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Processing Queue ({queue.length} files)
            </h3>
            <div className="bg-gray-700/50 rounded-lg overflow-hidden border border-gray-600 max-h-80 overflow-y-auto">
                <table className="w-full text-left text-sm text-gray-300">
                    <thead className="bg-gray-700 text-xs uppercase font-medium text-gray-400">
                        <tr>
                            <th className="px-4 py-3 w-10 text-center">
                                {/* Header checkbox logic could go here, but kept simple for now */}
                            </th>
                            <th className="px-4 py-3">File Name</th>
                            <th className="px-4 py-3 w-24">Size</th>
                            <th className="px-4 py-3 w-32">Status</th>
                            <th className="px-4 py-3 w-16 text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-600">
                        {queue.map((item) => (
                            <tr key={item.id} className={`hover:bg-gray-600/50 transition-colors ${item.isSelected ? 'bg-gray-700/30' : 'opacity-60'}`}>
                                <td className="px-4 py-3 text-center">
                                    <input
                                        type="checkbox"
                                        checked={item.isSelected}
                                        onChange={() => onToggleSelect(item.id)}
                                        disabled={disabled || item.status === 'processing'}
                                        className="form-checkbox h-4 w-4 text-cyan-500 bg-gray-600 border-gray-500 rounded focus:ring-cyan-500 cursor-pointer disabled:opacity-50"
                                    />
                                </td>
                                <td className="px-4 py-3">
                                    <div className="font-medium text-white truncate max-w-[200px] sm:max-w-xs" title={item.file.name}>
                                        {item.file.name}
                                    </div>
                                    {item.totalParts > 1 && (
                                        <div className="text-xs text-cyan-400">
                                            Part {item.partIndex} of {item.totalParts} (Split from {item.originalName})
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                                    {formatSize(item.file.size)}
                                </td>
                                <td className="px-4 py-3">
                                    {item.status === 'idle' && <span className="px-2 py-1 rounded bg-gray-600 text-gray-300 text-xs">Waiting</span>}
                                    {item.status === 'processing' && <span className="px-2 py-1 rounded bg-yellow-900/50 text-yellow-400 text-xs animate-pulse">Processing...</span>}
                                    {item.status === 'completed' && <span className="px-2 py-1 rounded bg-green-900/50 text-green-400 text-xs flex items-center w-fit gap-1"><CheckIcon className="w-3 h-3"/> Done</span>}
                                    {item.status === 'error' && <span className="px-2 py-1 rounded bg-red-900/50 text-red-400 text-xs" title={item.errorMsg}>Error</span>}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <button
                                        onClick={() => onRemove(item.id)}
                                        disabled={disabled || item.status === 'processing'}
                                        className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-30"
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
    );
};

export default FileQueueList;
