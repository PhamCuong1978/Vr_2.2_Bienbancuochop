
import { put, list, del } from '@vercel/blob';

/**
 * Hàm lấy Token từ biến môi trường
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
 * Cấu trúc tệp tin trên Cloud
 */
interface CloudFileItem {
    pathname: string;
    url: string;
    uploadedAt: string;
}

/**
 * Hàm LẤY TOÀN BỘ danh sách tệp tin từ Cloud
 * Sử dụng SDK chính thức của Vercel để tránh lỗi CORS và Treo UI
 */
export const listCloudReports = async (): Promise<CloudFileItem[]> => {
    try {
        const token = getBlobToken();
        if (!token) return [];

        // Sử dụng hàm list() của SDK để lấy danh sách thực tế từ thư mục bien-ban/
        const { blobs } = await list({
            prefix: 'bien-ban/',
            token: token,
        });

        // Chuyển đổi định dạng về CloudFileItem
        return blobs.map(blob => ({
            pathname: blob.pathname,
            url: blob.url,
            uploadedAt: blob.uploadedAt.toISOString()
        })).sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    } catch (e: any) {
        console.error("Lỗi khi lấy danh sách từ Vercel Cloud:", e);
        return [];
    }
};

/**
 * Hàm lưu nội dung HTML vào Vercel Blob
 */
export const saveReportToCloud = async (fileName: string, htmlContent: string) => {
  const token = getBlobToken();
  if (!token) {
    alert("THIẾU TOKEN: Anh Cường hãy kiểm tra lại cấu hình VITE_BLOB_READ_WRITE_TOKEN.");
    return null;
  }

  // Tạo một Promise có giới hạn thời gian (Timeout) 15 giây để tránh treo UI
  const uploadPromise = put(`bien-ban/${fileName}.html`, htmlContent, {
    access: 'public',
    contentType: 'text/html',
    token: token,
    addRandomSuffix: true, // Vercel khuyên dùng để tránh cache
  });

  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Quá thời gian phản hồi từ máy chủ (15s).")), 15000)
  );

  try {
    // Chạy đua giữa việc Upload và Timeout
    const blob: any = await Promise.race([uploadPromise, timeoutPromise]);
    
    alert("✅ Đã lưu lên Cloud thành công!");
    return blob.url;
  } catch (error: any) {
    console.error("Lỗi khi lưu vào Vercel Blob:", error);
    alert(`Lỗi: ${error.message}`);
    return null;
  }
};

/**
 * Hàm xóa tệp tin trên Cloud (Xóa thực thể)
 */
export const deleteCloudReport = async (url: string) => {
    try {
        const token = getBlobToken();
        if (!token) return;

        // Xóa trực tiếp file trên Vercel Blob bằng URL
        await del(url, { token: token });
        console.log("Đã xóa file trên Cloud:", url);
    } catch (e) {
        console.error("Lỗi khi xóa file trên Cloud:", e);
    }
};
