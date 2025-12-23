
import { put, list, del } from '@vercel/blob';

/**
 * Hàm lấy Token từ biến môi trường một cách an toàn.
 * Ưu tiên tiền tố VITE_ để hoạt động trên môi trường Client-side của Vercel.
 */
const getBlobToken = () => {
  // @ts-ignore
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
  // @ts-ignore
  const proc = (typeof process !== 'undefined' && process.env) ? process.env : {};

  const token = env.VITE_BLOB_READ_WRITE_TOKEN || 
                proc.VITE_BLOB_READ_WRITE_TOKEN || 
                env.BLOB_READ_WRITE_TOKEN || 
                proc.BLOB_READ_WRITE_TOKEN;
  
  return token;
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
    
    return blob.url;
  } catch (error: any) {
    console.error("Lỗi khi lưu vào Vercel Blob:", error);
    alert(`Lỗi khi lưu: ${error.message}`);
    return null;
  }
};

/**
 * Hàm lấy danh sách các tệp tin đã lưu trên Vercel Blob
 */
export const listCloudReports = async () => {
  try {
    const token = getBlobToken();
    if (!token) {
        console.warn("listCloudReports: No token found");
        return [];
    }

    console.log("Đang gọi API Vercel để lấy danh sách file...");
    const response = await list({
      prefix: 'bien-ban/',
      token: token,
    });
    
    // Đảm bảo trả về mảng blobs, nếu không có thì trả về mảng rỗng
    return response.blobs || [];
  } catch (error: any) {
    console.error("Lỗi chi tiết khi lấy danh sách tệp Cloud:", error);
    // Nếu lỗi do Token hoặc quyền, thông báo nhẹ cho người dùng
    if (error.message && error.message.includes("403")) {
        console.error("Lỗi 403: Có thể Token không có quyền List hoặc sai Project.");
    }
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
  } catch (error) {
    console.error("Lỗi khi xóa tệp Cloud:", error);
    throw error;
  }
};
