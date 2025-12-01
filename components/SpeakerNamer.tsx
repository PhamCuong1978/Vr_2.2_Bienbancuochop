
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
        const speakerRegex = /\[NGƯỜI NÓI \d+\]:/g;
        const matches = transcription.match(speakerRegex);
        if (!matches) return [];
        // Get unique speakers and sort them numerically
        return [...new Set(matches)].sort((a: string, b: string) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.match(/\d+/)?.[0] || '0');
            return numA - numB;
        });
    }, [transcription]);

    useEffect(() => {
        // Reset speaker names when the detected speakers change
        setSpeakerMap(
            detectedSpeakers.reduce((acc, speaker) => {
                acc[speaker] = '';
                return acc;
            }, {} as Record<string, string>)
        );
    }, [detectedSpeakers]);

    const handleNameChange = (speakerLabel: string, newName: string) => {
        setSpeakerMap(prev => ({
            ...prev,
            [speakerLabel]: newName,
        }));
    };

    const handleApplyNames = () => {
        let updatedTranscription = transcription;
        for (const [speakerLabel, newName] of Object.entries(speakerMap)) {
            if (typeof newName === 'string' && newName.trim()) {
                // Escape special characters in the label for use in the regex
                const escapedLabel = speakerLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const searchRegex = new RegExp(escapedLabel, 'g');
                // Replace the label with the new name and a colon
                updatedTranscription = updatedTranscription.replace(searchRegex, `${newName.trim()}:`);
            }
        }
        onUpdateTranscription(updatedTranscription);
    };

    if (detectedSpeakers.length === 0) {
        return null; // Don't render if no speakers are detected
    }

    return (
        <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {detectedSpeakers.map(speakerLabel => (
                    <div key={speakerLabel} className="bg-gray-800/50 p-3 rounded-lg border border-gray-700 flex flex-col sm:flex-row sm:items-center gap-2">
                        <label htmlFor={`speaker-${speakerLabel}`} className="text-xs font-bold text-gray-400 uppercase sm:w-1/3 truncate">
                            {speakerLabel.replace(':', '')}
                        </label>
                        <input
                            id={`speaker-${speakerLabel}`}
                            type="text"
                            value={speakerMap[speakerLabel] || ''}
                            onChange={e => handleNameChange(speakerLabel, e.target.value)}
                            placeholder="Enter Name..."
                            disabled={disabled}
                            className="flex-grow bg-gray-900 border border-gray-600 text-white rounded-md p-2 text-sm focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 outline-none"
                        />
                    </div>
                ))}
            </div>
            <div className="flex justify-end pt-2">
                <button
                    onClick={handleApplyNames}
                    disabled={disabled || Object.values(speakerMap).every((name: string) => !name.trim())}
                    className="w-full sm:w-auto px-6 py-2 bg-yellow-600 text-white font-bold rounded-lg shadow-md hover:bg-yellow-700 disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors text-sm"
                >
                    Apply Speaker Names
                </button>
            </div>
        </div>
    );
};

export default SpeakerNamer;
