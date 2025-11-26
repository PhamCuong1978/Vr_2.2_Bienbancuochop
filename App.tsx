
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { transcribeAudio, generateMeetingMinutes, regenerateMeetingMinutes, identifySpeakers } from './services/geminiService';
import { processAudio } from './services/audioProcessor';
import FileUpload from './components/FileUpload';
import Options, { ProcessingOptions } from './components/Options';
import TranscriptionResult from './components/TranscriptionResult';
import ProgressBar from './components/ProgressBar';
import { GithubIcon, UsersIcon } from './components/icons';
import ModelSelector from './components/ModelSelector';
import MeetingMinutesGenerator, { MeetingDetails } from './components/MeetingMinutesGenerator';
import MeetingMinutesResult from './components/MeetingMinutesResult';
import EditRequest from './components/EditRequest';
import LiveTranscription from './components/LiveTranscription';
import SpeakerNamer from './components/SpeakerNamer';
import SavedSessionsList from './components/SavedSessionsList';
import FileQueueList, { QueueItem } from './components/FileQueueList';
import TranscriptionMerger from './components/TranscriptionMerger';

// Helper function to extract the topic from the generated HTML
const extractTopicFromHtml = (htmlContent: string): string | null => {
    try {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        
        // Find all text nodes in the document body to search for the topic label
        const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            const nodeText = node.textContent || '';
            if (nodeText.includes('Chủ đề / Mục đích cuộc họp')) {
                // Found the label. The actual topic is likely in the text immediately following the colon,
                // or in the next sibling element of its parent.
                
                // Case 1: Topic is in the same text node after the label
                const match = nodeText.match(/Chủ đề \/ Mục đích cuộc họp:\s*(.+)/);
                if (match && match[1].trim()) {
                    const topic = match[1].trim();
                     if (!topic.toLowerCase().includes('(not provided)')) return topic;
                }
                
                // Case 2: Topic is in the next element sibling
                let parent = node.parentElement;
                let nextElement = parent?.nextElementSibling;
                while (nextElement) {
                    const topic = nextElement.textContent?.trim();
                    if (topic && !topic.toLowerCase().includes('(not provided)')) {
                        return topic;
                    }
                    nextElement = nextElement.nextElementSibling;
                }
            }
        }
    } catch(e) {
        console.error("Error parsing HTML for topic extraction:", e);
    }
    return null;
};

export interface SavedSession {
  id: string;
  createdAt: string;
  name: string;
  transcription: string;
  meetingMinutesHtml: string;
  meetingDetails: MeetingDetails;
}

const HISTORY_KEY = 'gemini_meeting_minutes_history';
// Reduced chunk size to 6MB to prevent "Array buffer allocation failed" and ensure processed WAVs fits in API limit.
// 6MB MP3 ~ 11MB WAV (16kHz mono) ~ 15MB Base64. Safe for Gemini API (20MB limit).
const CHUNK_SIZE = 6 * 1024 * 1024; 

const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'file' | 'live' | 'history'>('file');
    
    // Replaced simple file list with a Queue System
    const [fileQueue, setFileQueue] = useState<QueueItem[]>([]);
    
    const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-pro');
    
    // The master transcription state. 
    // In 'file' mode: set by the Merge action.
    // In 'live' mode: set by the live session completion.
    // In 'history' mode: set by loading a session.
    const [finalTranscription, setFinalTranscription] = useState<string>('');
    
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(0);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const [processingOptions, setProcessingOptions] = useState<ProcessingOptions>({
        convertToMono16kHz: true,
        noiseReduction: true,
        normalizeVolume: true,
        removeSilence: true,
        identifySpeakers: true, // Default to true as requested
    });

    const [meetingMinutesHtml, setMeetingMinutesHtml] = useState<string>('');
    const [isGeneratingMinutes, setIsGeneratingMinutes] = useState<boolean>(false);
    const [minutesError, setMinutesError] = useState<string | null>(null);
    const [lastMeetingDetails, setLastMeetingDetails] = useState<MeetingDetails | null>(null);
    const [minutesGenerationProgress, setMinutesGenerationProgress] = useState(0);
    const [minutesGenerationStatus, setMinutesGenerationStatus] = useState('');

    const [isEditingMinutes, setIsEditingMinutes] = useState<boolean>(false);
    const [editError, setEditError] = useState<string | null>(null);
    const [editProgress, setEditProgress] = useState<number>(0);
    const [editStatusMessage, setEditStatusMessage] = useState<string>('');

    const [isDiarizing, setIsDiarizing] = useState<boolean>(false);
    const [diarizationError, setDiarizationError] = useState<string | null>(null);
    const [diarizationProgress, setDiarizationProgress] = useState(0);

    const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);

    const cancelRequestRef = useRef<boolean>(false);


    // Load history from localStorage on initial render
    useEffect(() => {
        try {
            const savedHistory = localStorage.getItem(HISTORY_KEY);
            if (savedHistory) {
                setSavedSessions(JSON.parse(savedHistory));
            }
        } catch (error) {
            console.error("Failed to load history from localStorage", error);
        }
    }, []);

    // Save history to localStorage whenever it changes
    useEffect(() => {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(savedSessions));
        } catch (error) {
            console.error("Failed to save history to localStorage", error);
        }
    }, [savedSessions]);

    const resetState = () => {
        setError(null);
        setProgress(0);
        setStatusMessage('');
        setMeetingMinutesHtml('');
        setMinutesError(null);
        setLastMeetingDetails(null);
        setEditError(null);
        setDiarizationError(null);
        setIsDiarizing(false);
    }

    // --- File Handling & Splitting Logic ---
    const handleFileSelect = (files: File[]) => {
        resetState();
        setFinalTranscription(''); // Reset final text when new files are added
        
        const newQueueItems: QueueItem[] = [];

        files.forEach(file => {
            if (file.size > CHUNK_SIZE && file.type.startsWith('audio/')) {
                // Split Logic
                let offset = 0;
                let part = 1;
                const totalParts = Math.ceil(file.size / CHUNK_SIZE);

                while (offset < file.size) {
                    const slice = file.slice(offset, offset + CHUNK_SIZE);
                    const chunkFile = new File([slice], `${file.name}_part${part}`, { type: file.type });
                    
                    newQueueItems.push({
                        id: Math.random().toString(36).substr(2, 9),
                        file: chunkFile,
                        originalName: file.name,
                        partIndex: part,
                        totalParts: totalParts,
                        status: 'idle',
                        transcription: null,
                        isSelected: true, // Auto-select by default
                    });
                    
                    offset += CHUNK_SIZE;
                    part++;
                }
            } else {
                // Normal file
                newQueueItems.push({
                    id: Math.random().toString(36).substr(2, 9),
                    file: file,
                    originalName: file.name,
                    partIndex: 0,
                    totalParts: 1,
                    status: 'idle',
                    transcription: null,
                    isSelected: true,
                });
            }
        });

        setFileQueue(prev => [...prev, ...newQueueItems]);
    };

    const handleToggleQueueItem = (id: string) => {
        setFileQueue(prev => prev.map(item => 
            item.id === id ? { ...item, isSelected: !item.isSelected } : item
        ));
    };

    const handleRemoveQueueItem = (id: string) => {
        setFileQueue(prev => prev.filter(item => item.id !== id));
    };
    
    const handleLiveTranscriptionComplete = (text: string) => {
        resetState();
        setFinalTranscription(text);
        setFileQueue([]); // Clear queue if switching to live results
    };

    const handleCancel = () => {
        cancelRequestRef.current = true;
        if (isLoading) {
            setIsLoading(false);
            setProgress(0);
            setStatusMessage('Processing cancelled by user.');
            // Reset processing status in queue
            setFileQueue(prev => prev.map(item => 
                item.status === 'processing' ? { ...item, status: 'idle' } : item
            ));
        }
        if (isGeneratingMinutes) {
            setIsGeneratingMinutes(false);
            setMinutesError('Minute generation cancelled by user.');
        }
        if (isEditingMinutes) {
            setIsEditingMinutes(false);
            setEditError('Edit request cancelled by user.');
        }
        if (isDiarizing) {
            setIsDiarizing(false);
            setDiarizationError('Speaker identification cancelled by user.');
        }
    };

    const handleLoadSession = (sessionId: string) => {
        const sessionToLoad = savedSessions.find(s => s.id === sessionId);
        if (sessionToLoad) {
            resetState();
            setFinalTranscription(sessionToLoad.transcription);
            setMeetingMinutesHtml(sessionToLoad.meetingMinutesHtml);
            setLastMeetingDetails(sessionToLoad.meetingDetails);
            setFileQueue([]); // Clear file queue
            setActiveTab('file'); // Switch back to the main view
        }
    };

    const handleDeleteSession = (sessionId: string) => {
        if (window.confirm("Bạn có chắc chắn muốn xóa phiên đã lưu này không? Hành động này không thể hoàn tác.")) {
             setSavedSessions(prev => prev.filter(s => s.id !== sessionId));
        }
    };


    const handleProcessQueue = useCallback(async () => {
        const itemsToProcess = fileQueue.filter(item => item.isSelected && item.status !== 'completed');

        if (itemsToProcess.length === 0) {
            setError("Please select at least one pending file to process.");
            return;
        }

        setIsLoading(true);
        cancelRequestRef.current = false;
        resetState();
        // Do NOT reset finalTranscription here, user might be appending. 
        // Actually, usually user processes then merges. Let's clear any previous merge result to avoid confusion.
        setFinalTranscription(''); 
        setError(null);

        try {
             for (let i = 0; i < itemsToProcess.length; i++) {
                const item = itemsToProcess[i];
                if (cancelRequestRef.current) break;

                // Update UI to show processing
                setFileQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing', errorMsg: undefined } : q));
                setStatusMessage(`Processing file ${i + 1}/${itemsToProcess.length}: ${item.file.name}`);
                setProgress(((i) / itemsToProcess.length) * 100);

                try {
                    let resultText = '';

                    if (item.file.type.startsWith('text/')) {
                        resultText = await item.file.text();
                    } else if (item.file.type.startsWith('audio/')) {
                        let fileToProcess = item.file;
                        // Exclude identifySpeakers from audio pre-processing checks (it's an API option, not an audio DSP option)
                        const { identifySpeakers, ...audioOptions } = processingOptions;
                        const isAnyAudioOptionEnabled = Object.values(audioOptions).some(option => option === true);

                        if (isAnyAudioOptionEnabled) {
                            try {
                                setStatusMessage(`Pre-processing audio for ${item.file.name}...`);
                                fileToProcess = await processAudio(item.file, processingOptions);
                            } catch (conversionError: any) {
                                console.warn(`Audio processing failed for ${item.file.name}, proceeding with original file. Error:`, conversionError);
                                // Fallback to original
                            }
                        }

                        if (cancelRequestRef.current) break;
                        
                         // Check if file size is safe for inline usage (approx 20MB limit for Gemini inline)
                        // Note: Base64 overhead adds ~33%. 15MB file -> 20MB Base64.
                        if (fileToProcess.size > 15 * 1024 * 1024) {
                             throw new Error("File chunk is too large for the API after processing. Please try smaller files or disable audio pre-processing.");
                        }

                        setStatusMessage(`Sending ${item.file.name} to Gemini...`);
                        
                        // Small delay to let UI update
                        await new Promise(res => setTimeout(res, 100));
                        
                        // Pass options to transcribeAudio
                        resultText = await transcribeAudio(fileToProcess, selectedModel, processingOptions);
                    } else {
                         resultText = `[Skipped unsupported file type: ${item.file.type}]`;
                    }

                    if (cancelRequestRef.current) break;

                    // Update success state
                    setFileQueue(prev => prev.map(q => 
                        q.id === item.id ? { ...q, status: 'completed', transcription: resultText } : q
                    ));

                } catch (itemError: any) {
                    console.error(`Error processing item ${item.id}:`, itemError);
                    let errMsg = itemError.message || "An unknown error occurred.";
                    if (errMsg === "[object Object]") errMsg = "API Error (Unknown Format)";

                    setFileQueue(prev => prev.map(q => 
                        q.id === item.id ? { ...q, status: 'error', errorMsg: errMsg } : q
                    ));
                    // We continue to the next item even if one fails
                }
            }
            
            setProgress(100);
            setStatusMessage('Queue processing finished. Please select files to merge below.');

        } catch (err) {
            if (cancelRequestRef.current) return;
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    }, [fileQueue, selectedModel, processingOptions]);

    const handleMergeTranscription = (mergedText: string) => {
        setFinalTranscription(mergedText);
        // Scroll to the result area
        setTimeout(() => {
            const el = document.getElementById('transcription-result-area');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    };

    const handleUpdateTranscription = (newText: string) => {
        setFinalTranscription(newText);
    };


    const handleIdentifySpeakers = useCallback(async () => {
        if (!finalTranscription) {
            setDiarizationError("A transcription must exist before identifying speakers.");
            return;
        }

        setIsDiarizing(true);
        cancelRequestRef.current = false;
        setDiarizationError(null);
        setDiarizationProgress(0);

        const intervalId = window.setInterval(() => {
            if (cancelRequestRef.current) {
                clearInterval(intervalId);
                return;
            }
            setDiarizationProgress(prev => Math.min(prev + Math.floor(Math.random() * 5) + 2, 95));
        }, 500);

        try {
            const result = await identifySpeakers(finalTranscription, selectedModel);
            if (cancelRequestRef.current) return;
            setFinalTranscription(result); 
        } catch (err) {
            if (cancelRequestRef.current) return;
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setDiarizationError(errorMessage);
        } finally {
            clearInterval(intervalId);
            setIsDiarizing(false);
            setDiarizationProgress(100);
        }

    }, [finalTranscription, selectedModel]);


    const handleGenerateMinutes = useCallback(async (details: MeetingDetails) => {
        if (!finalTranscription) {
            setMinutesError("A transcription must exist before generating minutes.");
            return;
        }

        setIsGeneratingMinutes(true);
        cancelRequestRef.current = false;
        setMeetingMinutesHtml('');
        setMinutesError(null);
        setEditError(null);
        setLastMeetingDetails(details);

        setMinutesGenerationProgress(0);
        setMinutesGenerationStatus('Initializing...');
        const intervalId = window.setInterval(() => {
            if (cancelRequestRef.current) {
                clearInterval(intervalId);
                return;
            }
            setMinutesGenerationProgress(prev => {
                const next = prev + Math.floor(Math.random() * 5) + 2;
                if (next >= 95) {
                    clearInterval(intervalId);
                    return 95;
                }
                if (next < 20) setMinutesGenerationStatus('Sending transcription...');
                else if (next < 70) setMinutesGenerationStatus('Analyzing content...');
                else setMinutesGenerationStatus('Structuring the minutes...');
                return next;
            });
        }, 600);


        try {
            const resultHtml = await generateMeetingMinutes(finalTranscription, details, selectedModel);
            clearInterval(intervalId);
            if (cancelRequestRef.current) return;

            setMinutesGenerationProgress(100);
            setMinutesGenerationStatus('✅ Minutes generated!');
            await new Promise(res => setTimeout(res, 800));

            setMeetingMinutesHtml(resultHtml);

            // Save new session to history
            const extractedTopic = extractTopicFromHtml(resultHtml);
            const sessionTopic = extractedTopic || details.topic || 'Biên bản không có tiêu đề';
            
            const newSession: SavedSession = {
                id: Date.now().toString(),
                createdAt: new Date().toISOString(),
                name: `${new Date().toLocaleDateString()} - ${sessionTopic}`,
                transcription: finalTranscription,
                meetingMinutesHtml: resultHtml,
                meetingDetails: details,
            };
            setSavedSessions(prev => [newSession, ...prev]);

        } catch (err) {
            clearInterval(intervalId);
            if (cancelRequestRef.current) return;
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setMinutesError(errorMessage);
        } finally {
            clearInterval(intervalId);
            setIsGeneratingMinutes(false);
        }
    }, [finalTranscription, selectedModel]);

    const handleRequestEdits = useCallback(async (editText: string) => {
        if (!finalTranscription || !meetingMinutesHtml || !lastMeetingDetails) {
            setEditError("Cannot request edits without an existing transcription, generated minutes, and meeting details.");
            return;
        }

        setIsEditingMinutes(true);
        cancelRequestRef.current = false;
        setEditError(null);
        setEditProgress(0);
        setEditStatusMessage('Initializing edit...');

        const intervalId = window.setInterval(() => {
            if (cancelRequestRef.current) {
                clearInterval(intervalId);
                return;
            }
            setEditProgress(prev => {
                const next = prev + Math.floor(Math.random() * 6) + 3;
                if (next >= 95) {
                    clearInterval(intervalId);
                    return 95;
                }
                if (next < 30) setEditStatusMessage('Processing your request...');
                else if (next < 80) setEditStatusMessage('Applying changes...');
                else setEditStatusMessage('Finalizing new version...');
                return next;
            });
        }, 500);


        try {
            const resultHtml = await regenerateMeetingMinutes(finalTranscription, lastMeetingDetails, meetingMinutesHtml, editText, selectedModel);
            clearInterval(intervalId);
            if (cancelRequestRef.current) return;

            setEditProgress(100);
            setEditStatusMessage('✅ Edits applied successfully!');
            await new Promise(res => setTimeout(res, 800));

            setMeetingMinutesHtml(resultHtml);

            // Save edited version as a new session
            const extractedTopic = extractTopicFromHtml(resultHtml);
            const sessionTopic = extractedTopic || lastMeetingDetails.topic || 'Biên bản không có tiêu đề';
            
            const newSession: SavedSession = {
                id: Date.now().toString(),
                createdAt: new Date().toISOString(),
                name: `${new Date().toLocaleDateString()} - ${sessionTopic} (Đã chỉnh sửa)`,
                transcription: finalTranscription,
                meetingMinutesHtml: resultHtml,
                meetingDetails: lastMeetingDetails,
            };
            setSavedSessions(prev => [newSession, ...prev]);

        } catch (err) {
            clearInterval(intervalId);
            if (cancelRequestRef.current) return;
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setEditError(errorMessage);
        } finally {
            clearInterval(intervalId);
            setIsEditingMinutes(false);
        }
    }, [finalTranscription, meetingMinutesHtml, selectedModel, lastMeetingDetails]);

    const isBusy = isLoading || isGeneratingMinutes || isEditingMinutes || isDiarizing;
    const selectedCount = fileQueue.filter(i => i.isSelected && i.status !== 'completed').length;
    // Check if we have processed files ready for merging
    const hasProcessedFiles = fileQueue.some(i => i.status === 'completed' && i.transcription);

    const TabButton: React.FC<{ tabName: 'file' | 'live' | 'history'; children: React.ReactNode }> = ({ tabName, children }) => (
        <button
            onClick={() => setActiveTab(tabName)}
            disabled={isBusy}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500 ${activeTab === tabName ? 'bg-gray-700 text-cyan-400' : 'bg-transparent text-gray-400 hover:bg-gray-700/50 hover:text-white'}`}
        >
            {children}
        </button>
    );

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-2xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                        Gemini Meeting Minutes Assistant
                    </h1>
                    <p className="text-gray-400 mt-2">
                        Transcribe audio (large files supported) to generate professional meeting minutes.
                    </p>
                </header>
                
                <main className="space-y-6 bg-gray-800 p-6 sm:p-8 rounded-2xl shadow-2xl border border-gray-700">
                     <div className="space-y-4">
                        <div className="flex justify-between items-end border-b border-gray-600 pb-2">
                            <h2 className="text-lg font-semibold text-cyan-400">1. Get Content</h2>
                            <h2 className="text-lg font-semibold text-cyan-400">Version 2.2</h2>
                        </div>
                        <div className="flex border-b border-gray-600 -mt-2">
                           <TabButton tabName="file">From File(s)</TabButton>
                           <TabButton tabName="live">Live Recording</TabButton>
                           <TabButton tabName="history">Biên bản đã lưu</TabButton>
                        </div>
                        <div className="pt-2">
                            {activeTab === 'file' ? (
                                <>
                                    <FileUpload onFileSelect={handleFileSelect} disabled={isBusy} />
                                    <FileQueueList 
                                        queue={fileQueue} 
                                        onToggleSelect={handleToggleQueueItem}
                                        onRemove={handleRemoveQueueItem}
                                        disabled={isBusy} 
                                    />
                                </>
                            ) : activeTab === 'live' ? (
                                <LiveTranscription onComplete={handleLiveTranscriptionComplete} disabled={isBusy} />
                            ) : (
                                <SavedSessionsList
                                    sessions={savedSessions}
                                    onLoad={handleLoadSession}
                                    onDelete={handleDeleteSession}
                                    disabled={isBusy}
                                />
                            )}
                        </div>
                    </div>
                    
                    {activeTab === 'file' && (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <h2 className="text-lg font-semibold text-cyan-400 border-b border-gray-600 pb-2">2. Audio Options</h2>
                                    <Options 
                                        disabled={isBusy} 
                                        options={processingOptions}
                                        onOptionChange={setProcessingOptions}
                                    />
                                </div>
                                 <div className="space-y-4">
                                    <h2 className="text-lg font-semibold text-cyan-400 border-b border-gray-600 pb-2">3. Select Model</h2>
                                    <ModelSelector 
                                        initialModel={selectedModel}
                                        onModelChange={setSelectedModel} 
                                        disabled={isBusy}
                                    />
                                </div>
                            </div>
                        
                            <div className="text-center">
                                <button
                                    onClick={handleProcessQueue}
                                    disabled={selectedCount === 0 || isBusy}
                                    className="w-full sm:w-auto px-8 py-3 bg-cyan-500 text-white font-bold rounded-lg shadow-lg hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 disabled:scale-100"
                                >
                                    {isLoading 
                                        ? 'Processing Queue...' 
                                        : `▶️ Process ${selectedCount} Selected File(s)`}
                                </button>
                                {error && (
                                    <div className="mt-6 p-4 bg-red-900/50 border border-red-500 text-red-100 rounded-lg text-center">
                                        <p className="font-bold">Error:</p>
                                        <p>{error}</p>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                    
                    {isLoading && (
                         <div className="space-y-3 pt-4 border-t border-gray-700">
                            <ProgressBar progress={progress} message={statusMessage} />
                            <div className="text-center">
                                <button 
                                    onClick={handleCancel}
                                    className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 disabled:bg-gray-500 transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Section 4: Transcription Results & Tools */}
                    {(hasProcessedFiles || finalTranscription) && (
                         <div className="space-y-4 pt-4 border-t border-gray-700" id="transcription-result-area">
                            <h2 className="text-lg font-semibold text-cyan-400">4. Transcription &amp; Speaker Tools</h2>
                            
                            {/* Merger Tool for File Mode */}
                            {activeTab === 'file' && hasProcessedFiles && (
                                <TranscriptionMerger 
                                    queue={fileQueue}
                                    onMerge={handleMergeTranscription}
                                />
                            )}
                            
                            {/* Final Editable Transcription Area */}
                            {finalTranscription && (
                                <>
                                    <div className="mt-4">
                                        <p className="text-sm text-gray-400 mb-2">Văn bản cuối cùng (Đã gộp/Xử lý):</p>
                                        <TranscriptionResult text={finalTranscription} />
                                    </div>

                                    <div className="p-4 bg-gray-700/50 rounded-lg text-center space-y-4">
                                        <p className="text-sm text-gray-400">Identify different speakers in the transcript and assign names to them.</p>
                                        <button
                                            onClick={handleIdentifySpeakers}
                                            disabled={isBusy}
                                            className="inline-flex items-center gap-x-2 w-full sm:w-auto px-6 py-2 bg-yellow-600 text-white font-bold rounded-lg shadow-lg hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 disabled:scale-100"
                                        >
                                            <UsersIcon className="w-5 h-5" />
                                            {isDiarizing ? 'Identifying Speakers...' : 'Identify Speakers (Refine)'}
                                        </button>
                                        {isDiarizing && <ProgressBar progress={diarizationProgress} message="Analyzing conversation patterns..." />}
                                        {diarizationError && <p className="text-red-400 mt-2">{diarizationError}</p>}
                                    </div>
                                    
                                    <SpeakerNamer
                                        transcription={finalTranscription}
                                        onUpdateTranscription={handleUpdateTranscription}
                                        disabled={isBusy}
                                    />
                                </>
                            )}
                        </div>
                    )}


                    {/* Section 5: Minutes Generation */}
                    {!isLoading && finalTranscription && (
                         <div className="space-y-4 pt-4 border-t border-gray-700">
                            <h2 className="text-lg font-semibold text-purple-400">5. Generate Meeting Minutes</h2>
                            {isGeneratingMinutes ? (
                                    <div className="text-center space-y-3 p-4 bg-gray-700/50 rounded-lg">
                                    <ProgressBar progress={minutesGenerationProgress} message={minutesGenerationStatus} />
                                    <button 
                                        onClick={handleCancel}
                                        className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 disabled:bg-gray-500 transition-all"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <MeetingMinutesGenerator 
                                        onSubmit={handleGenerateMinutes} 
                                        disabled={isGeneratingMinutes || isEditingMinutes}
                                        initialDetails={lastMeetingDetails}
                                    />
                                    {minutesError && <p className="text-red-400 mt-2 text-center">{minutesError}</p>}
                                </>
                            )}
                        </div>
                    )}
                    
                    {!isGeneratingMinutes && meetingMinutesHtml && (
                        <>
                            <div className="space-y-4 pt-4 border-t border-gray-700">
                                <h2 className="text-lg font-semibold text-purple-400">6. View &amp; Download Minutes</h2>
                                <MeetingMinutesResult htmlContent={meetingMinutesHtml} />
                            </div>
                    
                            <div className="space-y-4 pt-4 border-t border-gray-700">
                                <h2 className="text-lg font-semibold text-green-400">7. Request Edits</h2>
                                {isEditingMinutes ? (
                                    <div className="text-center space-y-3 p-4 bg-gray-700/50 rounded-lg">
                                        <ProgressBar progress={editProgress} message={editStatusMessage} />
                                        <button 
                                            onClick={handleCancel}
                                            className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 transition-all"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <EditRequest
                                        onSubmit={handleRequestEdits}
                                        disabled={isEditingMinutes}
                                    />
                                )}
                                {editError && <p className="text-red-400 mt-2 text-center">{editError}</p>}
                            </div>
                        </>
                    )}

                </main>
                 <footer className="text-center mt-8">
                    <a href="https://github.com/google/gemini-api" target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-gray-500 hover:text-cyan-400 transition-colors">
                        <GithubIcon className="w-5 h-5 mr-2" />
                        Powered by Google Gemini API
                    </a>
                </footer>
            </div>
        </div>
    );
};

export default App;
