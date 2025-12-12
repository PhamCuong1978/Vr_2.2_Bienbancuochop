
import React, { useState, useRef, useEffect } from 'react';
import { ChatBubbleIcon, SendIcon, XMarkIcon, MicrophoneIcon, SparklesIcon, PaperClipIcon } from './icons';
import { Chat, GenerateContentResponse, Part } from "@google/genai";
import { startChatSession } from '../services/geminiService';

interface ChatAssistantProps {
    onExecuteAction: (actionName: string, args: any) => Promise<any>;
    appContext: string; // JSON string containing simplified session info
}

interface Message {
    id: string;
    role: 'user' | 'model';
    text: string;
    attachments?: { name: string; type: string }[];
}

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data:image/png;base64, prefix
            resolve(result.split(',')[1]);
        };
        reader.onerror = error => reject(error);
    });
};

const ChatAssistant: React.FC<ChatAssistantProps> = ({ onExecuteAction, appContext }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [attachments, setAttachments] = useState<File[]>([]);
    
    const chatSessionRef = useRef<Chat | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Refs for click-outside detection
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const fabRef = useRef<HTMLDivElement>(null);

    // Initialize Chat Session
    useEffect(() => {
        if (!chatSessionRef.current) {
            try {
                chatSessionRef.current = startChatSession();
                // Initial greeting
                setMessages([{
                    id: 'init',
                    role: 'model',
                    text: 'Em chào anh Cường! Anh muốn gì ở em???'
                }]);
            } catch (e) {
                console.error("Failed to init chat", e);
            }
        }
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen, attachments.length]);

    // Handle click outside to close chat
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                isOpen &&
                chatWindowRef.current &&
                !chatWindowRef.current.contains(event.target as Node) &&
                fabRef.current &&
                !fabRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setAttachments(prev => [...prev, ...Array.from(e.target.files || [])]);
        }
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        const newFiles: File[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                if (file) {
                    newFiles.push(file);
                }
            }
        }

        if (newFiles.length > 0) {
            setAttachments(prev => [...prev, ...newFiles]);
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleSendMessage = async () => {
        if ((!inputValue.trim() && attachments.length === 0) || !chatSessionRef.current) return;

        const currentAttachments = [...attachments];
        const currentInput = inputValue;
        
        // Optimistic UI Update
        const userMsg: Message = { 
            id: Date.now().toString(), 
            role: 'user', 
            text: currentInput,
            attachments: currentAttachments.map(f => ({ name: f.name, type: f.type })) 
        };
        
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setAttachments([]);
        setIsThinking(true);

        try {
            const parts: Part[] = [];
            
            // Add system context as a text part if it's the first message or if context changed (simplified here)
            // Ideally, we'd only send context if it changed or periodically.
            // For now, let's prepend it to the text if it exists.
            let fullText = currentInput;
            if (appContext) {
                 fullText = `[Context Update: ${appContext}] \n\n ${currentInput}`;
            }

            // Add text part
            if (fullText.trim()) {
                parts.push({ text: fullText });
            }

            // Process attachments into InlineData parts
            for (const file of currentAttachments) {
                try {
                    const base64Data = await fileToBase64(file);
                    parts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: file.type
                        }
                    });
                } catch (e) {
                    console.error("Failed to process file", file.name, e);
                    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: `Lỗi khi xử lý file: ${file.name}` }]);
                    setIsThinking(false);
                    return;
                }
            }
            
            // Send the array of parts
            let response = await chatSessionRef.current.sendMessage({ message: parts });
            
            // Handle Function Calling Loop
            while (response.functionCalls && response.functionCalls.length > 0) {
                const functionResponseParts = [];
                for (const call of response.functionCalls) {
                    console.log("AI calling tool:", call.name, call.args);
                    let result;
                    try {
                        result = await onExecuteAction(call.name, call.args);
                    } catch (err: any) {
                        result = { error: err.message };
                    }
                    
                    functionResponseParts.push({
                        functionResponse: {
                            id: call.id,
                            name: call.name,
                            response: { result: result }
                        }
                    });
                }
                
                // Send tool results back to model
                response = await chatSessionRef.current.sendMessage({ message: functionResponseParts });
            }

            const modelText = response.text || "Em đã thực hiện xong ạ!";
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: modelText }]);

        } catch (error) {
            console.error("Chat error:", error);
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "Oops, em bị lỗi rồi anh ơi. Thử lại nhé!" }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // --- Voice Input ---
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);

    const toggleListening = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
        } else {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.lang = 'vi-VN';
                recognition.continuous = false;
                recognition.onresult = (event: any) => {
                    const transcript = event.results[0][0].transcript;
                    setInputValue(prev => prev + (prev ? ' ' : '') + transcript);
                    setIsListening(false);
                };
                recognition.onerror = () => setIsListening(false);
                recognition.onend = () => setIsListening(false);
                recognitionRef.current = recognition;
                recognition.start();
                setIsListening(true);
            } else {
                alert("Browser does not support speech recognition");
            }
        }
    };


    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end pointer-events-none">
            {/* Chat Window */}
            <div 
                ref={chatWindowRef}
                className={`pointer-events-auto bg-white rounded-2xl shadow-2xl border border-gray-200 w-[360px] sm:w-[400px] mb-4 overflow-hidden transition-all duration-300 origin-bottom-right transform ${isOpen ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-10 pointer-events-none h-0'}`}
                style={{ maxHeight: '650px', display: isOpen ? 'flex' : 'none', flexDirection: 'column' }}
            >
                {/* Header */}
                <div className="bg-blue-600 p-4 flex justify-between items-center text-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-white/20 p-2 rounded-full">
                            <ChatBubbleIcon className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-bold text-base">AI của anh Cường</h3>
                            <p className="text-xs text-blue-200">Trợ lý ảo thông minh</p>
                        </div>
                    </div>
                    <button onClick={() => setIsOpen(false)} className="hover:bg-blue-700 p-1 rounded transition">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 bg-gray-50 h-[400px] space-y-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <div 
                                className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                                    msg.role === 'user' 
                                    ? 'bg-blue-600 text-white rounded-br-none' 
                                    : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'
                                }`}
                            >
                                {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="mb-2 space-y-1">
                                        {msg.attachments.map((att, idx) => (
                                            <div key={idx} className="flex items-center gap-2 bg-black/10 p-1.5 rounded text-xs">
                                                 <PaperClipIcon className="w-3 h-3" />
                                                 <span className="truncate max-w-[150px]">{att.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    {isThinking && (
                        <div className="flex justify-start">
                            <div className="bg-white p-3 rounded-2xl rounded-bl-none border border-gray-100 shadow-sm flex gap-1">
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75"></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150"></div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-3 bg-white border-t border-gray-100 shrink-0">
                    
                    {/* Attachments Preview */}
                    {attachments.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto pb-2 mb-2 px-1">
                            {attachments.map((file, idx) => (
                                <div key={idx} className="relative group shrink-0">
                                    <div className="w-16 h-16 bg-gray-100 border rounded-lg flex flex-col items-center justify-center p-1 text-center">
                                         {file.type.startsWith('image/') ? (
                                             <img 
                                                src={URL.createObjectURL(file)} 
                                                alt="preview" 
                                                className="w-full h-full object-cover rounded" 
                                             />
                                         ) : (
                                            <>
                                                <PaperClipIcon className="w-5 h-5 text-gray-400 mb-1" />
                                                <span className="text-[9px] text-gray-500 leading-tight w-full truncate">{file.name}</span>
                                            </>
                                         )}
                                    </div>
                                    <button 
                                        onClick={() => removeAttachment(idx)}
                                        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 shadow-md hover:bg-red-600"
                                    >
                                        <XMarkIcon className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center gap-2 bg-gray-100 rounded-3xl px-3 py-2 border border-gray-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            className="hidden" 
                            onChange={handleFileSelect} 
                            multiple 
                            accept="image/*,audio/*,text/*,application/pdf"
                        />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="p-1.5 rounded-full text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Attach file"
                        >
                            <PaperClipIcon className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={toggleListening}
                            className={`p-1.5 rounded-full transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            <MicrophoneIcon className="w-5 h-5" />
                        </button>
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder="Nhập yêu cầu (hoặc dán ảnh Ctrl+V)..."
                            className="flex-1 bg-transparent border-none outline-none text-gray-700 text-sm placeholder-gray-400 min-w-0"
                        />
                        <button 
                            onClick={handleSendMessage}
                            disabled={(!inputValue.trim() && attachments.length === 0) || isThinking}
                            className="p-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                            <SendIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Floating Action Button (FAB) */}
            <div 
                ref={fabRef}
                className="pointer-events-auto group flex items-center gap-3 cursor-pointer" 
                onClick={() => setIsOpen(!isOpen)}
            >
                {/* Hover Label */}
                <div className={`bg-white text-blue-700 font-bold px-4 py-2 rounded-full shadow-lg border border-blue-100 transition-all duration-300 transform origin-right ${isOpen ? 'opacity-0 scale-90 hidden' : 'opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0'}`}>
                    AI của anh Cường
                </div>
                
                {/* Button Icon */}
                <button 
                    className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 transform hover:scale-110 ${isOpen ? 'bg-gray-200 text-gray-600 rotate-90' : 'bg-blue-600 text-white'}`}
                >
                    {isOpen ? <XMarkIcon className="w-6 h-6" /> : <ChatBubbleIcon className="w-7 h-7" />}
                </button>
            </div>
        </div>
    );
};

export default ChatAssistant;
