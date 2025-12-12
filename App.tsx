
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { transcribeAudio, generateMeetingMinutes, regenerateMeetingMinutes, identifySpeakers } from './services/geminiService';
import { processAudio } from './services/audioProcessor';
import FileUpload from './components/FileUpload';
import Options, { ProcessingOptions } from './components/Options';
import TranscriptionResult from './components/TranscriptionResult';
import ProgressBar from './components/ProgressBar';
import { GithubIcon, UsersIcon, RefreshIcon } from './components/icons';
import ModelSelector from './components/ModelSelector';
import MeetingMinutesGenerator, { MeetingDetails } from './components/MeetingMinutesGenerator';
import MeetingMinutesResult from './components/MeetingMinutesResult';
import EditRequest from './components/EditRequest';
import LiveTranscription from './components/LiveTranscription';
import SpeakerNamer from './components/SpeakerNamer';
import SavedSessionsList from './components/SavedSessionsList';
import FileQueueList, { QueueItem } from './components/FileQueueList';
import TranscriptionMerger from './components/TranscriptionMerger';
import CloudStorage from './components/CloudStorage';
import ChatAssistant from './components/ChatAssistant';

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
            if (nodeText.includes('Chủ đề / Mục đích cuộc họp') || nodeText.includes('V/v:')) {
                // Regex for "Chủ đề / Mục đích cuộc họp: [Content]" OR "(V/v: [Content])"
                const match = nodeText.match(/(?:Chủ đề \/ Mục đích cuộc họp:|V\/v:)\s*(.+?)(\)|$)/);

                if (match && match[1].trim()) {
                    const topic = match[1].trim();
                     if (!topic.toLowerCase().includes('(not provided)')) return topic.replace(/[()]/g, '');
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

// Helper to extract end time from the closing sentence
const extractEndTime = (html: string): string => {
    try {
         const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const text = tempDiv.innerText || tempDiv.textContent || '';
        // Match: "Cuộc họp kết thúc vào lúc [time] cùng ngày"
        const match = text.match(/Cuộc họp kết thúc vào lúc\s*(.*?)(?=\s*(cùng ngày|\.|$))/i);
        return match ? match[1].trim() : '';
    } catch(e) {
        return '';
    }
};

// Helper to parse Meeting Details from HTML for import
const parseMeetingDetailsFromHtml = (html: string): MeetingDetails => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const text = tempDiv.innerText || tempDiv.textContent || '';
    
    // Helper to find text after a keyword line
    const extract = (keywords: string[]) => {
        for (const kw of keywords) {
            const regex = new RegExp(`${kw}.*?[:\\.]\\s*(.*?)(?=(?:\\n|$))`, 'i');
            const match = text.match(regex);
            if (match && match[1].trim()) return match[1].trim();
        }
        return '';
    };

    return {
        timeAndPlace: extract(['Thời gian', 'Địa điểm', 'Thời gian & địa điểm']),
        endTime: extractEndTime(html),
        attendees: extract(['Thành phần', 'Thành phần tham dự']),
        chair: extract(['Chủ trì', 'Chủ tọa']),
        topic: extractTopicFromHtml(html) || 'Biên bản được nhập',
    };
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
const ARCHIVE_KEY = 'gemini_meeting_minutes_archive';
const CHUNK_SIZE = 6 * 1024 * 1024; 

const App: React.FC = () => {
    const [refreshKey, setRefreshKey] = useState(0);
    const [activeTab, setActiveTab] = useState<'file' | 'live' | 'history' | 'cloud'>('file');
    const [fileQueue, setFileQueue] = useState<QueueItem[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-pro');
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
        identifySpeakers: true,
        speakerCount: undefined,
    });

    const [meetingMinutesHtml, setMeetingMinutesHtml] = useState<string>('');
    const [isGeneratingMinutes, setIsGeneratingMinutes] = useState<boolean>(false);
    const [minutesError, setMinutesError] = useState<string | null>(null);
    const [lastMeetingDetails, setLastMeetingDetails] = useState<MeetingDetails | null>(null);
    
    const [isEditingMinutes, setIsEditingMinutes] = useState<boolean>(false);
    const [editError, setEditError] = useState<string | null>(null);

    const [isDiarizing, setIsDiarizing] = useState<boolean>(false);
    const [diarizationError, setDiarizationError] = useState<string | null>(null);
    const [diarizationProgress, setDiarizationProgress] = useState(0);

    const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
    const [archivedSessions, setArchivedSessions] = useState<SavedSession[]>([]);
    const [previewSession, setPreviewSession] = useState<SavedSession | null>(null);

    const cancelRequestRef = useRef<boolean>(false);


    useEffect(() => {
        try {
            const savedHistory = localStorage.getItem(HISTORY_KEY);
            if (savedHistory) {
                setSavedSessions(JSON.parse(savedHistory));
            }
            const savedArchive = localStorage.getItem(ARCHIVE_KEY);
            if (savedArchive) {
                setArchivedSessions(JSON.parse(savedArchive));
            }
        } catch (error) {
            console.error("Failed to load history from localStorage", error);
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(savedSessions));
        } catch (error) {
            console.error("Failed to save history to localStorage", error);
        }
    }, [savedSessions]);
    
    useEffect(() => {
        try {
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archivedSessions));
        } catch (error) {
            console.error("Failed to save archive to localStorage", error);
        }
    }, [archivedSessions]);

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

    const handleFileSelect = (files: File[]) => {
        resetState();
        setFinalTranscription('');
        
        const newQueueItems: QueueItem[] = [];

        files.forEach(file => {
            if (file.size > CHUNK_SIZE && file.type.startsWith('audio/')) {
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
                        isSelected: true,
                    });
                    
                    offset += CHUNK_SIZE;
                    part++;
                }
            } else {
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
        setFileQueue([]);
    };

    const handleCancel = () => {
        cancelRequestRef.current = true;
        if (isLoading) {
            setIsLoading(false);
            setProgress(0);
            setStatusMessage('Processing cancelled by user.');
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

    const handleLoadSession = useCallback((sessionId: string) => {
        const sessionToLoad = savedSessions.find(s => s.id === sessionId) || archivedSessions.find(s => s.id === sessionId);
        if (sessionToLoad) {
            resetState();
            setFinalTranscription(sessionToLoad.transcription);
            setMeetingMinutesHtml(sessionToLoad.meetingMinutesHtml);
            setLastMeetingDetails(sessionToLoad.meetingDetails);
            setFileQueue([]);
            setActiveTab('file');
            return true;
        }
        return false;
    }, [savedSessions, archivedSessions]);
    
    const handlePreviewSession = (session: SavedSession) => {
        setPreviewSession(session);
    };

    const handleDeleteSession = (sessionId: string) => {
        if (window.confirm("Bạn có chắc chắn muốn xóa phiên đã lưu này không? Hành động này không thể hoàn tác.")) {
             setSavedSessions(prev => prev.filter(s => s.id !== sessionId));
        }
    };
    
    const handleDeleteArchivedSession = (sessionId: string) => {
         if (window.confirm("CẢNH BÁO: Bạn sắp xóa vĩnh viễn khỏi kho lưu trữ. Hành động này không thể hoàn tác. Bạn có chắc chắn không?")) {
             setArchivedSessions(prev => prev.filter(s => s.id !== sessionId));
        }
    };

    const handleArchiveSession = useCallback((sessionId: string) => {
        const session = savedSessions.find(s => s.id === sessionId);
        if (session) {
            setArchivedSessions(prev => [session, ...prev]);
            setSavedSessions(prev => prev.filter(s => s.id !== sessionId));
            return true;
        }
        return false;
    }, [savedSessions]);
    
    const handleImportDatabase = async (file: File) => {
        try {
            const text = await file.text();
            const importedData = JSON.parse(text) as SavedSession[];
            if (Array.isArray(importedData)) {
                const currentIds = new Set(archivedSessions.map(s => s.id));
                const newItems = importedData.filter(s => !currentIds.has(s.id));
                
                setArchivedSessions(prev => [...newItems, ...prev]);
                alert(`Đã khôi phục thành công ${newItems.length} biên bản.`);
            } else {
                alert("File không hợp lệ. Vui lòng chọn file JSON được xuất từ ứng dụng này.");
            }
        } catch (e) {
            console.error("Import failed", e);
            alert("Lỗi khi đọc file. File có thể bị hỏng hoặc sai định dạng.");
        }
    };

    const handleImportSession = async (files: File[]) => {
        const newSessions: SavedSession[] = [];
        for (const file of files) {
            try {
                const text = await file.text();
                const details = parseMeetingDetailsFromHtml(text);
                const extractedTopic = details.topic || file.name.replace('.html', '').replace('.htm', '');

                const newSession: SavedSession = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    createdAt: new Date().toISOString(),
                    name: `${extractedTopic} (Đã nhập)`,
                    transcription: "Phiên này được nhập từ file HTML. Dữ liệu lời thoại gốc không khả dụng để chỉnh sửa AI.",
                    meetingMinutesHtml: text,
                    meetingDetails: details,
                };
                newSessions.push(newSession);
            } catch (err) {
                console.error("Error parsing imported file:", file.name, err);
            }
        }
        if (newSessions.length > 0) {
            setSavedSessions(prev => [...newSessions, ...prev]);
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
        setFinalTranscription(''); 
        setError(null);

        try {
             for (let i = 0; i < itemsToProcess.length; i++) {
                const item = itemsToProcess[i];
                if (cancelRequestRef.current) break;

                setFileQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing', errorMsg: undefined } : q));
                setStatusMessage(`Processing file ${i + 1}/${itemsToProcess.length}: ${item.file.name}`);
                setProgress(((i) / itemsToProcess.length) * 100);

                try {
                    let resultText = '';
                    const isHtml = item.file.type === 'text/html' || item.file.name.toLowerCase().endsWith('.html') || item.file.name.toLowerCase().endsWith('.htm');

                    if (isHtml) {
                        const htmlContent = await item.file.text();
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = htmlContent;
                        resultText = tempDiv.textContent || tempDiv.innerText || "";
                        resultText = resultText.replace(/\s+/g, ' ').trim();
                    } else if (item.file.type.startsWith('text/') || item.file.name.toLowerCase().endsWith('.txt') || item.file.name.toLowerCase().endsWith('.md')) {
                        resultText = await item.file.text();
                    } else if (item.file.type.startsWith('audio/')) {
                        let fileToProcess = item.file;
                        const { identifySpeakers, speakerCount, ...audioOptions } = processingOptions;
                        const isAnyAudioOptionEnabled = Object.values(audioOptions).some(option => option === true);

                        if (isAnyAudioOptionEnabled) {
                            try {
                                fileToProcess = await processAudio(item.file, processingOptions);
                            } catch (conversionError: any) {
                                console.warn(`Audio processing failed for ${item.file.name}, proceeding with original file.`);
                            }
                        }

                        if (cancelRequestRef.current) break;
                        
                        if (fileToProcess.size > 15 * 1024 * 1024) {
                             throw new Error("File chunk is too large for the API after processing. Please try smaller files.");
                        }

                        await new Promise(res => setTimeout(res, 100));
                        resultText = await transcribeAudio(fileToProcess, selectedModel, processingOptions);
                    } else {
                         resultText = `[Skipped unsupported file type: ${item.file.type}]`;
                    }

                    if (cancelRequestRef.current) break;

                    setFileQueue(prev => prev.map(q => 
                        q.id === item.id ? { ...q, status: 'completed', transcription: resultText } : q
                    ));

                } catch (itemError: any) {
                    console.error(`Error processing item ${item.id}:`, itemError);
                    let errMsg = itemError.message || "An unknown error occurred.";
                    setFileQueue(prev => prev.map(q => 
                        q.id === item.id ? { ...q, status: 'error', errorMsg: errMsg } : q
                    ));
                }
            }
            
            setProgress(100);
            setStatusMessage('Queue processing finished. Please select files to merge below.');

        } catch (err) {
            if (cancelRequestRef.current) return;
            setError(err instanceof Error ? err.message : "An unknown error occurred.");
        } finally {
            setIsLoading(false);
        }
    }, [fileQueue, selectedModel, processingOptions]);

    const handleMergeTranscription = (mergedText: string) => {
        setFinalTranscription(mergedText);
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
            setDiarizationProgress(prev => (prev >= 90 ? prev : prev + 5));
        }, 1000);

        try {
            const diarizedText = await identifySpeakers(finalTranscription, selectedModel, processingOptions.speakerCount);
            clearInterval(intervalId);
            setDiarizationProgress(100);
            setFinalTranscription(diarizedText);
        } catch (err: any) {
             clearInterval(intervalId);
             setDiarizationError(err.message || "Failed to identify speakers.");
        } finally {
            setIsDiarizing(false);
        }
    }, [finalTranscription, selectedModel, processingOptions.speakerCount]);

    const handleGenerateMinutes = async (details: MeetingDetails) => {
        setIsGeneratingMinutes(true);
        setMinutesError(null);
        setLastMeetingDetails(details);
        try {
             const html = await generateMeetingMinutes(finalTranscription, details, selectedModel);
             setMeetingMinutesHtml(html);
        } catch (e: any) {
            setMinutesError(e.message);
        } finally {
            setIsGeneratingMinutes(false);
        }
    };

    const handleEditMinutes = async (request: string) => {
        if (!lastMeetingDetails) return;
        setIsEditingMinutes(true);
        setEditError(null);
        try {
            const html = await regenerateMeetingMinutes(finalTranscription, lastMeetingDetails, meetingMinutesHtml, request, selectedModel);
            setMeetingMinutesHtml(html);
        } catch (e: any) {
            setEditError(e.message);
        } finally {
            setIsEditingMinutes(false);
        }
    }
    
    const handleSaveCurrentSession = () => {
        if (!finalTranscription) return;
        const newSession: SavedSession = {
            id: Date.now().toString(),
            createdAt: new Date().toISOString(),
            name: lastMeetingDetails?.topic || "Untitled Session",
            transcription: finalTranscription,
            meetingMinutesHtml: meetingMinutesHtml,
            meetingDetails: lastMeetingDetails || { topic: "Untitled", timeAndPlace: "", endTime: "", attendees: "", chair: "" }
        };
        setSavedSessions(prev => [newSession, ...prev]);
        alert("Session saved to History!");
    };

    const handleChatAction = async (actionName: string, args: any) => {
        switch (actionName) {
            case 'list_history':
                return savedSessions.map(s => ({ id: s.id, name: s.name, date: s.createdAt }));
            case 'list_archive':
                return archivedSessions.map(s => ({ id: s.id, name: s.name, date: s.createdAt }));
            case 'load_session':
                const loaded = handleLoadSession(args.sessionId);
                return loaded ? "Session loaded successfully." : "Session not found.";
            case 'archive_session':
                const archived = handleArchiveSession(args.sessionId);
                return archived ? "Session archived." : "Session not found.";
            case 'edit_current_minutes':
                if (!meetingMinutesHtml || !lastMeetingDetails) return "No meeting minutes active to edit.";
                try {
                    const newHtml = await regenerateMeetingMinutes(finalTranscription, lastMeetingDetails, meetingMinutesHtml, args.instruction, selectedModel);
                    setMeetingMinutesHtml(newHtml);
                    return "Meeting minutes updated successfully.";
                } catch (e: any) {
                    return `Error updating minutes: ${e.message}`;
                }
            default:
                return "Unknown action.";
        }
    };

    const appContext = JSON.stringify({
        hasTranscription: !!finalTranscription,
        transcriptionPreview: finalTranscription.slice(0, 200),
        hasMinutes: !!meetingMinutesHtml,
        topic: lastMeetingDetails?.topic,
        filesInQueue: fileQueue.length,
        savedSessionsCount: savedSessions.length
    });

    return (
        <div key={refreshKey} className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white font-sans selection:bg-cyan-500 selection:text-white">
            <header className="bg-gray-800/80 backdrop-blur-md sticky top-0 z-50 border-b border-gray-700 shadow-lg">
                <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                        <div className="bg-gradient-to-r from-cyan-500 to-blue-600 p-2 rounded-lg shadow-lg shadow-cyan-500/20">
                            <RefreshIcon className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                            Gemini Meeting Assistant
                        </h1>
                    </div>
                    <div className="flex items-center gap-4">
                         <a href="https://github.com/google/generative-ai-js" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                            <GithubIcon className="w-6 h-6" />
                        </a>
                    </div>
                </div>
                
                {/* Navigation Tabs */}
                <div className="max-w-7xl mx-auto px-4 flex space-x-6 overflow-x-auto">
                    {[
                        { id: 'file', label: 'File Upload' },
                        { id: 'live', label: 'Live Recording' },
                        { id: 'history', label: 'History' },
                        { id: 'cloud', label: 'Cloud Storage' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                activeTab === tab.id 
                                ? 'border-cyan-500 text-cyan-400' 
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
                {/* Error Banner */}
                {error && (
                    <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg flex justify-between items-center animate-shake">
                        <span>{error}</span>
                        <button onClick={() => setError(null)} className="text-red-400 hover:text-white font-bold">✕</button>
                    </div>
                )}

                {/* Tab Content */}
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-700 p-6 min-h-[500px]">
                    {activeTab === 'file' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative">
                            <div className="lg:col-span-2 space-y-6">
                                <FileUpload onFileSelect={handleFileSelect} disabled={isLoading} />
                                <FileQueueList 
                                    queue={fileQueue} 
                                    onToggleSelect={handleToggleQueueItem} 
                                    onRemove={handleRemoveQueueItem} 
                                    disabled={isLoading} 
                                />
                                {fileQueue.some(q => q.status === 'completed') && (
                                     <TranscriptionMerger queue={fileQueue} onMerge={handleMergeTranscription} />
                                )}
                            </div>
                            
                            {/* Unified Right Sidebar Control Panel - Sticky on Desktop */}
                            <div className="lg:col-span-1">
                                <div className="space-y-4 lg:sticky lg:top-8 bg-gray-900/50 p-4 rounded-xl border border-gray-700/50 shadow-inner">
                                    <h3 className="text-gray-400 font-bold text-xs uppercase tracking-wider border-b border-gray-700 pb-2">
                                        Cấu hình & Xử lý
                                    </h3>
                                    
                                    <ModelSelector onModelChange={setSelectedModel} disabled={isLoading} initialModel={selectedModel} />
                                    
                                    <Options 
                                        disabled={isLoading} 
                                        options={processingOptions} 
                                        onOptionChange={setProcessingOptions} 
                                    />
                                    
                                    <div className="pt-2">
                                        <button
                                            onClick={handleProcessQueue}
                                            disabled={isLoading || fileQueue.every(i => !i.isSelected || i.status === 'completed')}
                                            className="w-full py-3.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-900/30 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none"
                                        >
                                            {isLoading ? 'Processing...' : 'Start Processing Selected Files'}
                                        </button>
                                        
                                        {isLoading && (
                                            <div className="mt-4 space-y-3 p-3 bg-gray-800 rounded-lg border border-gray-700">
                                                <ProgressBar progress={progress} message={statusMessage} />
                                                <button onClick={handleCancel} className="text-red-400 text-xs hover:text-red-300 w-full text-center font-medium">
                                                    Cancel Operation
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'live' && (
                        <div className="max-w-2xl mx-auto text-center space-y-6">
                            <h2 className="text-2xl font-bold text-white">Real-time Transcription</h2>
                            <p className="text-gray-400">Use your microphone to transcribe meetings in real-time. Make sure to grant browser permissions.</p>
                            <LiveTranscription onComplete={handleLiveTranscriptionComplete} disabled={isLoading} />
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <SavedSessionsList 
                            sessions={savedSessions} 
                            onLoad={handleLoadSession} 
                            onDelete={handleDeleteSession} 
                            onArchive={handleArchiveSession}
                            onPreview={handlePreviewSession}
                            onImport={handleImportSession}
                            disabled={isLoading} 
                        />
                    )}

                    {activeTab === 'cloud' && (
                        <CloudStorage 
                            sessions={archivedSessions} 
                            onLoad={handleLoadSession} 
                            onDelete={handleDeleteArchivedSession} 
                            onPreview={handlePreviewSession}
                            onImportDatabase={handleImportDatabase}
                            disabled={isLoading} 
                        />
                    )}
                </div>

                {/* Transcription Result & Diarization */}
                {finalTranscription && (
                    <div id="transcription-result-area" className="space-y-6 animate-fade-in-up">
                        <div className="flex justify-between items-center">
                            <h2 className="text-xl font-bold text-cyan-400">Transcription Result</h2>
                            <button onClick={handleSaveCurrentSession} className="text-sm bg-green-700 hover:bg-green-600 px-3 py-1 rounded text-white transition">
                                Save Session
                            </button>
                        </div>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2 space-y-4">
                                <TranscriptionResult text={finalTranscription} />
                                <SpeakerNamer 
                                    transcription={finalTranscription} 
                                    onUpdateTranscription={handleUpdateTranscription} 
                                    disabled={isLoading} 
                                />
                            </div>
                            <div className="space-y-4">
                                <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
                                    <h3 className="text-md font-bold text-gray-200 mb-2 flex items-center gap-2">
                                        <UsersIcon className="w-4 h-4" /> AI Speaker ID
                                    </h3>
                                    <p className="text-sm text-gray-400 mb-4">
                                        Automatically identify and label different speakers in the text using AI.
                                    </p>
                                    <button
                                        onClick={handleIdentifySpeakers}
                                        disabled={isDiarizing || isLoading}
                                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors disabled:bg-gray-600"
                                    >
                                        {isDiarizing ? 'Identifying...' : 'Identify Speakers'}
                                    </button>
                                    {isDiarizing && <div className="mt-3"><ProgressBar progress={diarizationProgress} message="Analyzing voices..." /></div>}
                                    {diarizationError && <p className="text-red-400 text-xs mt-2">{diarizationError}</p>}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Meeting Minutes Generation */}
                {finalTranscription && (
                    <div className="space-y-6 border-t border-gray-700 pt-8 animate-fade-in-up">
                         <h2 className="text-xl font-bold text-purple-400">Meeting Minutes Generation</h2>
                         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <div>
                                <MeetingMinutesGenerator 
                                    onSubmit={handleGenerateMinutes} 
                                    disabled={isGeneratingMinutes} 
                                    initialDetails={lastMeetingDetails}
                                />
                                {isGeneratingMinutes && <div className="mt-4"><ProgressBar progress={100} message="AI is writing the minutes..." /></div>}
                                {minutesError && <p className="text-red-400 mt-2">{minutesError}</p>}
                            </div>
                            
                            {meetingMinutesHtml && (
                                <div className="space-y-4">
                                    <MeetingMinutesResult htmlContent={meetingMinutesHtml} />
                                    <EditRequest onSubmit={handleEditMinutes} disabled={isEditingMinutes} />
                                    {isEditingMinutes && <p className="text-yellow-400 text-sm animate-pulse">AI is rewriting based on your request...</p>}
                                    {editError && <p className="text-red-400 text-sm">{editError}</p>}
                                </div>
                            )}
                         </div>
                    </div>
                )}
            </main>

            {/* Chat Assistant */}
            <ChatAssistant onExecuteAction={handleChatAction} appContext={appContext} />

            {/* Preview Modal */}
            {previewSession && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-gray-900 w-full max-w-4xl h-[90vh] rounded-2xl border border-gray-700 flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800">
                            <h3 className="font-bold text-lg text-white">{previewSession.name}</h3>
                            <button onClick={() => setPreviewSession(null)} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
                        </div>
                        <div className="flex-1 overflow-auto bg-white p-0">
                            <iframe
                                srcDoc={previewSession.meetingMinutesHtml}
                                title="Preview"
                                className="w-full h-full border-0"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
