import { GoogleGenAI, Modality, FunctionDeclaration, Type, Chat, GenerateContentResponse } from "@google/genai";
import { MeetingDetails } from "../components/MeetingMinutesGenerator";
import { ProcessingOptions } from "../components/Options";

// --- Multi-Key & Fallback State Management ---

let apiKeys: string[] = [];
let currentKeyIndex = 0;
let currentActiveModel = ''; // Track which model is actually being used
type StatusListener = (status: { keyIndex: number; model: string; isFallback: boolean }) => void;
const listeners: StatusListener[] = [];

// Helper to broadcast status changes to UI
const broadcastStatus = (model: string, isFallback: boolean) => {
    currentActiveModel = model;
    listeners.forEach(l => l({ 
        keyIndex: currentKeyIndex, 
        model: model, 
        isFallback 
    }));
};

export const subscribeToStatus = (listener: StatusListener) => {
    listeners.push(listener);
    // Send immediate update
    listener({ keyIndex: currentKeyIndex, model: currentActiveModel, isFallback: false });
    return () => {
        const idx = listeners.indexOf(listener);
        if (idx > -1) listeners.splice(idx, 1);
    };
};

// Initialize Keys
const initializeKeys = () => {
    let rawKeys = '';
    // 1. Check standard process.env
    if (typeof process !== 'undefined' && process.env) {
        if (process.env.API_KEY) rawKeys = process.env.API_KEY;
        else if (process.env.VITE_API_KEY) rawKeys = process.env.VITE_API_KEY;
    }
    // 2. Check Vite Client-side
    // @ts-ignore
    if (!rawKeys && typeof import.meta !== 'undefined' && import.meta.env) {
         // @ts-ignore
        if (import.meta.env.VITE_API_KEY) rawKeys = import.meta.env.VITE_API_KEY;
         // @ts-ignore
        else if (import.meta.env.API_KEY) rawKeys = import.meta.env.API_KEY;
    }

    if (rawKeys) {
        // Split by comma and trim whitespace
        apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
    }
};

// Call init immediately
initializeKeys();

const getCurrentApiKey = (): string | undefined => {
    if (apiKeys.length === 0) initializeKeys();
    if (apiKeys.length === 0) return undefined;
    return apiKeys[currentKeyIndex];
};

const rotateKey = () => {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`Switched to API Key #${currentKeyIndex + 1}`);
};

// Fallback mapping
const FALLBACK_MODEL_MAP: Record<string, string> = {
    'gemini-2.5-pro': 'gemini-2.5-flash',
    'gemini-1.5-pro': 'gemini-1.5-flash',
    // Add others if needed
};

// --- Smart Execution Logic ---

const executeGeminiCall = async <T>(
    requestedModel: string,
    operation: (ai: GoogleGenAI, effectiveModel: string) => Promise<T>
): Promise<T> => {
    const startKeyIndex = currentKeyIndex;
    let attempts = 0;
    const maxAttempts = apiKeys.length * 2; // Allow full rotation for primary model, then full rotation for fallback
    
    let effectiveModel = requestedModel;
    let isFallback = false;

    // Helper to get client
    const getClient = () => {
        const key = getCurrentApiKey();
        if (!key) throw new Error("API_KEY not found. Please check your .env or Vercel settings.");
        return new GoogleGenAI({ apiKey: key });
    };

    while (attempts < maxAttempts) {
        try {
            // Notify UI of current attempt state
            broadcastStatus(effectiveModel, isFallback);

            const ai = getClient();
            return await operation(ai, effectiveModel);

        } catch (error: any) {
            const message = error?.message?.toLowerCase() || '';
            const status = error?.status;
            
            // Check for Quota/Rate Limit (429) or Authentication errors
            const isQuotaError = message.includes('429') || 
                                 message.includes('quota') || 
                                 message.includes('resource_exhausted') || 
                                 status === 'RESOURCE_EXHAUSTED';
            
            const isAuthError = message.includes('api key not valid') || message.includes('403');

            if (isQuotaError || isAuthError) {
                console.warn(`Error with Key #${currentKeyIndex + 1} (${effectiveModel}): ${message}. Rotating key...`);
                rotateKey();
                attempts++;

                // If we have tried all keys for the current model
                // (Checking if we looped back to start index, roughly)
                const completedFullRotation = attempts % apiKeys.length === 0;

                if (completedFullRotation) {
                    // Check if we can fallback
                    if (FALLBACK_MODEL_MAP[effectiveModel]) {
                        console.warn(`All keys exhausted for ${effectiveModel}. Falling back to ${FALLBACK_MODEL_MAP[effectiveModel]}`);
                        effectiveModel = FALLBACK_MODEL_MAP[effectiveModel];
                        isFallback = true;
                        // Continue loop with new model and next key
                    } else {
                        // No fallback available or already on Flash, and all keys failed
                        if (attempts >= maxAttempts) throw error;
                    }
                }
                
                // Small delay before retry to prevent tight loop hammering
                await new Promise(res => setTimeout(res, 500));
                continue;
            }

            // If it's another error (e.g. 500 server error, payload too large), typical retry logic or throw
            // Here we re-use the generic error handler logic but inside this smart wrapper we just throw
            // and let the caller handle format.
            throw error;
        }
    }
    throw new Error("All API keys and fallback models exhausted.");
};


// --- Original Helpers ---

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = error => reject(error);
    });
};

const handleGeminiError = (error: unknown): Error => {
    let message = "An unknown error occurred.";
    if (error instanceof Error) message = error.message;
    else if (typeof error === 'object' && error !== null) {
        try { message = (error as any).message || JSON.stringify(error); } catch { message = String(error); }
    } else message = String(error);
    
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('quota') || lowerMessage.includes('429')) return new Error("All API keys exhausted their quota. Please check billing.");
    
    return new Error(message);
};

// --- Exported Functions (Wrapped with Smart Execution) ---

export const transcribeAudio = async (file: File, modelName: string, options?: ProcessingOptions): Promise<string> => {
    try {
        const audioData = await fileToBase64(file);
        const mimeType = file.type;

        return await executeGeminiCall(modelName, async (ai, effectiveModel) => {
            const audioPart = { inlineData: { mimeType, data: audioData } };

            let textPrompt = `
NHIỆM VỤ: Chuyển đổi tệp âm thanh này thành văn bản (Transcript) Tiếng Việt.
YÊU CẦU:
1. NGÔN NGỮ: Chỉ xuất ra Tiếng Việt.
2. ĐỊNH DẠNG: Tách đoạn rõ ràng.`;

            if (options?.identifySpeakers) {
                textPrompt += `
3. NHẬN DIỆN NGƯỜI NÓI:
   - Gán nhãn: "[NGƯỜI NÓI 1]:", "[NGƯỜI NÓI 2]:"...
   - ${options.speakerCount ? `Cuộc họp có khoảng ${options.speakerCount} người.` : ''}`;
            }

            const response = await ai.models.generateContent({
                model: effectiveModel,
                contents: { parts: [audioPart, { text: textPrompt }] },
            });
            return response.text || "";
        });
    } catch (error) {
        console.error("Transcription failed:", error);
        throw handleGeminiError(error);
    }
};

export const identifySpeakers = async (transcription: string, modelName: string, speakerCount?: number): Promise<string> => {
    try {
        return await executeGeminiCall(modelName, async (ai, effectiveModel) => {
            let prompt = `Bạn là chuyên gia phân tích hội thoại. Gán nhãn người nói ([NGƯỜI NÓI X]:) vào văn bản sau.`;
            if (speakerCount) prompt += ` Số lượng người: ${speakerCount}.`;
            prompt += `\n\n---\n${transcription}\n---`;

            const response = await ai.models.generateContent({
                model: effectiveModel,
                contents: { parts: [{ text: prompt }] },
            });
            return response.text || "";
        });
    } catch (error) {
        throw handleGeminiError(error);
    }
};

export const generateMeetingMinutes = async (transcription: string, details: MeetingDetails, modelName: string): Promise<string> => {
    try {
        return await executeGeminiCall(modelName, async (ai, effectiveModel) => {
             const promptTemplate = `Lập BIÊN BẢN CUỘC HỌP chuyên nghiệp (Tiếng Việt) từ nội dung sau.
Kết cấu: HTML Inline CSS đẹp.
A. Thông tin chung (Lấy từ metadata).
B. Thảo luận chi tiết (Quan trọng nhất).
C. Kết luận & Chỉ đạo.
D. Phân công.

Metadata:
- Thời gian/Địa điểm: ${details.timeAndPlace}
- Chủ trì: ${details.chair}
- Thành phần: ${details.attendees}
- Chủ đề: ${details.topic}
- Kết thúc: ${details.endTime}

Transcript:
${transcription}

Trả về DOCTYPE html ngay.`;

            const response = await ai.models.generateContent({
                model: effectiveModel,
                contents: { parts: [{ text: promptTemplate }] },
            });
            
            let htmlResponse = response.text || "";
            if (htmlResponse.startsWith('```html')) htmlResponse = htmlResponse.substring(7);
            if (htmlResponse.endsWith('```')) htmlResponse = htmlResponse.slice(0, -3);
            return htmlResponse.trim();
        });
    } catch (error) {
        throw handleGeminiError(error);
    }
};

export const regenerateMeetingMinutes = async (transcription: string, details: MeetingDetails, previousHtml: string, editRequest: string, modelName: string): Promise<string> => {
    try {
        return await executeGeminiCall(modelName, async (ai, effectiveModel) => {
            const prompt = `Chỉnh sửa biên bản họp (HTML) theo yêu cầu.
Yêu cầu: ${editRequest}
Dữ liệu gốc (tham khảo): ${transcription}
HTML cũ: ${previousHtml}
Chỉ trả về HTML mới.`;
            
            const response = await ai.models.generateContent({
                model: effectiveModel,
                contents: { parts: [{ text: prompt }] },
            });
            let htmlResponse = response.text || "";
            if (htmlResponse.startsWith('```html')) htmlResponse = htmlResponse.substring(7);
            if (htmlResponse.endsWith('```')) htmlResponse = htmlResponse.slice(0, -3);
            return htmlResponse.trim();
        });
    } catch (error) {
        throw handleGeminiError(error);
    }
};

// Live Transcription cannot easily use key rotation mid-stream, so it just uses the current best key
export const liveTranscriptionSession = async (callbacks: any) => {
    const key = getCurrentApiKey();
    if (!key) throw new Error("API_KEY not found");
    const ai = new GoogleGenAI({ apiKey: key });
    
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks,
        config: {
             responseModalities: [Modality.AUDIO], 
             inputAudioTranscription: {},
        }
    });
}

// Chat Assistant
export const startChatSession = (history: any[] = []) => {
    const key = getCurrentApiKey();
    if (!key) throw new Error("API_KEY not configured");
    const ai = new GoogleGenAI({ apiKey: key });
    
    // Tools Definition (Simplified for brevity, ensuring imports are there)
    const listHistoryTool: FunctionDeclaration = { name: "list_history", description: "List saved sessions." };
    const listArchiveTool: FunctionDeclaration = { name: "list_archive", description: "List archived sessions." };
    const loadSessionTool: FunctionDeclaration = { name: "load_session", description: "Load session.", parameters: { type: Type.OBJECT, properties: { sessionId: { type: Type.STRING } } } };
    const archiveSessionTool: FunctionDeclaration = { name: "archive_session", description: "Archive session.", parameters: { type: Type.OBJECT, properties: { sessionId: { type: Type.STRING } } } };
    const editCurrentMinutesTool: FunctionDeclaration = { name: "edit_current_minutes", description: "Edit minutes.", parameters: { type: Type.OBJECT, properties: { instruction: { type: Type.STRING } } } };

    return ai.chats.create({
        model: "gemini-2.5-flash",
        history: history,
        config: {
            tools: [{ functionDeclarations: [listHistoryTool, listArchiveTool, loadSessionTool, archiveSessionTool, editCurrentMinutesTool] }],
            systemInstruction: `Bạn là trợ lý AI.`,
        }
    });
};

// Exposed simply for UI to check if needed
export const getApiKey = getCurrentApiKey;
