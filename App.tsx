
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
                // Found the label. The actual topic is likely in the text immediately following the colon,
                // or in the next sibling element of its parent.
                
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

// Helper to parse Meeting Details from HTML for import
const parseMeetingDetailsFromHtml = (html: string): MeetingDetails => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const text = tempDiv.innerText || tempDiv.textContent || '';
    
    // Helper to find text after a keyword line
    const extract = (keywords: string[]) => {
        // Create regex to find line starting with keyword
        // e.g., "Thời gian: 14h..." or "Thời gian & địa điểm: ..."
        for (const kw of keywords) {
            const regex = new RegExp(`${kw}.*?[:\\.]\\s*(.*?)(?=(?:\\n|$))`, 'i');
            const match = text.match(regex);
            if (match && match[1].trim()) return match[1].trim();
        }
        return '';
    };

    return {
        timeAndPlace: extract(['Thời gian', 'Địa điểm', 'Thời gian & địa điểm']),
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

// Reduced chunk size to 6MB to prevent "Array buffer allocation failed" and ensure processed WAVs fits in API limit.
// 6MB MP3 ~ 11MB WAV (16kHz mono) ~ 15MB Base64. Safe for Gemini API (20MB limit).
const CHUNK_SIZE = 6 * 1024 * 1024; 

const App: React.FC = () => {
    // Key used to force full component remount on refresh
    const [refreshKey, setRefreshKey] = useState(0);

    const [activeTab, setActiveTab] = useState<'file' | 'live' | 'history' | 'cloud'>('file');
    
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
    const [archivedSessions, setArchivedSessions] = useState<SavedSession[]>([]);
    const [previewSession, setPreviewSession] = useState<SavedSession | null>(null);

    const cancelRequestRef = useRef<boolean>(false);


    // Load history from localStorage on initial render
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

    // Save history to localStorage whenever it changes
    useEffect(() => {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(savedSessions));
        } catch (error) {
            console.error("Failed to save history to localStorage", error);
        }
    }, [savedSessions]);
    
    // Save archive to localStorage
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
        // Try finding in both local and archive
        const sessionToLoad = savedSessions.find(s => s.id === sessionId) || archivedSessions.find(s => s.id === sessionId);
        if (sessionToLoad) {
            resetState();
            setFinalTranscription(sessionToLoad.transcription);
            setMeetingMinutesHtml(sessionToLoad.meetingMinutesHtml);
            setLastMeetingDetails(sessionToLoad.meetingDetails);
            setFileQueue([]); // Clear file queue
            setActiveTab('file'); // Switch back to the main view
        }
    };
    
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

    const handleArchiveSession = (sessionId: string) => {
        const session = savedSessions.find(s => s.id === sessionId);
        if (session) {
            setArchivedSessions(prev => [session, ...prev]);
            setSavedSessions(prev => prev.filter(s => s.id !== sessionId));
            // Optional: Provide visual feedback
            alert("Đã chuyển biên bản sang kho lưu trữ 'Cloud' thành công.");
        }
    };
    
    const handleImportDatabase = async (file: File) => {
        try {
            const text = await file.text();
            const importedData = JSON.parse(text) as SavedSession[];
            if (Array.isArray(importedData)) {
                // Merge strategies:
                // 1. Overwrite? No, risky.
                // 2. Append unique items based on ID? Yes.
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
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5), // Unique ID
                    createdAt: new Date().toISOString(),
                    name: `${extractedTopic} (Đã nhập)`,
                    transcription: "Phiên này được nhập từ file HTML. Dữ liệu lời thoại gốc không khả dụng để chỉnh sửa AI.",
                    meetingMinutesHtml: text,
                    meetingDetails: details,
                };
                newSessions.push(newSession);
            } catch (err) {
                console.error("Error parsing imported file:", file.name, err);
                alert(`Không thể đọc file: ${file.name}`);
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
                    
                    // Check for HTML files based on MIME type or extension
                    const isHtml = item.file.type === 'text/html' || item.file.name.toLowerCase().endsWith('.html') || item.file.name.toLowerCase().endsWith('.htm');

                    if (isHtml) {
                        setStatusMessage(`Extracting text from HTML: ${item.file.name}...`);
                        const htmlContent = await item.file.text();
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = htmlContent;
                        // Extract plain text
                        resultText = tempDiv.textContent || tempDiv.innerText || "";
                        // Normalize whitespace (optional, but good for cleaning up extraction artifacts)
                        resultText = resultText.replace(/\s+/g, ' ').trim();
                    } else if (item.file.type.startsWith('text/') || item.file.name.toLowerCase().endsWith('.txt') || item.file.name.toLowerCase().endsWith('.md')) {
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

    const handleRefreshApp = () => {
        const hasData = fileQueue.length > 0 || finalTranscription || meetingMinutesHtml;
        if (hasData) {
             if (!window.confirm("Bạn có chắc chắn muốn làm mới ứng dụng? Mọi dữ liệu chưa lưu sẽ bị mất.")) {
                return;
            }
        }
        
        // Cancel any running processes
        if (isBusy) {
            cancelRequestRef.current = true;
        }

        // Reset all state
        setFileQueue([]);
        setFinalTranscription('');
        setMeetingMinutesHtml('');
        setLastMeetingDetails(null);
        setError(null);
        setProgress(0);
        setStatusMessage('');
        setIsLoading(false);
        setIsGeneratingMinutes(false);
        setMinutesError(null);
        setMinutesGenerationProgress(0);
        setMinutesGenerationStatus('');
        setIsEditingMinutes(false);
        setEditError(null);
        setEditProgress(0);
        setEditStatusMessage('');
        setIsDiarizing(false);
        setDiarizationError(null);
        setDiarizationProgress(0);
        setActiveTab('file');

        // Reset options to default
         setProcessingOptions({
            convertToMono16kHz: true,
            noiseReduction: true,
            normalizeVolume: true,
            removeSilence: true,
            identifySpeakers: true,
        });
        setSelectedModel('gemini-2.5-pro');
        
        // Force remount of components
        setRefreshKey(prev => prev + 1);
        
        // Reset cancel ref after a short delay
        setTimeout(() => {
            cancelRequestRef.current = false;
        }, 100);
    };

    const TabButton: React.FC<{ tabName: 'file' | 'live' | 'history' | 'cloud'; children: React.ReactNode }> = ({ tabName, children }) => (
        <button
            onClick={() => setActiveTab(tabName)}
            disabled={isBusy}
            className={`flex-1 sm:flex-none px-4 py-3 sm:py-2 text-sm font-semibold rounded-t-lg transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${activeTab === tabName ? 'bg-gray-800 text-cyan-400 border-t-2 border-cyan-500' : 'bg-transparent text-gray-400 hover:bg-gray-800/50 hover:text-white border-t-2 border-transparent'}`}
        >
            {children}
        </button>
    );

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 font-sans antialiased selection:bg-cyan-500 selection:text-white pb-12">
             <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 relative">
                {/* Refresh Button */}
                <div className="absolute top-6 right-4 sm:right-8 z-20">
                    <button
                        onClick={handleRefreshApp}
                        className="flex items-center gap-2 px-3 py-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-600 transition-all shadow-sm backdrop-blur-sm group"
                        title="Bắt đầu phiên mới (Xóa dữ liệu hiện tại)"
                    >
                        <RefreshIcon className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
                        <span className="hidden sm:inline font-medium text-sm">Làm mới</span>
                    </button>
                </div>

                <header className="text-center mb-10">
                    <h1 className="text-3xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 tracking-tight pb-2">
                        Gemini Meeting Assistant
                    </h1>
                    <p className="text-gray-400 mt-2 text-sm sm:text-base max-w-2xl mx-auto">
                        Transcribe audio, analyze conversations, and generate professional minutes with AI.
                    </p>
                    <p className="text-cyan-500 font-medium mt-3 text-sm tracking-wide">
                        Đây là sản phẩm của Mr Cường
                    </p>
                </header>
                
                <main className="space-y-8" key={refreshKey}>
                     <div className="bg-gray-800 rounded-2xl shadow-xl border border-gray-700 overflow-hidden">
                        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-700 bg-gray-800/50 backdrop-blur-sm">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-900 text-cyan-400 text-xs">1</span>
                                Input Source
                            </h2>
                            <span className="px-2 py-0.5 rounded text-xs font-mono bg-gray-700 text-gray-300">v2.2</span>
                        </div>
                        
                        <div className="flex border-b border-gray-700 bg-gray-900/30 overflow-x-auto">
                           <TabButton tabName="file">Upload Files</TabButton>
                           <TabButton tabName="live">Live Audio</TabButton>
                           <TabButton tabName="history">History</TabButton>
                           <TabButton tabName="cloud">Cloud / Archive</TabButton>
                        </div>

                        <div className="p-6 sm:p-8 bg-gray-800 transition-all">
                            {activeTab === 'file' ? (
                                <div className="space-y-6">
                                    <FileUpload onFileSelect={handleFileSelect} disabled={isBusy} />
                                    <FileQueueList 
                                        queue={fileQueue} 
                                        onToggleSelect={handleToggleQueueItem}
                                        onRemove={handleRemoveQueueItem}
                                        disabled={isBusy} 
                                    />
                                </div>
                            ) : activeTab === 'live' ? (
                                <LiveTranscription onComplete={handleLiveTranscriptionComplete} disabled={isBusy} />
                            ) : activeTab === 'history' ? (
                                <SavedSessionsList
                                    sessions={savedSessions}
                                    onLoad={handleLoadSession}
                                    onDelete={handleDeleteSession}
                                    onArchive={handleArchiveSession}
                                    onPreview={handlePreviewSession}
                                    onImport={handleImportSession}
                                    disabled={isBusy}
                                />
                            ) : (
                                <CloudStorage
                                    sessions={archivedSessions}
                                    onLoad={handleLoadSession}
                                    onDelete={handleDeleteArchivedSession}
                                    onPreview={handlePreviewSession}
                                    onImportDatabase={handleImportDatabase}
                                    disabled={isBusy}
                                />
                            )}
                        </div>
                    </div>
                    
                    {activeTab === 'file' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                             <div className="bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-700 flex flex-col h-full">
                                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-900 text-cyan-400 text-xs">2</span>
                                    Audio Options
                                </h2>
                                <div className="flex-grow">
                                    <Options 
                                        disabled={isBusy} 
                                        options={processingOptions}
                                        onOptionChange={setProcessingOptions}
                                    />
                                </div>
                            </div>

                             <div className="bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-700 flex flex-col h-full">
                                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-900 text-cyan-400 text-xs">3</span>
                                    AI Model
                                </h2>
                                <div className="flex-grow">
                                    <ModelSelector 
                                        initialModel={selectedModel}
                                        onModelChange={setSelectedModel} 
                                        disabled={isBusy}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'file' && (
                         <div className="text-center py-2">
                            <button
                                onClick={handleProcessQueue}
                                disabled={selectedCount === 0 || isBusy}
                                className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-cyan-600 to-cyan-500 text-white font-bold rounded-xl shadow-lg hover:shadow-cyan-500/20 hover:from-cyan-500 hover:to-cyan-400 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 text-lg"
                            >
                                {isLoading 
                                    ? 'Processing Queue...' 
                                    : `▶️ Process ${selectedCount} Selected File(s)`}
                            </button>
                            {error && (
                                <div className="mt-6 p-4 bg-red-900/30 border border-red-500/50 text-red-200 rounded-lg text-center backdrop-blur-sm animate-fade-in">
                                    <p className="font-bold">Error encountered:</p>
                                    <p className="text-sm opacity-90">{error}</p>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {isLoading && (
                         <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl animate-fade-in">
                            <div className="space-y-4">
                                <ProgressBar progress={progress} message={statusMessage} />
                                <div className="text-center pt-2">
                                    <button 
                                        onClick={handleCancel}
                                        className="px-6 py-2 bg-red-600/20 text-red-400 border border-red-900/50 font-semibold rounded-lg hover:bg-red-600/30 transition-all"
                                    >
                                        Cancel Operation
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Section 4: Transcription Results & Tools */}
                    {(hasProcessedFiles || finalTranscription) && (
                         <div className="bg-gray-800 p-6 sm:p-8 rounded-2xl border border-gray-700 shadow-xl space-y-6" id="transcription-result-area">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2 border-b border-gray-700 pb-4">
                                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-cyan-900 text-cyan-400 text-sm">4</span>
                                Transcription &amp; Tools
                            </h2>
                            
                            {/* Merger Tool for File Mode */}
                            {activeTab === 'file' && hasProcessedFiles && (
                                <TranscriptionMerger 
                                    queue={fileQueue}
                                    onMerge={handleMergeTranscription}
                                />
                            )}
                            
                            {/* Final Editable Transcription Area */}
                            {finalTranscription && (
                                <div className="space-y-6 animate-fade-in">
                                    <div>
                                        <div className="flex justify-between items-end mb-2">
                                            <p className="text-sm font-semibold text-gray-300">Final Text (Editable)</p>
                                        </div>
                                        <TranscriptionResult text={finalTranscription} />
                                    </div>

                                    <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-700">
                                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
                                            <div className="text-center sm:text-left">
                                                <h3 className="font-semibold text-white">Speaker Identification</h3>
                                                <p className="text-xs text-gray-400">Ask AI to label speakers (e.g., [SPEAKER 1] → John)</p>
                                            </div>
                                            <button
                                                onClick={handleIdentifySpeakers}
                                                disabled={isBusy}
                                                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-yellow-600/90 hover:bg-yellow-600 text-white font-bold rounded-lg shadow hover:shadow-yellow-900/20 disabled:bg-gray-700 disabled:text-gray-500 transition-all"
                                            >
                                                <UsersIcon className="w-5 h-5" />
                                                {isDiarizing ? 'Analyzing...' : 'Identify Speakers'}
                                            </button>
                                        </div>
                                        
                                        {isDiarizing && <div className="mt-3"><ProgressBar progress={diarizationProgress} message="Analyzing conversation patterns..." /></div>}
                                        {diarizationError && <p className="text-red-400 mt-2 text-sm text-center">{diarizationError}</p>}
                                        
                                        <SpeakerNamer
                                            transcription={finalTranscription}
                                            onUpdateTranscription={handleUpdateTranscription}
                                            disabled={isBusy}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}


                    {/* Section 5: Minutes Generation */}
                    {!isLoading && finalTranscription && (
                         <div className="bg-gray-800 p-6 sm:p-8 rounded-2xl border border-gray-700 shadow-xl space-y-6">
                             <h2 className="text-xl font-bold text-white flex items-center gap-2 border-b border-gray-700 pb-4">
                                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-purple-900 text-purple-400 text-sm">5</span>
                                Generate Meeting Minutes
                            </h2>
                            
                            {isGeneratingMinutes ? (
                                    <div className="text-center space-y-4 p-8 bg-gray-900/30 rounded-xl border border-gray-700 border-dashed">
                                    <ProgressBar progress={minutesGenerationProgress} message={minutesGenerationStatus} />
                                    <button 
                                        onClick={handleCancel}
                                        className="px-6 py-2 bg-red-600/20 text-red-400 border border-red-900/50 font-semibold rounded-lg hover:bg-red-600/30 transition-all"
                                    >
                                        Cancel Generation
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <MeetingMinutesGenerator 
                                        onSubmit={handleGenerateMinutes} 
                                        disabled={isGeneratingMinutes || isEditingMinutes}
                                        initialDetails={lastMeetingDetails}
                                    />
                                    {minutesError && <div className="p-4 bg-red-900/20 border border-red-500/30 text-red-300 rounded-lg text-center text-sm">{minutesError}</div>}
                                </>
                            )}
                        </div>
                    )}
                    
                    {!isGeneratingMinutes && meetingMinutesHtml && (
                        <>
                             <div className="bg-gray-800 p-6 sm:p-8 rounded-2xl border border-gray-700 shadow-xl space-y-6">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2 border-b border-gray-700 pb-4">
                                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-purple-900 text-purple-400 text-sm">6</span>
                                    Result
                                </h2>
                                <MeetingMinutesResult htmlContent={meetingMinutesHtml} />
                            </div>
                    
                            <div className="bg-gray-800 p-6 sm:p-8 rounded-2xl border border-gray-700 shadow-xl space-y-6">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2 border-b border-gray-700 pb-4">
                                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-green-900 text-green-400 text-sm">7</span>
                                    AI Editor
                                </h2>
                                {isEditingMinutes ? (
                                    <div className="text-center space-y-4 p-8 bg-gray-900/30 rounded-xl border border-gray-700 border-dashed">
                                        <ProgressBar progress={editProgress} message={editStatusMessage} />
                                        <button 
                                            onClick={handleCancel}
                                            className="px-6 py-2 bg-red-600/20 text-red-400 border border-red-900/50 font-semibold rounded-lg hover:bg-red-600/30 transition-all"
                                        >
                                            Cancel Edit
                                        </button>
                                    </div>
                                ) : (
                                    <EditRequest
                                        onSubmit={handleRequestEdits}
                                        disabled={isEditingMinutes}
                                    />
                                )}
                                {editError && <p className="text-red-400 mt-2 text-center text-sm">{editError}</p>}
                            </div>
                        </>
                    )}

                </main>
                 <footer className="text-center mt-12 pb-6 border-t border-gray-800 pt-8">
                    <a href="https://github.com/google/gemini-api" target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-gray-500 hover:text-cyan-400 transition-colors gap-2 text-sm font-medium">
                        <GithubIcon className="w-5 h-5" />
                        Built with Google Gemini API
                    </a>
                </footer>
                
                {/* Preview Modal */}
                {previewSession && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
                        <div className="bg-gray-800 w-full max-w-5xl h-[90vh] rounded-xl flex flex-col border border-gray-700 shadow-2xl">
                            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-700 bg-gray-900/50 rounded-t-xl">
                                <div>
                                    <h3 className="text-lg font-bold text-white truncate max-w-lg">{previewSession.name}</h3>
                                    <p className="text-xs text-gray-400">Xem trước biên bản</p>
                                </div>
                                <button 
                                    onClick={() => setPreviewSession(null)}
                                    className="p-2 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div className="flex-1 overflow-hidden p-6 bg-gray-800">
                                <MeetingMinutesResult 
                                    htmlContent={previewSession.meetingMinutesHtml} 
                                    className="h-full"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
