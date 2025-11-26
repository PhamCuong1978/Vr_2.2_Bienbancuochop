
import { GoogleGenAI, Modality } from "@google/genai";
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
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('api key not valid') || message.includes('api_key_invalid')) {
            return new Error("Invalid API Key. Please ensure your API key is correctly configured and enabled.");
        }
        if (message.includes('quota')) {
            return new Error("API quota exceeded. Please check your Google Cloud project billing and quota settings.");
        }
        if (message.includes('request payload size exceeds')) {
            return new Error("The audio file is too large to be processed. Please try a smaller file.");
        }
        if (message.includes('deadline exceeded')) {
            return new Error("The request timed out. This may be due to a large file or slow network. Please try again.");
        }
        if (message.includes('fetch')) {
            return new Error("A network error occurred. Please check your internet connection and try again.");
        }
        // Return a slightly cleaner version of the original error
        return new Error(`An unexpected error occurred: ${error.message}`);
    }
    return new Error("An unknown error occurred.");
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

YÊU CẦU NGÔN NGỮ: 100% TIẾNG VIỆT NAM (Văn phong hành chính, trang trọng, rõ ràng).

CẤU TRÚC BIÊN BẢN VÀ HƯỚNG DẪN CHI TIẾT:

A. THÔNG TIN CHUNG
(Điền đầy đủ: Thời gian, Địa điểm, Thành phần tham dự, Chủ trì, Thư ký, Mục đích).

B. NỘI DUNG CHI TIẾT & THẢO LUẬN (ĐÂY LÀ PHẦN QUAN TRỌNG NHẤT - CẦN LÀM RẤT KỸ)
Tuyệt đối không viết tóm tắt kiểu gạch đầu dòng ngắn cũn cỡn. Với mỗi vấn đề được nêu ra trong cuộc họp, bạn phải triển khai thành một mục riêng và thực hiện theo quy trình sau:

1.  **Vấn đề / Chủ đề:** Đặt tiêu đề rõ ràng cho vấn đề đang bàn.
2.  **Bối cảnh/Thực trạng:** Người trình bày đã nêu lên tình hình gì? Dữ liệu hoặc thông tin nền tảng là gì?
3.  **Diễn biến thảo luận (Phải cực kỳ chi tiết):**
    -   Ai đã đưa ra ý kiến gì? (Trích dẫn gián tiếp hoặc trực tiếp các ý quan trọng).
    -   Có những tranh luận, phản biện hay bổ sung nào không? Hãy mô tả lại luồng tranh luận (Người A nói X, Người B phản đối vì Y...).
    -   Phân tích các luận điểm chính: Tại sao họ lại đề xuất như vậy? Ưu/nhược điểm được mổ xẻ là gì?
    -   *Yêu cầu:* Viết thành các đoạn văn mạch lạc, mô tả sâu sắc diễn biến tâm lý và lập luận của cuộc họp.
4.  **Thống nhất / Kết luận của vấn đề đó:** Cuối cùng, chủ tọa hoặc mọi người đã chốt lại điều gì cho vấn đề này?

C. KẾT LUẬN CHUNG & CHỈ ĐẠO
-   Tóm tắt lại các quyết định mang tính chiến lược.
-   Các chỉ đạo quan trọng của người chủ trì.

D. PHÂN CÔNG THỰC HIỆN (Action Plan)
-   Lập bảng chi tiết: [STT | Nội dung công việc | Người/Bộ phận chịu trách nhiệm | Thời hạn hoàn thành | Ghi chú].

E. KÝ DUYỆT
(Khu vực ký của Thư ký và Chủ tọa).

Đầu ra yêu cầu:
-   Mã HTML hoàn chỉnh (bắt đầu bằng <!DOCTYPE html>).
-   Sử dụng CSS inline để trình bày đẹp (bảng có đường viền, tiêu đề đậm, giãn dòng hợp lý).
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
- Chủ đề: ${details.topic || '(không có)'}

Hãy bắt đầu tạo file HTML ngay bây giờ.`;


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
1.  **Giữ vững độ chi tiết:** Không được cắt bớt nội dung phần B (Thảo luận) thành tóm tắt ngắn gọn. Phải giữ nguyên sự phân tích sâu sắc của phiên bản trước, chỉ sửa những chỗ được yêu cầu.
2.  **Ngôn ngữ:** 100% Tiếng Việt.

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
- Chủ đề: ${details.topic || '(không có)'}
---
**3. HTML hiện tại:**
\`\`\`html
${previousHtml}
\`\`\`
---
**4. Yêu cầu chỉnh sửa:**
${editRequest}
---

Bắt đầu tạo lại HTML:`;

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
