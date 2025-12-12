import { GoogleGenAI, Modality, FunctionDeclaration, Type, Chat, GenerateContentResponse } from "@google/genai";
import { MeetingDetails } from "../components/MeetingMinutesGenerator";
import { ProcessingOptions } from "../components/Options";

// --- Multi-Key & Fallback State Management ---

let apiKeys: string[] = [];
let currentKeyIndex = 0;

type StatusListener = (status: { keyIndex: number; totalKeys: number; model: string; isFallback: boolean }) => void;
const listeners: StatusListener[] = [];

// Helper to broadcast status changes to UI
const broadcastStatus = (model: string, isFallback: boolean) => {
    listeners.forEach(l => l({ 
        keyIndex: currentKeyIndex, 
        totalKeys: apiKeys.length,
        model: model, 
        isFallback 
    }));
};

export const subscribeToStatus = (listener: StatusListener) => {
    listeners.push(listener);
    return () => {
        const idx = listeners.indexOf(listener);
        if (idx > -1) listeners.splice(idx, 1);
    };
};

// Initialize Keys from Env - ROBUST VERCEL SUPPORT
const initializeKeys = () => {
    let rawKeys = '';

    // Priority 1: Vite Environment Variable (Standard for Vercel + Vite)
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        // @ts-ignore
        if (import.meta.env.VITE_API_KEY) rawKeys = import.meta.env.VITE_API_KEY;
        // @ts-ignore
        else if (import.meta.env.API_KEY) rawKeys = import.meta.env.API_KEY;
    }

    // Priority 2: Process Env (Fallback for other environments)
    if (!rawKeys && typeof process !== 'undefined' && process.env) {
        if (process.env.VITE_API_KEY) rawKeys = process.env.VITE_API_KEY;
        else if (process.env.API_KEY) rawKeys = process.env.API_KEY;
    }

    if (rawKeys) {
        // Split by comma, trim whitespace, remove empty strings
        apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
        console.log(`[System] Loaded ${apiKeys.length} API Keys.`);
    } else {
        console.error("[System] No API Keys found! Please set VITE_API_KEY in Vercel Environment Variables.");
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
    if (apiKeys.length <= 1) return; // No rotation possible
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`⚠️ Quota hit or Error. Rotating to API Key #${currentKeyIndex + 1}`);
};

// Fallback mapping: Stronger fallback strategy
// gemini-2.0-flash is the stable name. If it fails, we fall back to 1.5-flash.
const FALLBACK_MODEL_MAP: Record<string, string> = {
    'gemini-2.0-flash': 'gemini-1.5-flash', 
    'gemini-1.5-pro': 'gemini-1.5-flash',
};

// --- Smart Execution Logic ---

const executeGeminiCall = async <T>(
    requestedModel: string,
    operation: (ai: GoogleGenAI, effectiveModel: string) => Promise<T>
): Promise<T> => {
    if (apiKeys.length === 0) {
        throw new Error("Không tìm thấy API Key. Hãy cài đặt biến môi trường VITE_API_KEY trên Vercel.");
    }

    let attempts = 0;
    // Strategy: Try every key with the requested model. 
    // If all fail, try every key with the fallback model.
    const maxAttempts = (apiKeys.length * 2) + 2; 
    
    let effectiveModel = requestedModel;
    let isFallback = false;

    while (attempts < maxAttempts) {
        try {
            // Notify UI
            broadcastStatus(effectiveModel, isFallback);

            const apiKey = getCurrentApiKey();
            if (!apiKey) throw new Error("API Key missing.");

            const ai = new GoogleGenAI({ apiKey });
            
            // Execute the actual API call
            return await operation(ai, effectiveModel);

        } catch (error: any) {
            attempts++;
            const message = error?.message?.toLowerCase() || '';
            const status = error?.status;
            
            // Analyze Error Type
            const isQuotaError = message.includes('429') || 
                                 message.includes('quota') || 
                                 message.includes('resource_exhausted') || 
                                 status === 'RESOURCE_EXHAUSTED';
            
            const isAuthError = message.includes('api key not valid') || message.includes('403');
            
            // 404/400 often means the Model Name is invalid or not available to this key
            const isModelError = message.includes('not found') || message.includes('404') || message.includes('400');

            console.warn(`Attempt ${attempts} failed. Key #${currentKeyIndex + 1}. Model: ${effectiveModel}. Error: ${message}`);

            if (isQuotaError || isAuthError || isModelError) {
                // Strategy: Rotate Key
                const previousKeyIndex = currentKeyIndex;
                rotateKey();

                // Check if we have completed a full rotation of keys
                const isFullRotation = currentKeyIndex === 0 && previousKeyIndex === (apiKeys.length - 1);

                if (isFullRotation || isModelError) {
                    // If we tried all keys OR if the model itself is invalid (404), switch to fallback immediately
                    if (FALLBACK_MODEL_MAP[effectiveModel]) {
                        console.warn(`Switching model from ${effectiveModel} to ${FALLBACK_MODEL_MAP[effectiveModel]}`);
                        effectiveModel = FALLBACK_MODEL_MAP[effectiveModel];
                        isFallback = true;
                        // Reset key index to start fresh with new model
                        // currentKeyIndex = 0; 
                    } else if (isFullRotation && !FALLBACK_MODEL_MAP[effectiveModel]) {
                        // If no fallback map and full rotation done, give up
                         if (attempts >= maxAttempts) throw error;
                    }
                }
                
                // Backoff delay
                await new Promise(res => setTimeout(res, 800));
                continue;
            }

            // Other errors (Network, 500) -> Throw immediately
            throw error;
        }
    }
    throw new Error("Hệ thống đang quá tải hoặc hết Quota trên tất cả các Key. Vui lòng thử lại sau.");
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
    
    return new Error(message);
};

// --- Exported Functions (Wrapped) ---

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

// Live Transcription uses the dedicated 2.0 Flash endpoint
export const liveTranscriptionSession = async (callbacks: any) => {
    const key = getCurrentApiKey();
    if (!key) throw new Error("API_KEY not found");
    const ai = new GoogleGenAI({ apiKey: key });
    
    // Fallback logic for live is harder, so we stick to the main exp model
    return ai.live.connect({
        model: 'gemini-2.0-flash-exp', 
        callbacks,
        config: {
             responseModalities: [Modality.AUDIO], 
             inputAudioTranscription: {},
        }
    });
}

// Chat Assistant uses 2.0 Flash for speed
export const startChatSession = (history: any[] = []) => {
    const key = getCurrentApiKey();
    if (!key) throw new Error("API_KEY not configured");
    const ai = new GoogleGenAI({ apiKey: key });
    
    // Tools Definition
    const listHistoryTool: FunctionDeclaration = { name: "list_history", description: "List saved sessions." };
    const listArchiveTool: FunctionDeclaration = { name: "list_archive", description: "List archived sessions." };
    const loadSessionTool: FunctionDeclaration = { name: "load_session", description: "Load session.", parameters: { type: Type.OBJECT, properties: { sessionId: { type: Type.STRING } } } };
    const archiveSessionTool: FunctionDeclaration = { name: "archive_session", description: "Archive session.", parameters: { type: Type.OBJECT, properties: { sessionId: { type: Type.STRING } } } };
    const editCurrentMinutesTool: FunctionDeclaration = { name: "edit_current_minutes", description: "Edit minutes.", parameters: { type: Type.OBJECT, properties: { instruction: { type: Type.STRING } } } };

    return ai.chats.create({
        model: "gemini-2.0-flash",
        history: history,
        config: {
            tools: [{ functionDeclarations: [listHistoryTool, listArchiveTool, loadSessionTool, archiveSessionTool, editCurrentMinutesTool] }],
            systemInstruction: `Bạn là trợ lý AI.`,
        }
    });
};

// Exposed simply for UI to check if needed
export const getApiKey = getCurrentApiKey;