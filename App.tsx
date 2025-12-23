
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { transcribeAudio, generateMeetingMinutes, regenerateMeetingMinutes, identifySpeakers, subscribeToStatus, getApiKey } from './services/geminiService';
import { processAudio } from './services/audioProcessor';
import FileUpload from './components/FileUpload';
import Options, { ProcessingOptions } from './components/Options';
import TranscriptionResult from './components/TranscriptionResult';
import ProgressBar from './components/ProgressBar';
import { GithubIcon, UsersIcon, RefreshIcon, SparklesIcon } from './components/icons';
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
import { APP_VERSION } from './Version';

// Helper function to extract information from HTML for recovery
const parseMeetingDetailsFromHtml = (html: string): MeetingDetails => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const text = tempDiv.innerText || tempDiv.textContent || '';
    const extract = (keywords: string[]) => {
        for (const kw of keywords) {
            const regex = new RegExp(`${kw}.*?[:\\.]\\s*(.*?)(?=(?:\\n|$))`, 'i');
            const match = text.match(regex);
            if (match && match[1].trim()) return match[1].trim();
        }
        return '';
    };

    const topicMatch = text.match(/V\/v:\s*(.+)/i);

    return {
        timeAndPlace: extract(['Thời gian', 'Địa điểm', 'Thời gian & địa điểm']),
        endTime: extract(['Cuộc họp kết thúc vào lúc']),
        attendees: extract(['Thành phần', 'Thành phần tham dự']),
        chair: extract(['Chủ trì', 'Chủ tọa']),
        topic: topicMatch ? topicMatch[1].trim() : 'Biên bản đã nạp',
    };
};

export interface SavedSession {
  id: string;
  createdAt: string;
  name: string;
  transcription: string;
  meetingMinutesHtml: string;
  meetingDetails: MeetingDetails;
  cloudUrl?: string; // Thêm link cloud vào đối tượng session
}

const HISTORY_KEY = 'gemini_meeting_minutes_history';
const ARCHIVE_KEY = 'gemini_meeting_minutes_archive';
const CHUNK_SIZE = 6 * 1024 * 1024; 

const App: React.FC = () => {
    const [refreshKey, setRefreshKey] = useState(0);
    const [activeTab, setActiveTab] = useState<'file' | 'live' | 'history' | 'cloud'>('file');
    const [fileQueue, setFileQueue] = useState<QueueItem[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
    const [finalTranscription, setFinalTranscription] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [progress, setProgress] = useState<number>(0);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [apiStatus, setApiStatus] = useState<{ keyIndex: number; totalKeys: number; model: string; isFallback: boolean } | null>(null);

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
    const [minutesProgress, setMinutesProgress] = useState<number>(0);
    const [minutesError, setMinutesError] = useState<string | null>(null);
    const [lastMeetingDetails, setLastMeetingDetails] = useState<MeetingDetails | null>(null);
    
    const [isEditingMinutes, setIsEditingMinutes] = useState<boolean>(false);
    const [editError, setEditError] = useState<string | null>(null);

    const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
    const [archivedSessions, setArchivedSessions] = useState<SavedSession[]>([]);
    const [previewSession, setPreviewSession] = useState<SavedSession | null>(null);

    const cancelRequestRef = useRef<boolean>(false);

    useEffect(() => {
        try {
            const savedHistory = localStorage.getItem(HISTORY_KEY);
            if (savedHistory) setSavedSessions(JSON.parse(savedHistory));
            const savedArchive = localStorage.getItem(ARCHIVE_KEY);
            if (savedArchive) setArchivedSessions(JSON.parse(savedArchive));
        } catch (error) {
            console.error("Failed to load history", error);
        }

        const unsubscribe = subscribeToStatus((status) => {
            setApiStatus(status);
        });
        
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(savedSessions));
    }, [savedSessions]);
    
    useEffect(() => {
        localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archivedSessions));
    }, [archivedSessions]);

    const handleCloudSaveComplete = async (url: string) => {
        if (!meetingMinutesHtml || !lastMeetingDetails) return;
        
        // Tìm xem session hiện tại đã có trong history chưa dựa trên nội dung HTML
        const existingIdx = savedSessions.findIndex(s => s.meetingMinutesHtml === meetingMinutesHtml);

        if (existingIdx !== -1) {
            // Cập nhật session hiện có
            const updated = [...savedSessions];
            updated[existingIdx] = { ...updated[existingIdx], cloudUrl: url };
            setSavedSessions(updated);
        } else {
            // Tạo mới và thêm vào history
            const newSession: SavedSession = {
                id: Date.now().toString(),
                createdAt: new Date().toISOString(),
                name: lastMeetingDetails.topic || "Biên bản họp",
                transcription: finalTranscription,
                meetingMinutesHtml: meetingMinutesHtml,
                meetingDetails: lastMeetingDetails,
                cloudUrl: url
            };
            setSavedSessions(prev => [newSession, ...prev]);
        }
        alert("✅ Đã đồng bộ Link Cloud vào Lịch sử biên bản của anh!");
    };

    const handleLoadSession = useCallback((sessionId: string) => {
        const session = savedSessions.find(s => s.id === sessionId) || archivedSessions.find(s => s.id === sessionId);
        if (session) {
            setError(null);
            setFinalTranscription(session.transcription);
            setMeetingMinutesHtml(session.meetingMinutesHtml);
            setLastMeetingDetails(session.meetingDetails);
            setFileQueue([]);
            setActiveTab('file');
            return true;
        }
        return false;
    }, [savedSessions, archivedSessions]);

    const handleLoadCloudUrl = async (url: string) => {
        setIsLoading(true);
        setStatusMessage("Đang tải tệp từ Cloud...");
        try {
            const response = await fetch(url);
            const html = await response.text();
            const details = parseMeetingDetailsFromHtml(html);
            
            setError(null);
            setFinalTranscription("Nội dung được nạp từ Cloud.");
            setMeetingMinutesHtml(html);
            setLastMeetingDetails(details);
            setActiveTab('file');
        } catch (err: any) {
            setError("Lỗi tải Cloud: " + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // --- Giữ nguyên các logic xử lý queue và generation cũ ---
    const handleFileSelect = (files: File[]) => {
        setFinalTranscription('');
        setMeetingMinutesHtml('');
        const newQueueItems: QueueItem[] = files.map(file => ({
            id: Math.random().toString(36).substr(2, 9),
            file: file,
            originalName: file.name,
            partIndex: 0,
            totalParts: 1,
            status: 'idle',
            transcription: null,
            isSelected: true,
        }));
        setFileQueue(prev => [...prev, ...newQueueItems]);
    };

    const handleProcessQueue = async () => {
        const items = fileQueue.filter(i => i.isSelected && i.status !== 'completed');
        if (items.length === 0) return;
        setIsLoading(true);
        cancelRequestRef.current = false;
        for (let item of items) {
            if (cancelRequestRef.current) break;
            setFileQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing' } : q));
            try {
                const text = await transcribeAudio(item.file, selectedModel, processingOptions);
                setFileQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'completed', transcription: text } : q));
            } catch (e: any) {
                setFileQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', errorMsg: e.message } : q));
            }
        }
        setIsLoading(false);
    };

    const handleGenerateMinutes = async (details: MeetingDetails) => {
        setIsGeneratingMinutes(true);
        setLastMeetingDetails(details);
        try {
            const html = await generateMeetingMinutes(finalTranscription, details, selectedModel);
            setMeetingMinutesHtml(html);
        } catch (e: any) { setMinutesError(e.message); }
        finally { setIsGeneratingMinutes(false); }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white selection:bg-cyan-500">
            <header className="bg-gray-800/80 backdrop-blur-md sticky top-0 z-50 border-b border-gray-700 shadow-lg">
                <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                        <div className="bg-gradient-to-r from-cyan-500 to-blue-600 p-2 rounded-lg"><RefreshIcon className="w-6 h-6 text-white" /></div>
                        <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Gemini Meeting Assistant</h1>
                        <span className="text-[10px] text-gray-500 border border-gray-700 rounded px-1.5 ml-2">Ver {APP_VERSION}</span>
                    </div>
                </div>
                
                <div className="max-w-7xl mx-auto px-4 flex space-x-6">
                    {[{ id: 'file', label: 'File Upload' }, { id: 'live', label: 'Live Recording' }, { id: 'history', label: 'History' }, { id: 'cloud', label: 'Cloud Storage' }].map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
                            {tab.label}
                        </button>
                    ))}
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
                {error && <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg flex justify-between"><span>{error}</span><button onClick={() => setError(null)}>✕</button></div>}

                <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6 min-h-[500px]">
                    {activeTab === 'file' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            <div className="lg:col-span-2 space-y-6">
                                <FileUpload onFileSelect={handleFileSelect} disabled={isLoading} />
                                <FileQueueList queue={fileQueue} onToggleSelect={(id) => setFileQueue(prev => prev.map(q => q.id === id ? { ...q, isSelected: !q.isSelected } : q))} onRemove={(id) => setFileQueue(prev => prev.filter(q => q.id !== id))} disabled={isLoading} />
                                {fileQueue.some(q => q.status === 'completed') && <TranscriptionMerger queue={fileQueue} onMerge={setFinalTranscription} />}
                            </div>
                            <div className="lg:col-span-1 space-y-4">
                                <ModelSelector onModelChange={setSelectedModel} disabled={isLoading} initialModel={selectedModel} />
                                <Options disabled={isLoading} options={processingOptions} onOptionChange={setProcessingOptions} />
                                <button onClick={handleProcessQueue} disabled={isLoading} className="w-full py-3.5 bg-blue-600 text-white font-bold rounded-xl">Bắt đầu xử lý</button>
                            </div>
                        </div>
                    )}
                    {activeTab === 'live' && <LiveTranscription onComplete={setFinalTranscription} disabled={isLoading} />}
                    {activeTab === 'history' && <SavedSessionsList sessions={savedSessions} onLoad={handleLoadSession} onDelete={(id) => setSavedSessions(p => p.filter(s => s.id !== id))} onPreview={setPreviewSession} onImport={() => {}} disabled={isLoading} />}
                    {activeTab === 'cloud' && <CloudStorage allSessions={[...savedSessions, ...archivedSessions]} onLoad={handleLoadSession} onDelete={() => {}} disabled={isLoading} />}
                </div>

                {finalTranscription && (
                    <div className="space-y-6">
                        <TranscriptionResult text={finalTranscription} />
                        <div className="border-t border-gray-700 pt-8">
                            <h2 className="text-xl font-bold text-purple-400 mb-4">Tạo Biên Bản</h2>
                            <MeetingMinutesGenerator onSubmit={handleGenerateMinutes} disabled={isGeneratingMinutes} initialDetails={lastMeetingDetails} />
                            {meetingMinutesHtml && <MeetingMinutesResult htmlContent={meetingMinutesHtml} onCloudSaved={handleCloudSaveComplete} />}
                        </div>
                    </div>
                )}
            </main>
            <ChatAssistant onExecuteAction={async () => {}} appContext="" />
        </div>
    );
};

export default App;
