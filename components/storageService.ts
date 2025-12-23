
import { put } from '@vercel/blob';

/**
 * Hàm lấy Token từ biến môi trường một cách an toàn
 */
const getBlobToken = () => {
  // @ts-ignore - Kiểm tra các biến môi trường phổ biến trên Vercel/Vite
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    // @ts-ignore
    if (import.meta.env.VITE_BLOB_READ_WRITE_TOKEN) return import.meta.env.VITE_BLOB_READ_WRITE_TOKEN;
  }
  
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
    if (process.env.VITE_BLOB_READ_WRITE_TOKEN) return process.env.VITE_BLOB_READ_WRITE_TOKEN;
  }
  
  return undefined;
};

/**
 * Hàm lưu nội dung HTML vào Vercel Blob
 * @param fileName Tên file anh muốn đặt (ví dụ: BienBan_2025_01_20)
 * @param htmlContent Nội dung HTML của biên bản
 */
export const saveReportToCloud = async (fileName: string, htmlContent: string) => {
  try {
    const token = getBlobToken();
    
    if (!token) {
      throw new Error("Không tìm thấy BLOB_READ_WRITE_TOKEN. Anh hãy kiểm tra lại cấu hình Environment Variables trên Vercel.");
    }

    const blob = await put(`bien-ban/${fileName}.html`, htmlContent, {
      access: 'public',
      contentType: 'text/html',
      token: token, // Truyền token trực tiếp vào hàm put
    });
    
    alert("Đã lưu biên bản thành công!");
    return blob.url; // Trả về link để anh có thể mở xem ngay
  } catch (error: any) {
    console.error("Lỗi khi lưu vào Vercel Blob:", error);
    alert(`Lỗi: ${error.message || "Không thể lưu biên bản. Anh hãy kiểm tra lại kết nối Vercel."}`);
  }
};
