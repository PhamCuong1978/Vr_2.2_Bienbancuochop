import { GoogleGenAI, Modality, FunctionDeclaration, Type, Chat, GenerateContentResponse, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { MeetingDetails } from "../components/MeetingMinutesGenerator";
import { ProcessingOptions } from "../components/Options";

// --- STRATEGY CONFIGURATION ---
// Best for Audio & Speed & Chat
const MODEL_FAST_AUDIO = 'gemini-2.5-flash'; 
// Best for Reasoning, Complex Instructions, & Formatting (Minutes/Diarization)
const MODEL_HIGH_REASONING = 'gemini-3-pro-preview'; 

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

// Fallback mapping
// If the best model fails, fall back to the reliable Flash model
const FALLBACK_MODEL_MAP: Record<string, string> = {
    'gemini-3-pro-preview': 'gemini-2.5-flash',
    'gemini-2.5-flash': 'gemini-2.5-flash-lite-latest',
};

// Global Safety Settings - CRITICAL for transcription to avoid blocking content
const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// --- Smart Execution Logic ---

const executeGeminiCall = async <T>(
    requestedModel: string,
    operation: (ai: GoogleGenAI, effectiveModel: string) => Promise<T>
): Promise<T> => {
    if (apiKeys.length === 0) {
        throw new Error("Không tìm thấy API Key. Hãy cài đặt biến môi trường VITE_API_KEY trên Vercel.");
    }

    let attempts = 0;
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
            
            // 5xx Server Errors (Temporary unavailability)
            const isServerError = message.includes('500') || message.includes('503') || message.includes('overloaded') || message.includes('internal');

            console.warn(`Attempt ${attempts} failed. Key #${currentKeyIndex + 1}. Model: ${effectiveModel}. Error: ${message}`);

            if (isQuotaError || isAuthError || isModelError || isServerError) {
                // Strategy: Rotate Key
                const previousKeyIndex = currentKeyIndex;
                rotateKey();

                const isFullRotation = currentKeyIndex === 0 && previousKeyIndex === (apiKeys.length - 1);

                if (isFullRotation || isModelError) {
                    if (FALLBACK_MODEL_MAP[effectiveModel]) {
                        console.warn(`Switching model from ${effectiveModel} to ${FALLBACK_MODEL_MAP[effectiveModel]}`);
                        effectiveModel = FALLBACK_MODEL_MAP[effectiveModel];
                        isFallback = true;
                    } else if (isFullRotation && !FALLBACK_MODEL_MAP[effectiveModel] && !isServerError) {
                         if (attempts >= maxAttempts) throw error;
                    }
                }
                
                // Exponential Backoff (1.5s, 3s, 4.5s...)
                const backoffTime = 1500 * attempts;
                console.log(`Waiting ${backoffTime}ms before retry...`);
                await new Promise(res => setTimeout(res, backoffTime));
                continue;
            }

            // Other unknown errors -> Throw immediately
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

// Task 1: Transcription -> Use Fast Audio Model (Gemini 2.5 Flash)
// If user explicitly requests a model (via UI), we honor it, otherwise default to optimal.
export const transcribeAudio = async (file: File, modelName: string, options?: ProcessingOptions): Promise<string> => {
    try {
        const audioData = await fileToBase64(file);
        const mimeType = file.type;

        return await executeGeminiCall(modelName || MODEL_FAST_AUDIO, async (ai, effectiveModel) => {
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
                config: {
                    safetySettings: SAFETY_SETTINGS, // Apply safety settings
                }
            });
            return response.text || "";
        });
    } catch (error) {
        console.error("Transcription failed:", error);
        throw handleGeminiError(error);
    }
};

// Task 3: Speaker ID -> Use High Reasoning Model (Gemini 3.0 Pro)
// Identifying speakers from text context requires deep logic to avoid hallucinations.
export const identifySpeakers = async (transcription: string, modelName: string, speakerCount?: number): Promise<string> => {
    try {
        // Force override to 3.0 Pro for better logic, unless user specifically chose something else via UI
        const optimalModel = MODEL_HIGH_REASONING;

        return await executeGeminiCall(optimalModel, async (ai, effectiveModel) => {
            let prompt = `Bạn là chuyên gia phân tích hội thoại. Nhiệm vụ của bạn là gán nhãn người nói ([NGƯỜI NÓI X]:) vào văn bản sau một cách logic nhất dựa trên ngữ cảnh.`;
            if (speakerCount) prompt += ` Số lượng người ước tính: ${speakerCount}.`;
            prompt += `\n\n---\n${transcription}\n---`;

            const response = await ai.models.generateContent({
                model: effectiveModel,
                contents: { parts: [{ text: prompt }] },
                config: { safetySettings: SAFETY_SETTINGS }
            });
            return response.text || "";
        });
    } catch (error) {
        throw handleGeminiError(error);
    }
};

// Task 4: Meeting Minutes -> Use High Reasoning Model (Gemini 3.0 Pro)
// Summarization and formatting HTML require the strongest instruction-following model.
export const generateMeetingMinutes = async (transcription: string, details: MeetingDetails, modelName: string): Promise<string> => {
    try {
        // Force override to 3.0 Pro
        const optimalModel = MODEL_HIGH_REASONING;

        return await executeGeminiCall(optimalModel, async (ai, effectiveModel) => {
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
                config: { safetySettings: SAFETY_SETTINGS }
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
         // Force override to 3.0 Pro
         const optimalModel = MODEL_HIGH_REASONING;

        return await executeGeminiCall(optimalModel, async (ai, effectiveModel) => {
            const prompt = `Chỉnh sửa biên bản họp (HTML) theo yêu cầu.
Yêu cầu: ${editRequest}
Dữ liệu gốc (tham khảo): ${transcription}
HTML cũ: ${previousHtml}
Chỉ trả về HTML mới.`;
            
            const response = await ai.models.generateContent({
                model: effectiveModel,
                contents: { parts: [{ text: prompt }] },
                config: { safetySettings: SAFETY_SETTINGS }
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

// Live Transcription -> Use Native Audio Model
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

// Task 5: Chat Assistant -> Use Fast Model (Gemini 2.5 Flash)
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
        model: MODEL_FAST_AUDIO,
        history: history,
        config: {
            tools: [{ functionDeclarations: [listHistoryTool, listArchiveTool, loadSessionTool, archiveSessionTool, editCurrentMinutesTool] }],
            systemInstruction: `Bạn là trợ lý AI.`,
            safetySettings: SAFETY_SETTINGS
        }
    });
};

// Exposed simply for UI to check if needed
export const getApiKey = getCurrentApiKey;