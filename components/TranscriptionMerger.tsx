
import React, { useState, useEffect } from 'react';
import { QueueItem } from './FileQueueList';
import { CheckIcon, EyeIcon } from './icons';

interface TranscriptionMergerProps {
    queue: QueueItem[];
    onMerge: (mergedText: string) => void;
}

const TranscriptionMerger: React.FC<TranscriptionMergerProps> = ({ queue, onMerge }) => {
    const completedItems = queue.filter(item => item.status === 'completed' && item.transcription);
    
    // State to track which items are selected for merging
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    // State to track which items are currently being previewed (expanded)
    const [previewIds, setPreviewIds] = useState<Set<string>>(new Set());

    // Auto-select all new completed items by default when they appear
    useEffect(() => {
        const newIds = new Set(selectedIds);
        let changed = false;
        completedItems.forEach(item => {
            if (!selectedIds.has(item.id)) {
                newIds.add(item.id);
                changed = true;
            }
        });
        if (changed && selectedIds.size === 0) {
            setSelectedIds(newIds);
        }
    }, [completedItems.length]); // Only run when count changes to avoid loops

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const togglePreview = (id: string) => {
        const newSet = new Set(previewIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setPreviewIds(newSet);
    };

    const mergeItems = (itemsToMerge: QueueItem[]) => {
        // Sort items by their original part index to maintain logical order
        const sortedSelection = itemsToMerge
            .sort((a, b) => {
                // Primary sort: Original name
                if (a.originalName !== b.originalName) return a.originalName.localeCompare(b.originalName);
                // Secondary sort: Part index
                return a.partIndex - b.partIndex;
            });

        const mergedText = sortedSelection
            .map(item => `--- Phần: ${item.file.name} ---\n${item.transcription}`)
            .join('\n\n');

        onMerge(mergedText);
    };

    const handleMergeSelected = () => {
        const selectedItems = completedItems.filter(item => selectedIds.has(item.id));
        mergeItems(selectedItems);
    };

    const handleSelectAllAndMerge = () => {
        // Visually select all items
        const allIds = new Set(completedItems.map(item => item.id));
        setSelectedIds(allIds);
        
        // Merge all items immediately
        mergeItems(completedItems);
    };

    if (completedItems.length === 0) return null;

    return (
        <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600 space-y-4">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-md font-semibold text-cyan-400">Kết quả xử lý từng phần (Chọn để gộp)</h3>
                <span className="text-xs text-gray-400">{selectedIds.size} phần được chọn</span>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {completedItems.map((item) => (
                    <div key={item.id} className="bg-gray-800 rounded p-3 border border-gray-700">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3 overflow-hidden">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.has(item.id)}
                                    onChange={() => toggleSelection(item.id)}
                                    className="form-checkbox h-5 w-5 text-cyan-500 bg-gray-700 border-gray-500 rounded focus:ring-cyan-500 cursor-pointer"
                                />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-white truncate" title={item.file.name}>
                                        {item.file.name}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {item.transcription?.length ? `${item.transcription.length} ký tự` : 'Trống'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => togglePreview(item.id)}
                                className={`p-1.5 rounded transition-colors ${previewIds.has(item.id) ? 'bg-cyan-900 text-cyan-300' : 'bg-gray-700 text-gray-400 hover:text-white'}`}
                                title="Xem nội dung"
                            >
                                <EyeIcon className="w-4 h-4" />
                            </button>
                        </div>
                        
                        {previewIds.has(item.id) && (
                            <div className="mt-3 p-2 bg-gray-900/50 rounded text-xs font-mono text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto border-t border-gray-700">
                                {item.transcription}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="pt-2 border-t border-gray-600 flex flex-col sm:flex-row gap-3">
                 <button
                    onClick={handleSelectAllAndMerge}
                    className="w-full sm:flex-1 flex justify-center items-center space-x-2 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                    <CheckIcon className="w-5 h-5" />
                    <span>Chọn tất cả & Tiếp tục</span>
                </button>
                <button
                    onClick={handleMergeSelected}
                    disabled={selectedIds.size === 0}
                    className="w-full sm:flex-1 flex justify-center items-center space-x-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                    <CheckIcon className="w-5 h-5" />
                    <span>Gộp đã chọn ({selectedIds.size}) & Tiếp tục</span>
                </button>
            </div>
        </div>
    );
};

export default TranscriptionMerger;
