
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { UploadIcon, MicrophoneIcon, StopIcon } from './icons';

interface FileUploadProps {
    onFileSelect: (files: File[]) => void;
    disabled: boolean;
}

// Helper to format seconds into a MM:SS string
const formatDuration = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, disabled }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerIntervalRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const handleFiles = useCallback((files: File[]) => {
        if (files && files.length > 0) {
            onFileSelect(files);
            // Reset input so same file can be selected again if needed
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [onFileSelect]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(Array.from(event.target.files || []));
    };

    const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
        event.preventDefault();
    }, []);
    
    const handleDrop = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
        event.preventDefault();
        if (disabled || isRecording) return;
        handleFiles(Array.from(event.dataTransfer.files));
    }, [disabled, isRecording, handleFiles]);


    // --- Recording Logic ---

    const stopRecordingCleanup = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }
        setIsRecording(false);
        setRecordingTime(0);
        audioChunksRef.current = [];
    }, []);

    const handleStartRecording = async () => {
        if (isRecording) return;
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                if (audioChunksRef.current.length > 0) {
                    const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
                    const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                    const fileExtension = mimeType.split('/')[1].split(';')[0];
                    const audioFile = new File([audioBlob], `recording-${Date.now()}.${fileExtension}`, { type: mimeType });
                    handleFiles([audioFile]);
                }
                stopRecordingCleanup();
            };

            mediaRecorder.start();
            setIsRecording(true);
            timerIntervalRef.current = window.setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);

        } catch (err) {
            console.error("Error accessing microphone:", err);
            alert("Could not access microphone. Please ensure permissions are granted.");
            stopRecordingCleanup();
        }
    };

    const handleStopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
        }
    };
    
    useEffect(() => {
        return () => {
            if (isRecording) stopRecordingCleanup();
        };
    }, [isRecording, stopRecordingCleanup]);


    const isBusy = disabled || isRecording;

    return (
        <div className="space-y-4">
            <label 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`group flex flex-col items-center justify-center w-full h-32 sm:h-40 px-4 transition-all duration-300 bg-gray-900/50 border-2 border-dashed rounded-xl appearance-none ${isBusy ? 'cursor-not-allowed opacity-50 border-gray-700' : 'cursor-pointer border-gray-600 hover:border-cyan-400 hover:bg-gray-900/80'}`}
            >
                <div className="flex flex-col items-center space-y-2 text-center">
                    <div className={`p-3 rounded-full bg-gray-800 group-hover:bg-cyan-900/30 transition-colors ${isBusy ? '' : 'text-cyan-400'}`}>
                        <UploadIcon className="w-8 h-8" />
                    </div>
                    <span className="font-medium text-gray-300 group-hover:text-white transition-colors">
                        <span className="hidden sm:inline">Drag & drop files or </span>
                        <span className="text-cyan-400 underline">Browse</span>
                    </span>
                    <span className="text-xs text-gray-500">Supports MP3, WAV, M4A, TXT, HTML (Auto-splits large files)</span>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    name="file_upload"
                    className="hidden"
                    multiple
                    onChange={handleFileChange}
                    accept="audio/*,text/plain,.txt,.md,.html,.htm"
                    disabled={isBusy}
                />
            </label>
            
            <div className="flex items-center gap-4">
                <div className="h-px bg-gray-700 flex-1"></div>
                <span className="text-gray-500 text-xs font-bold uppercase">OR</span>
                <div className="h-px bg-gray-700 flex-1"></div>
            </div>

            <div className="text-center">
                {isRecording ? (
                     <button
                        type="button"
                        onClick={handleStopRecording}
                        disabled={disabled}
                        className="w-full flex items-center justify-center gap-x-2 px-6 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg hover:bg-red-700 disabled:bg-gray-600 transition-all duration-300 animate-pulse"
                    >
                        <StopIcon className="w-5 h-5" />
                        <span>Stop Recording ({formatDuration(recordingTime)})</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={handleStartRecording}
                        disabled={disabled}
                        className="w-full flex items-center justify-center gap-x-2 px-6 py-3 bg-gray-700 text-gray-200 font-bold rounded-xl shadow hover:bg-gray-600 hover:text-white disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-all duration-300"
                    >
                         <MicrophoneIcon className="w-5 h-5" />
                        <span>Record Microphone</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default FileUpload;
