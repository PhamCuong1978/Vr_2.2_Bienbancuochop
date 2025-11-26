
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
        <div>
            <label 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center w-full h-32 px-4 transition bg-gray-700 border-2 border-gray-600 border-dashed rounded-md appearance-none ${isBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-cyan-400'}`}
            >
                <span className="flex items-center space-x-2">
                    <UploadIcon className="w-6 h-6 text-gray-400" />
                    <span className="font-medium text-gray-300">
                        Drop files (auto-splits {'>'}100MB), or <span className="text-cyan-400 underline">browse</span>
                    </span>
                </span>
                <input
                    ref={fileInputRef}
                    type="file"
                    name="file_upload"
                    className="hidden"
                    multiple
                    onChange={handleFileChange}
                    accept="audio/*,text/plain,.txt,.md"
                    disabled={isBusy}
                />
            </label>
            
            <div className="flex items-center my-4">
                <div className="flex-grow border-t border-gray-600"></div>
                <span className="flex-shrink mx-4 text-gray-400 text-sm font-semibold">OR</span>
                <div className="flex-grow border-t border-gray-600"></div>
            </div>

            <div className="text-center">
                {isRecording ? (
                     <button
                        type="button"
                        onClick={handleStopRecording}
                        disabled={disabled}
                        className="w-full sm:w-auto flex items-center justify-center gap-x-3 px-6 py-2 bg-red-600 text-white font-bold rounded-lg shadow-lg hover:bg-red-700 disabled:bg-gray-600 transition-all duration-300"
                    >
                        <StopIcon className="w-5 h-5" />
                        <span>Stop Recording ({formatDuration(recordingTime)})</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={handleStartRecording}
                        disabled={disabled}
                        className="w-full sm:w-auto flex items-center justify-center gap-x-3 px-6 py-2 bg-gray-600 text-white font-bold rounded-lg shadow-lg hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-all duration-300"
                    >
                         <MicrophoneIcon className="w-5 h-5" />
                        <span>Record with Microphone</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default FileUpload;
