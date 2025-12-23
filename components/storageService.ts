
import { put } from '@vercel/blob';

/**
 * Hàm lấy Token từ biến môi trường một cách an toàn.
 * Lưu ý: Vite yêu cầu tiền tố VITE_ để biến có thể truy cập được từ trình duyệt.
 */
const getBlobToken = () => {
  // @ts-ignore
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
  // @ts-ignore
  const proc = (typeof process !== 'undefined' && process.env) ? process.env : {};

  // Ưu tiên các biến có tiền tố VITE_ vì chúng được Vite hỗ trợ chính thức
  return env.VITE_BLOB_READ_WRITE_TOKEN || 
         proc.VITE_BLOB_READ_WRITE_TOKEN || 
         env.BLOB_READ_WRITE_TOKEN || 
         proc.BLOB_READ_WRITE_TOKEN;
};

/**
 * Hàm lưu nội dung HTML vào Vercel Blob
 * @param fileName Tên file
 * @param htmlContent Nội dung HTML
 */
export const saveReportToCloud = async (fileName: string, htmlContent: string) => {
  try {
    const token = getBlobToken();
    
    if (!token) {
      const errorMsg = "THIẾU TOKEN: Anh Cường hãy vào Vercel Settings -> Environment Variables, thêm một biến mới tên là VITE_BLOB_READ_WRITE_TOKEN với giá trị lấy từ biến gốc, sau đó REDEPLOY lại ứng dụng nhé!";
      alert(errorMsg);
      throw new Error(errorMsg);
    }

    const blob = await put(`bien-ban/${fileName}.html`, htmlContent, {
      access: 'public',
      contentType: 'text/html',
      token: token,
    });
    
    alert("✅ Đã lưu biên bản lên Cloud thành công!");
    return blob.url;
  } catch (error: any) {
    console.error("Lỗi khi lưu vào Vercel Blob:", error);
    // Không alert thêm nếu đã alert ở trên
    if (!error.message.includes("THIẾU TOKEN")) {
        alert(`Lỗi hệ thống: ${error.message || "Không thể kết nối Vercel Storage."}`);
    }
  }
};
