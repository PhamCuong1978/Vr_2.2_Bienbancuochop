import React, { useState, useEffect, useMemo } from 'react';
import { UsersIcon } from './icons';

interface SpeakerNamerProps {
    transcription: string;
    onUpdateTranscription: (newTranscription: string) => void;
    disabled: boolean;
}

const SpeakerNamer: React.FC<SpeakerNamerProps> = ({ transcription, onUpdateTranscription, disabled }) => {
    const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({});

    const detectedSpeakers = useMemo(() => {
        if (!transcription) return [];
        const speakerRegex = /\[NGƯỜI NÓI \d+\]:/g;
        // Get unique labels first. Explicitly type matches to string[] to satisfy TS.
        const matches: string[] = transcription.match(speakerRegex) || [];
        const uniqueLabels: string[] = [...new Set(matches)].sort((a: string, b: string) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.match(/\d+/)?.[0] || '0');
            return numA - numB;
        });

        // Map labels to objects with snippets and counts
        return uniqueLabels.map(label => {
            const count = matches.filter(m => m === label).length;
            let snippet = "";
            let bestLength = 0;
            let searchIndex = 0;
            let checks = 0;
            
            // Find a representative snippet (longest in the first few occurrences)
            while (checks < 8) { // Check first 8 occurrences to find a good snippet
                const index = transcription.indexOf(label, searchIndex);
                if (index === -1) break;

                const contentStart = index + label.length;
                const nextLine = transcription.indexOf('\n', contentStart);
                const endIndex = nextLine !== -1 ? nextLine : Math.min(transcription.length, contentStart + 200);
                
                const potentialSnippet = transcription.substring(contentStart, endIndex).trim();
                
                // Heuristic: longer is usually better context, providing it's not just noise
                if (potentialSnippet.length > bestLength) {
                    bestLength = potentialSnippet.length;
                    snippet = potentialSnippet;
                }
                
                searchIndex = contentStart;
                checks++;
            }

            if (snippet.length > 150) {
                snippet = snippet.substring(0, 150) + "...";
            }
            if (!snippet) snippet = "(Không có nội dung rõ ràng)";

            return { label, snippet, count };
        });
    }, [transcription]);

    useEffect(() => {
        setSpeakerMap(prev => {
            const newMap = { ...prev };
            detectedSpeakers.forEach(({ label }) => {
                if (!(label in newMap)) {
                    newMap[label] = '';
                }
            });
            return newMap;
        });
    }, [detectedSpeakers]);

    const handleNameChange = (speakerLabel: string, newName: string) => {
        setSpeakerMap(prev => ({
            ...prev,
            [speakerLabel]: newName,
        }));
    };

    const handleApplyNames = () => {
        let updatedTranscription = transcription;
        // Cast Object.entries to ensure values are treated as strings
        const entries = (Object.entries(speakerMap) as [string, string][]).filter(([_, name]) => name.trim() !== '');

        for (const [speakerLabel, newName] of entries) {
            const escapedLabel = speakerLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const searchRegex = new RegExp(escapedLabel, 'g');
            updatedTranscription = updatedTranscription.replace(searchRegex, `${newName.trim()}:`);
        }
        onUpdateTranscription(updatedTranscription);
        setSpeakerMap({});
    };

    if (detectedSpeakers.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4 pt-6 border-t border-gray-700 mt-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h4 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                        <UsersIcon className="w-5 h-5 text-cyan-400" />
                        Định danh người nói
                    </h4>
                    <p className="text-xs text-gray-400 mt-1">
                        Hệ thống phát hiện {detectedSpeakers.length} giọng nói. Hãy gán tên thật cho họ.
                    </p>
                </div>
            </div>
            
            <div className="grid grid-cols-1 gap-4 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar">
                {detectedSpeakers.map(({ label, snippet, count }) => (
                    <div key={label} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex flex-col md:flex-row gap-4 items-start md:items-center shadow-lg hover:border-gray-600 transition-all group">
                        
                        <div className="flex-1 min-w-0 w-full">
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                                <span className="px-2.5 py-1 rounded-md bg-gray-700 group-hover:bg-cyan-900/40 text-cyan-400 font-bold text-xs uppercase tracking-wider shadow-sm border border-gray-600 transition-colors">
                                    {label.replace(/[\[\]:]/g, '')}
                                </span>
                                <span className="text-[10px] font-medium text-gray-400 bg-gray-900 px-2 py-0.5 rounded-full border border-gray-800">
                                    {count} lượt hội thoại
                                </span>
                            </div>
                            <div className="relative">
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-cyan-500/50 to-transparent rounded-full"></div>
                                <p className="text-sm text-gray-300 italic pl-3 leading-relaxed opacity-90">
                                    "{snippet}"
                                </p>
                            </div>
                        </div>

                        <div className="w-full md:w-64 flex-shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-gray-700">
                            <label className="block md:hidden text-[10px] text-gray-500 mb-1 uppercase font-semibold">Tên thực tế</label>
                            <input
                                type="text"
                                value={speakerMap[label] || ''}
                                onChange={e => handleNameChange(label, e.target.value)}
                                placeholder="VD: Anh Cường..."
                                disabled={disabled}
                                className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 outline-none transition-all placeholder-gray-600 shadow-inner"
                            />
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-gray-700/50">
                 <p className="text-xs text-gray-500 italic text-center sm:text-left flex-1">
                    * Mẹo: Nhập cùng một tên cho các nhãn khác nhau để gộp chúng lại (VD: Người 1 và Người 3 cùng là "Lan").
                </p>
                <button
                    onClick={handleApplyNames}
                    disabled={disabled || Object.values(speakerMap).every((name: string) => !name.trim())}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-lg shadow-lg disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95 text-sm flex-shrink-0"
                >
                    Áp dụng tên & Cập nhật
                </button>
            </div>
        </div>
    );
};

export default SpeakerNamer;