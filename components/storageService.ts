
import { put } from '@vercel/blob';

const CLOUD_INDEX_KEY = 'gemini_cloud_index_v1';

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
 * Hàm lưu vết tệp tin vào bộ nhớ trình duyệt (Local Index)
 */
const addToCloudIndex = (name: string, url: string) => {
    try {
        const raw = localStorage.getItem(CLOUD_INDEX_KEY);
        const index = raw ? JSON.parse(raw) : [];
        const newItem = {
            pathname: `bien-ban/${name}.html`,
            url: url,
            uploadedAt: new Date().toISOString()
        };
        // Thêm vào đầu danh sách
        localStorage.setItem(CLOUD_INDEX_KEY, JSON.stringify([newItem, ...index]));
    } catch (e) {
        console.error("Không thể cập nhật Cloud Index:", e);
    }
};

/**
 * Hàm lưu nội dung HTML vào Vercel Blob
 */
export const saveReportToCloud = async (fileName: string, htmlContent: string) => {
  try {
    const token = getBlobToken();
    if (!token) {
      alert("THIẾU TOKEN: Anh Cường hãy kiểm tra lại cấu hình VITE_BLOB_READ_WRITE_TOKEN.");
      return null;
    }

    // Upload tệp lên Vercel
    const blob = await put(`bien-ban/${fileName}.html`, htmlContent, {
      access: 'public',
      contentType: 'text/html',
      token: token,
    });
    
    // Lưu vết vào Local Index để hiển thị trong tab Cloud Storage
    addToCloudIndex(fileName, blob.url);
    
    alert("✅ Đã lưu lên Cloud thành công!");
    return blob.url;
  } catch (error: any) {
    console.error("Lỗi khi lưu vào Vercel Blob:", error);
    alert(`Lỗi hệ thống: ${error.message}`);
    return null;
  }
};

/**
 * Hàm lấy danh sách tệp từ Local Index (Vì API List bị Vercel chặn CORS trên Client)
 */
export const listCloudReports = async () => {
    try {
        const raw = localStorage.getItem(CLOUD_INDEX_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
};

/**
 * Hàm xóa vết tệp tin trong Local Index
 */
export const deleteCloudReport = async (url: string) => {
    try {
        const raw = localStorage.getItem(CLOUD_INDEX_KEY);
        if (!raw) return;
        const index = JSON.parse(raw);
        const newIndex = index.filter((item: any) => item.url !== url);
        localStorage.setItem(CLOUD_INDEX_KEY, JSON.stringify(newIndex));
    } catch (e) {
        console.error("Lỗi khi xóa vết Cloud Index:", e);
    }
};
