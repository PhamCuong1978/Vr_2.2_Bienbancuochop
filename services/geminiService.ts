
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
                
                // Exponential Backoff logic - NOW FASTER because we have multiple keys
                // If we rotated keys, try almost immediately (200ms). If single key, wait longer.
                const baseBackoff = apiKeys.length > 1 ? 200 : 2000;
                const backoffTime = baseBackoff * (isQuotaError ? 1 : attempts);
                
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

/**
 * Wraps raw HTML content in a complete HTML5 document structure with UTF-8 encoding.
 * This ensures that Vietnamese characters are displayed correctly in all browsers.
 * Updated to include Professional Table CSS for Section V and Structured Boxes for Section III.
 */
const wrapHtmlContent = (bodyContent: string): string => {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Biên Bản Cuộc Họp</title>
    <style>
        body {
            font-family: 'Times New Roman', Times, serif;
            background-color: #f3f4f6;
            margin: 0;
            padding: 40px 20px;
            color: #1f2937;
            line-height: 1.6;
        }
        .page-container {
            max-width: 800px;
            margin: 0 auto;
            background-color: #ffffff;
            padding: 40px 50px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            border-radius: 4px;
            min-height: 297mm; /* Approximate A4 height */
        }
        .header-title {
            color: #003366; /* Navy Blue */
            text-transform: uppercase;
            font-weight: bold;
        }
        .section-header {
            color: #003366;
            text-transform: uppercase;
            font-weight: bold;
            margin-top: 25px;
            margin-bottom: 15px;
            border-bottom: 2px solid #003366;
            display: inline-block;
            padding-bottom: 2px;
        }
        ul, ol {
            margin-top: 5px;
            margin-bottom: 5px;
        }
        li {
            margin-bottom: 5px;
        }
        /* SECTION V: ASSIGNMENT TABLE STYLES */
        table.assignment-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            margin-bottom: 25px;
            font-size: 14px;
        }
        table.assignment-table th {
            background-color: #0070c0; /* Blue header */
            color: white;
            font-weight: bold;
            padding: 12px 8px;
            border: 1px solid #8ba3c2;
            text-align: center;
            vertical-align: middle;
        }
        table.assignment-table td {
            padding: 10px 8px;
            border: 1px solid #8ba3c2;
            vertical-align: top;
            text-align: left;
            color: #333;
        }
        table.assignment-table tr:nth-child(even) {
            background-color: #f2f7fc;
        }
        
        /* SECTION III: STRUCTURED DISCUSSION STYLES */
        .discussion-block {
            margin-bottom: 25px;
            border-left: 4px solid #003366;
            padding-left: 15px;
        }
        .discussion-title {
            font-weight: bold;
            font-size: 16px;
            color: #1a202c;
            margin-bottom: 10px;
            text-decoration: underline;
        }
        .detail-box {
            margin-bottom: 15px;
            border: 1px solid #e5e7eb;
            padding: 12px;
            background-color: #fff;
            border-radius: 4px;
        }
        .detail-header {
            font-weight: bold;
            color: #b91c1c; /* Dark Red as requested in image style */
            border: 1px solid #b91c1c;
            display: inline-block;
            padding: 2px 8px;
            margin-bottom: 8px;
            text-transform: uppercase;
            font-size: 12px;
            background-color: #fff;
        }
        .detail-content {
            text-align: justify;
            margin-left: 5px;
        }

        @media print {
            body { 
                background: none; 
                padding: 0; 
            }
            .page-container { 
                box-shadow: none; 
                margin: 0; 
                width: 100%;
                max-width: 100%;
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="page-container">
        ${bodyContent}
    </div>
</body>
</html>`;
};

// --- Exported Functions (Wrapped) ---

// Task 1: Transcription -> Use Fast Audio Model (Gemini 2.5 Flash)
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
export const identifySpeakers = async (transcription: string, modelName: string, speakerCount?: number): Promise<string> => {
    try {
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
// Updated Prompt for 90% detail, 3-part structured discussion AND Minimum 5 items for IV & V
export const generateMeetingMinutes = async (transcription: string, details: MeetingDetails, modelName: string): Promise<string> => {
    try {
        const optimalModel = MODEL_HIGH_REASONING;

        const bodyContent = await executeGeminiCall(optimalModel, async (ai, effectiveModel) => {
             const promptTemplate = `Bạn là Thư ký cuộc họp chuyên nghiệp. Hãy soạn thảo BIÊN BẢN CUỘC HỌP.
Sử dụng định dạng HTML (chỉ phần body content).

QUY TẮC CỐT LÕI (TUÂN THỦ TUYỆT ĐỐI):
1. **MỤC III (NỘI DUNG CUỘC HỌP) PHẢI CỰC KỲ CHI TIẾT (90%)**. Không tóm tắt sơ sài. Phải trích dẫn các con số, luận điểm phản biện, ý kiến trái chiều.
2. **CẤU TRÚC MỤC III**: Với MỖI vấn đề chính, phải tạo một khối riêng gồm 3 phần: Bối cảnh, Diễn biến, Kết luận.
3. **SỐ LƯỢNG MỤC IV & V (BẮT BUỘC)**:
   - **Mục IV (Kết luận)**: Phải liệt kê **TỐI THIỂU 5 Ý CHÍNH**.
   - **Mục V (Bảng phân công)**: Phải điền **TỐI THIỂU 5 DÒNG NHIỆM VỤ**. Nếu không đủ thông tin, hãy suy luận logic từ các chỉ đạo để điền đủ.
   - **QUY TẮC SỐ LẺ**: Ưu tiên tổng số lượng mục/dòng là **5, 7, hoặc 9**. Tránh để số lượng chẵn (6, 8) nếu có thể để bố cục đẹp hơn.
4. KHÔNG cần thẻ <html>, <head>, <body> hay <!DOCTYPE>. Chỉ cần nội dung bên trong thẻ body.

CẤU TRÚC HTML MẪU:

<div>
    <!-- HEADER -->
    <div style="text-align: center; margin-bottom: 30px;">
        <h4 style="margin: 0; font-weight: bold; text-transform: uppercase;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
        <h5 style="margin: 5px 0 0 0; font-weight: bold; text-decoration: underline;">Độc lập - Tự do - Hạnh phúc</h5>
        <p style="margin-top: 15px; text-align: right; font-style: italic;">${details.timeAndPlace.split(',')[0] || '.......'}, ngày... tháng... năm...</p>
        <br/>
        <h2 class="header-title" style="margin: 15px 0; font-size: 20pt; color: #003366;">BIÊN BẢN CUỘC HỌP</h2>
        <h3 style="margin: 0; font-weight: bold; font-size: 14pt;">V/v: ${details.topic}</h3>
    </div>

    <!-- BODY -->
    <p class="section-header">I. THỜI GIAN VÀ ĐỊA ĐIỂM:</p>
    <p style="margin-left: 20px;">- Thời gian: ${details.timeAndPlace}</p>
    <p style="margin-left: 20px;">- Địa điểm: ${details.timeAndPlace}</p>

    <p class="section-header">II. THÀNH PHẦN THAM DỰ:</p>
    <p style="margin-left: 20px;">1. Chủ trì: ${details.chair}</p>
    <p style="margin-left: 20px;">2. Thư ký: AI của Anh Cường</p>
    <p style="margin-left: 20px;">3. Thành phần: ${details.attendees}</p>

    <p class="section-header">III. NỘI DUNG CUỘC HỌP (CHI TIẾT):</p>
    
    <!-- AI LẶP LẠI CẤU TRÚC SAU CHO MỖI VẤN ĐỀ THẢO LUẬN -->
    <!-- VẤN ĐỀ 1 -->
    <div class="discussion-block">
        <div class="discussion-title">1. [Tên vấn đề thảo luận]</div>
        
        <div class="detail-box">
            <span class="detail-header">Bối cảnh & Thông tin đầu vào:</span>
            <div class="detail-content">
                [Mô tả chi tiết: Ai trình bày? Dữ liệu ban đầu là gì? Vấn đề phát sinh?]
            </div>
        </div>

        <div class="detail-box">
            <span class="detail-header">Diễn biến thảo luận:</span>
            <div class="detail-content">
                <p><strong>Luồng ý kiến:</strong></p>
                <ul>
                    <li>[Người A] ý kiến: ... (Trích dẫn chi tiết)</li>
                    <li>[Người B] phản biện: ... (Ghi rõ lý do phản biện)</li>
                    <li>[Người C] bổ sung: ... </li>
                </ul>
                <p><em>(Giữ lại 90% chi tiết các tranh luận, con số, lập luận từ transcript)</em></p>
            </div>
        </div>

        <div class="detail-box">
            <span class="detail-header">Kết luận/Chốt vấn đề:</span>
            <div class="detail-content">
                [Ghi rõ quyết định cuối cùng của chủ tọa hoặc sự thống nhất của cuộc họp]
            </div>
        </div>
    </div>
    <!-- HẾT VẤN ĐỀ 1 -->

    <p class="section-header">IV. KẾT LUẬN CHUNG & CHỈ ĐẠO:</p>
    <div style="margin-left: 20px; text-align: justify;">
        <!-- LIỆT KÊ TỐI THIỂU 5 Ý GẠCH ĐẦU DÒNG. NẾU ĐƯỢC HÃY LẤY 7 HOẶC 9 Ý. TRÁNH SỐ CHẴN. -->
        <ul>
            <li>...</li>
            <li>...</li>
            <li>...</li>
            <li>...</li>
            <li>...</li>
        </ul>
    </div>

    <p class="section-header">V. PHÂN CÔNG THỰC HIỆN CÔNG VIỆC:</p>
    <table class="assignment-table">
        <thead>
            <tr>
                <th style="width: 5%">STT</th>
                <th style="width: 35%">Nội dung công việc</th>
                <th style="width: 20%">Người/Bộ phận<br/>chịu trách nhiệm</th>
                <th style="width: 15%">Thời hạn<br/>hoàn thành</th>
                <th style="width: 25%">Ghi chú</th>
            </tr>
        </thead>
        <tbody>
            <!-- AI ĐIỀN TỐI THIỂU 5 DÒNG (TR). ƯU TIÊN 7 HOẶC 9 DÒNG. TRÁNH SỐ CHẴN. -->
        </tbody>
    </table>

    <p class="section-header">VI. CUỘC HỌP KẾT THÚC VÀO LÚC: ${details.endTime}</p>

    <!-- SIGNATURE -->
    <div style="display: flex; justify-content: space-between; margin-top: 60px;">
        <div style="text-align: center; width: 45%;">
            <strong>THƯ KÝ</strong><br/>
            (Ký, ghi rõ họ tên)<br/><br/><br/><br/>
            <strong>AI của Anh Cường</strong>
        </div>
        <div style="text-align: center; width: 45%;">
            <strong>CHỦ TRÌ CUỘC HỌP</strong><br/>
            (Ký, ghi rõ họ tên)<br/><br/><br/><br/>
            <strong>${details.chair}</strong>
        </div>
    </div>
</div>

TRANSCRIPT HỘI THOẠI ĐỂ XỬ LÝ:
${transcription}

HÃY ĐIỀN NỘI DUNG. 
LƯU Ý QUAN TRỌNG: 
- MỤC III: CHI TIẾT 90%. 
- MỤC IV & V: TỐI THIỂU 5 MỤC/DÒNG. ƯU TIÊN SỐ LẺ (5, 7, 9) ĐỂ ĐẸP MẮT.`;

            const response = await ai.models.generateContent({
                model: effectiveModel,
                contents: { parts: [{ text: promptTemplate }] },
                config: { safetySettings: SAFETY_SETTINGS }
            });
            
            let htmlResponse = response.text || "";
            // Cleanup markdown code blocks
            if (htmlResponse.includes("```html")) htmlResponse = htmlResponse.split("```html")[1];
            if (htmlResponse.includes("```")) htmlResponse = htmlResponse.split("```")[0];

            return htmlResponse.trim();
        });

        // Wrap the body content with the full HTML structure + UTF-8 meta tag
        return wrapHtmlContent(bodyContent);

    } catch (error) {
        throw handleGeminiError(error);
    }
};

export const regenerateMeetingMinutes = async (transcription: string, details: MeetingDetails, previousHtml: string, editRequest: string, modelName: string): Promise<string> => {
    try {
         // Force override to 3.0 Pro
         const optimalModel = MODEL_HIGH_REASONING;

        const bodyContent = await executeGeminiCall(optimalModel, async (ai, effectiveModel) => {
            const prompt = `Bạn là một phần mềm xử lý văn bản tự động.
NHIỆM VỤ: Chỉnh sửa nội dung biên bản họp dựa trên yêu cầu người dùng.
YÊU CẦU CỐT LÕI:
1. **CHỈ TRẢ VỀ DUY NHẤT MÃ HTML** (Nội dung bên trong thẻ body).
2. Giữ nguyên cấu trúc các thẻ và class CSS.
3. **ĐẢM BẢO SỐ LƯỢNG**: Nếu người dùng yêu cầu liên quan đến Mục IV hoặc V, hãy đảm bảo luôn duy trì **tối thiểu 5 mục/dòng**. Ưu tiên số lẻ (5, 7, 9).

Yêu cầu chỉnh sửa cụ thể: "${editRequest}"

Transcript gốc:
${transcription}

HTML cũ (Tham khảo):
${previousHtml}

OUTPUT (HTML BODY CONTENT ONLY):`;
            
            const response = await ai.models.generateContent({
                model: effectiveModel,
                contents: { parts: [{ text: prompt }] },
                config: { safetySettings: SAFETY_SETTINGS }
            });
            let htmlResponse = response.text || "";
            
            if (htmlResponse.includes("```html")) htmlResponse = htmlResponse.split("```html")[1];
            if (htmlResponse.includes("```")) htmlResponse = htmlResponse.split("```")[0];
            
            if (htmlResponse.includes("<body")) {
                const match = htmlResponse.match(/<body[^>]*>([\s\S]*)<\/body>/i);
                if (match && match[1]) {
                    htmlResponse = match[1];
                }
            }

            return htmlResponse.trim();
        });

        return wrapHtmlContent(bodyContent);

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
