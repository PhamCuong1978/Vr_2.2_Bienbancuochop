
import { GoogleGenAI, Modality, FunctionDeclaration, Type, Chat } from "@google/genai";
import { MeetingDetails } from "../components/MeetingMinutesGenerator";
import { ProcessingOptions } from "../components/Options";

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // We only need the base64 part of the data URL
            resolve(result.split(',')[1]);
        };
        reader.onerror = error => reject(error);
    });
};

const handleGeminiError = (error: unknown): Error => {
    let message = "An unknown error occurred.";
    
    if (error instanceof Error) {
        message = error.message;
    } else if (typeof error === 'object' && error !== null) {
        try {
            // Attempt to stringify object errors or extract a message property
            if ((error as any).message) {
                message = (error as any).message;
            } else {
                message = JSON.stringify(error);
            }
        } catch (e) {
            message = String(error);
        }
    } else {
        message = String(error);
    }
    
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('api key not valid') || lowerMessage.includes('api_key_invalid')) {
        return new Error("Invalid API Key. Please ensure your API key is correctly configured and enabled.");
    }
    if (lowerMessage.includes('quota') || lowerMessage.includes('429')) {
        return new Error("API quota exceeded. Please check your Google Cloud project billing and quota settings.");
    }
    if (lowerMessage.includes('request payload size exceeds') || lowerMessage.includes('413')) {
        return new Error("The audio file (or chunk) is too large for the API. Try reducing chunk size or disabling audio processing.");
    }
    if (lowerMessage.includes('deadline exceeded')) {
        return new Error("The request timed out. This may be due to a large file or slow network. Please try again.");
    }
    if (lowerMessage.includes('fetch') || lowerMessage.includes('network')) {
        return new Error("A network error occurred. Please check your internet connection and try again.");
    }
    if (lowerMessage.includes('[object object]')) {
         return new Error(`An unexpected error structure occurred: ${message}`);
    }

    return new Error(message);
};

// Helper to safely get the API Key
export const getApiKey = (): string | undefined => {
    // 1. Check standard process.env (Standard Node or Server environment)
    if (typeof process !== 'undefined' && process.env) {
        if (process.env.API_KEY) return process.env.API_KEY;
        // Some environments might expose VITE_ prefixed variables in process.env
        if (process.env.VITE_API_KEY) return process.env.VITE_API_KEY;
    }
    
    // 2. Check Vite Client-side environment (import.meta.env)
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
         // @ts-ignore
        if (import.meta.env.VITE_API_KEY) return import.meta.env.VITE_API_KEY;
         // @ts-ignore
        if (import.meta.env.API_KEY) return import.meta.env.API_KEY;
    }
    
    return undefined;
};

export const transcribeAudio = async (file: File, modelName: string, options?: ProcessingOptions): Promise<string> => {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error("API_KEY is not configured. Please set VITE_API_KEY in your environment variables.");
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
        const audioData = await fileToBase64(file);
        
        const audioPart = {
            inlineData: {
                mimeType: file.type,
                data: audioData,
            },
        };

        // Strict prompt logic to avoid gibberish
        let textPrompt = `
NHIỆM VỤ: Chuyển đổi tệp âm thanh này thành văn bản (Transcript) Tiếng Việt.

YÊU CẦU QUAN TRỌNG:
1. NGÔN NGỮ: Chỉ xuất ra Tiếng Việt. Nếu âm thanh là nhiễu hoặc không rõ lời, hãy cố gắng nghe ngữ cảnh hoặc bỏ qua, TUYỆT ĐỐI KHÔNG xuất ra các ký tự vô nghĩa như "F F F", "aaaa", v.v.
2. ĐỊNH DẠNG:
   - Tách đoạn rõ ràng.
   - Viết đúng chính tả và ngữ pháp tiếng Việt.
`;

        if (options?.identifySpeakers) {
            textPrompt += `
3. NHẬN DIỆN NGƯỜI NÓI (Speaker Diarization):
   - Phân biệt các giọng nói khác nhau.
   - Bắt đầu mỗi lượt lời bằng nhãn: "[NGƯỜI NÓI 1]:", "[NGƯỜI NÓI 2]:",...
   - Không gộp lời của nhiều người vào một đoạn.
   - Ghi lại nguyên văn lời nói (Verbatim).`;
        } else {
            textPrompt += `
3. CẤU TRÚC:
   - Sử dụng xuống dòng (double newlines) để tách các ý hoặc khi người nói thay đổi.
   - Trình bày dễ đọc.`;
        }

        const textPart = { text: textPrompt };

        const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts: [audioPart, textPart] },
        });
        
        return response.text;
    } catch (error) {
        console.error("Error calling Gemini API for transcription:", error);
        throw handleGeminiError(error);
    }
};

export const identifySpeakers = async (transcription: string, modelName: string): Promise<string> => {
    const apiKey = getApiKey();
    if (!apiKey) {
         throw new Error("API_KEY is not configured. Please set VITE_API_KEY in your environment variables.");
    }
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Bạn là chuyên gia phân tích hội thoại Tiếng Việt.
Văn bản dưới đây là nội dung cuộc họp nhưng chưa phân rõ người nói hoặc nhãn chưa chuẩn.

Nhiệm vụ:
1.  **Phân tích ngữ cảnh:** Dựa vào câu hỏi/trả lời, ngắt lời, thay đổi chủ đề để xác định khi nào đổi người nói.
2.  **Gán nhãn:** Viết lại toàn bộ văn bản, chèn nhãn "[NGƯỜI NÓI 1]:", "[NGƯỜI NÓI 2]:",... vào đầu mỗi lượt lời.
3.  **Định dạng:** 
    -   Mỗi lượt lời xuống dòng riêng biệt.
    -   GIỮ NGUYÊN VĂN nội dung nói, không tóm tắt hay thay đổi từ ngữ.
    -   Đảm bảo toàn bộ văn bản đầu ra là Tiếng Việt.

Văn bản cần xử lý:
---
${transcription}
---
`;

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts: [{ text: prompt }] },
        });
        return response.text;
    } catch (error) {
        console.error("Error calling Gemini API for speaker identification:", error);
        throw handleGeminiError(error);
    }
};


export const generateMeetingMinutes = async (
    transcription: string,
    details: MeetingDetails,
    modelName: string
): Promise<string> => {
    const apiKey = getApiKey();
    if (!apiKey) {
         throw new Error("API_KEY is not configured. Please set VITE_API_KEY in your environment variables.");
    }

    const ai = new GoogleGenAI({ apiKey });

    const promptTemplate = `Bạn là thư ký cấp cao của hội đồng quản trị với khả năng tổng hợp và phân tích thông tin xuất sắc.
Nhiệm vụ: Lập BIÊN BẢN CUỘC HỌP từ nội dung ghi âm.

YÊU CẦU NGÔN NGỮ: 100% TIẾNG VIỆT NAM (Văn phong hành chính, trang trọng, lịch sự).

CẤU TRÚC BIÊN BẢN VÀ HƯỚNG DẪN CHI TIẾT:

A. THÔNG TIN CHUNG
- Thời gian, Địa điểm, Thành phần tham dự, Chủ trì: Lấy từ dữ liệu cung cấp.
- **Thư ký:** Ghi là "AI của anh Cường".

B. NỘI DUNG CHI TIẾT & THẢO LUẬN (PHẦN CỐT LÕI - YÊU CẦU ĐỘ CHI TIẾT CỰC ĐẠI)
Đây là linh hồn của biên bản. Không được viết tóm tắt hời hợt. Hãy thuật lại diễn biến cuộc họp thật chi tiết, cụ thể như sau:

Với mỗi chủ đề/vấn đề được đưa ra, hãy cấu trúc thành một mục riêng biệt:
1.  **Tiêu đề vấn đề:** (Ngắn gọn, bao quát).
2.  **Bối cảnh & Thông tin đầu vào:**
    -   Ai là người nêu vấn đề?
    -   Họ cung cấp dữ liệu, con số, hay tình hình thực tế nào? (Ghi lại chi tiết các con số nếu có).
3.  **Diễn biến thảo luận (Yêu cầu tường thuật kỹ lưỡng):**
    -   **Luồng ý kiến:** Mô tả trình tự: Người A nói gì -> Người B phản đối/đồng tình ra sao -> Người C bổ sung ý gì.
    -   **Lập luận & Đối đáp:** Đừng chỉ ghi "mọi người thảo luận sôi nổi". Hãy ghi rõ: Ông X lo ngại về rủi ro tài chính, nhưng Bà Y khẳng định đây là cơ hội đầu tư.
    -   **Trích dẫn:** Cố gắng trích dẫn ý chính hoặc câu nói đắt giá của người nói để tăng tính xác thực.
    -   **Phân tích:** Làm rõ các mâu thuẫn hoặc các khía cạnh đa chiều của vấn đề được mổ xẻ.
4.  **Kết luận/Chốt vấn đề:**
    -   Quyết định cuối cùng là gì?
    -   Ai là người đưa ra quyết định chốt?

C. KẾT LUẬN CHUNG & CHỈ ĐẠO
-   Tóm tắt lại các quyết định mang tính chiến lược.
-   Các chỉ đạo quan trọng của người chủ trì.

D. PHÂN CÔNG THỰC HIỆN (Action Plan)
-   Lập bảng chi tiết: [STT | Nội dung công việc | Người/Bộ phận chịu trách nhiệm | Thời hạn hoàn thành | Ghi chú].

E. KÝ DUYỆT
(Khu vực ký của Thư ký và Chủ tọa).

Đầu ra yêu cầu:
-   **TUYỆT ĐỐI KHÔNG được có lời dẫn, lời chào, hay bất kỳ văn bản nào bên ngoài mã HTML.**
-   Mã HTML hoàn chỉnh (bắt đầu ngay lập tức bằng <!DOCTYPE html>).
-   **CSS Inline BẮT BUỘC cho giao diện đẹp, trang trọng:**
    -   **Body:** Font-family 'Times New Roman', serif; line-height: 1.6; color: #222; max-width: 900px; margin: 0 auto; padding: 40px; background-color: #fff; box-shadow: 0 0 10px rgba(0,0,0,0.1);
    -   **Tiêu đề chính (H1):** LUÔN LÀ "BIÊN BẢN CUỘC HỌP". CSS: Text-align: center; color: #2c3e50; text-transform: uppercase; margin-bottom: 5px; font-size: 24pt;
    -   **Dòng trích yếu (Subtitle/Vv):** Ngay dưới H1, thêm một thẻ <p> căn giữa (text-align: center), in nghiêng (font-style: italic), font-size: 14pt; margin-bottom: 40px; Nội dung là: "(V/v: [Chủ đề cuộc họp])".
    -   **Các tiêu đề mục lớn (H2 - Mục A, B, C...):** **COLOR: #4472C4 (Xanh coban nhạt);** border-bottom: 2px solid #4472C4; padding-bottom: 10px; margin-top: 40px; text-transform: uppercase; font-size: 16pt; letter-spacing: 0.5px;
    -   **Tiêu đề con (H3):** Color: #333; font-weight: bold; margin-top: 25px; font-size: 14pt;
    -   **Bảng (Table):** Width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12pt;
    -   **Th (Table Header):** Background-color: #f0f4f8; border: 1px solid #a0aec0; padding: 12px; text-align: left; font-weight: bold; color: #2d3748;
    -   **Td (Table Data):** Border: 1px solid #cbd5e0; padding: 12px; vertical-align: top;
    -   **Strong/Bold:** Color: #2d3748;
-   Nội dung phần B phải chiếm tỷ trọng lớn nhất và thể hiện được sự sâu sắc của cuộc họp.`;
    
    const fullPrompt = `${promptTemplate}

Dữ liệu đầu vào (Transcription):
---
${transcription}
---

Thông tin bổ sung (Metadata):
- Thời gian & địa điểm: ${details.timeAndPlace || '(không có)'}
- Thành phần tham dự: ${details.attendees || '(không có)'}
- Chủ trì: ${details.chair || '(không có)'}
- Chủ đề cho dòng V/v: ${details.topic}

BẮT ĐẦU NGAY VỚI "<!DOCTYPE html>". KHÔNG TRẢ LỜI LẠI TÔI.`;


    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts: [{ text: fullPrompt }] },
        });
        
        let htmlResponse = response.text;
        // Clean up potential markdown formatting from the response
        if (htmlResponse.startsWith('```html')) {
            htmlResponse = htmlResponse.substring(7);
        }
        if (htmlResponse.endsWith('```')) {
            htmlResponse = htmlResponse.slice(0, -3);
        }

        return htmlResponse.trim();
    } catch (error) {
        console.error("Error calling Gemini API for meeting minutes:", error);
        throw handleGeminiError(error);
    }
};

export const regenerateMeetingMinutes = async (
    transcription: string,
    details: MeetingDetails,
    previousHtml: string,
    editRequest: string,
    modelName: string
): Promise<string> => {
    const apiKey = getApiKey();
    if (!apiKey) {
         throw new Error("API_KEY is not configured. Please set VITE_API_KEY in your environment variables.");
    }

    const ai = new GoogleGenAI({ apiKey });

    const promptTemplate = `Bạn là một thư ký chuyên nghiệp.
Nhiệm vụ: Chỉnh sửa biên bản cuộc họp dựa trên yêu cầu của người dùng.

NGUYÊN TẮC CỐT LÕI:
1.  **Giữ vững độ chi tiết:** Không được cắt bớt nội dung phần B (Thảo luận).
2.  **Ngôn ngữ:** 100% Tiếng Việt.
3.  **Style:** H1 là "BIÊN BẢN CUỘC HỌP", dưới H1 có dòng V/v in nghiêng. Mục Thư ký là "AI của anh Cường".
4.  **KHÔNG LỜI DẪN:** Chỉ trả về code HTML. Bắt đầu ngay bằng DOCTYPE.

Thông tin đầu vào:
1.  Transcription gốc (để tham chiếu).
2.  HTML hiện tại.
3.  Yêu cầu chỉnh sửa (Edit Request).

Hãy trả về mã HTML hoàn chỉnh đã chỉnh sửa.`;

    const fullPrompt = `${promptTemplate}

---
**1. Transcription:**
${transcription}
---
**2. Thông tin:**
- Chủ đề: ${details.topic || 'BIÊN BẢN HỌP'}
---
**3. HTML hiện tại:**
\`\`\`html
${previousHtml}
\`\`\`
---
**4. Yêu cầu chỉnh sửa:**
${editRequest}
---

BẮT ĐẦU NGAY VỚI "<!DOCTYPE html>".`;

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts: [{ text: fullPrompt }] },
        });

        let htmlResponse = response.text;
        // Clean up potential markdown formatting from the response
        if (htmlResponse.startsWith('```html')) {
            htmlResponse = htmlResponse.substring(7);
        }
        if (htmlResponse.endsWith('```')) {
            htmlResponse = htmlResponse.slice(0, -3);
        }

        return htmlResponse.trim();
    } catch (error) {
        console.error("Error calling Gemini API for meeting minutes regeneration:", error);
        throw handleGeminiError(error);
    }
};

export const liveTranscriptionSession = async (callbacks: any) => {
     const apiKey = getApiKey();
    if (!apiKey) {
         throw new Error("API_KEY is not configured. Please set VITE_API_KEY in your environment variables.");
    }
    const ai = new GoogleGenAI({ apiKey });
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks,
        config: {
             responseModalities: [Modality.AUDIO], 
             inputAudioTranscription: {},
        }
    });
}

// --- Chat Assistant Functions ---

// Tools Definition
const listHistoryTool: FunctionDeclaration = {
    name: "list_history",
    description: "Get a list of all saved meeting sessions in the history.",
};

const listArchiveTool: FunctionDeclaration = {
    name: "list_archive",
    description: "Get a list of all archived meeting sessions (Cloud storage).",
};

const loadSessionTool: FunctionDeclaration = {
    name: "load_session",
    description: "Load a specific meeting session from history or archive into the main view.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            sessionId: { type: Type.STRING, description: "The ID of the session to load." },
        },
        required: ["sessionId"],
    },
};

const archiveSessionTool: FunctionDeclaration = {
    name: "archive_session",
    description: "Move a session from History to Archive (Cloud storage).",
    parameters: {
        type: Type.OBJECT,
        properties: {
            sessionId: { type: Type.STRING, description: "The ID of the session to archive." },
        },
        required: ["sessionId"],
    },
};

const editCurrentMinutesTool: FunctionDeclaration = {
    name: "edit_current_minutes",
    description: "Edit the currently displayed meeting minutes (HTML) based on user instructions.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            instruction: { type: Type.STRING, description: "The detailed instruction for editing the minutes." },
        },
        required: ["instruction"],
    },
};

export const startChatSession = (history: any[] = []) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API_KEY not configured");
    const ai = new GoogleGenAI({ apiKey });
    
    // Create chat with tools
    return ai.chats.create({
        model: "gemini-2.5-flash",
        history: history,
        config: {
            tools: [{ 
                functionDeclarations: [
                    listHistoryTool, 
                    listArchiveTool, 
                    loadSessionTool, 
                    archiveSessionTool,
                    editCurrentMinutesTool
                ] 
            }],
            systemInstruction: `Bạn là "AI của anh Cường", một trợ lý ảo thông minh tích hợp trong ứng dụng "Gemini Meeting Assistant".
Nhiệm vụ của bạn là hỗ trợ người dùng quản lý biên bản cuộc họp.
Bạn có QUYỀN KIỂM SOÁT ỨNG DỤNG thông qua các công cụ (tools) được cung cấp.

Quy tắc:
1. Luôn xưng hô là "AI của anh Cường" hoặc "em".
2. Trả lời ngắn gọn, súc tích, thân thiện.
3. Khi người dùng yêu cầu thực hiện hành động (ví dụ: "Mở biên bản họp Marketing"), hãy sử dụng tool tương ứng.
4. Nếu cần thông tin (ví dụ: ID của phiên họp), hãy gọi tool 'list_history' hoặc 'list_archive' trước để tìm, sau đó mới gọi tool hành động.
5. Nếu người dùng hỏi "Anh muốn gì ở em", hãy trả lời hài hước một chút nhưng vẫn chuyên nghiệp.

Dữ liệu hiện tại của ứng dụng sẽ được cung cấp qua context mỗi khi bạn được gọi.`,
        }
    });
};
