
import { put, list, del } from '@vercel/blob';

/**
 * Hàm lấy Token từ biến môi trường một cách an toàn.
 * Lưu ý: Vite yêu cầu tiền tố VITE_ để biến có thể truy cập được từ trình duyệt.
 */
const getBlobToken = () => {
  // @ts-ignore
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
  // @ts-ignore
  const proc = (typeof process !== 'undefined' && process.env) ? process.env : {};

  return env.VITE_BLOB_READ_WRITE_TOKEN || 
         proc.VITE_BLOB_READ_WRITE_TOKEN || 
         env.BLOB_READ_WRITE_TOKEN || 
         proc.BLOB_READ_WRITE_TOKEN;
};

/**
 * Hàm lưu nội dung HTML vào Vercel Blob
 */
export const saveReportToCloud = async (fileName: string, htmlContent: string) => {
  try {
    const token = getBlobToken();
    if (!token) {
      alert("THIẾU TOKEN: Anh Cường hãy thêm VITE_BLOB_READ_WRITE_TOKEN vào Vercel Settings.");
      return null;
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
    alert(`Lỗi hệ thống: ${error.message}`);
    return null;
  }
};

/**
 * Hàm lấy danh sách các tệp tin đã lưu trên Vercel Blob
 */
export const listCloudReports = async () => {
  try {
    const token = getBlobToken();
    if (!token) return [];

    const { blobs } = await list({
      prefix: 'bien-ban/',
      token: token,
    });
    
    return blobs;
  } catch (error) {
    console.error("Lỗi khi lấy danh sách tệp Cloud:", error);
    return [];
  }
};

/**
 * Hàm xóa tệp tin trên Vercel Blob
 */
export const deleteCloudReport = async (url: string) => {
  try {
    const token = getBlobToken();
    if (!token) return;

    await del(url, { token: token });
    alert("✅ Đã xóa tệp trên Cloud thành công!");
  } catch (error) {
    console.error("Lỗi khi xóa tệp Cloud:", error);
    alert("Không thể xóa tệp trên Cloud.");
  }
};
