
import { put } from '@vercel/blob';

const INDEX_FILE_PATH = 'system/global_index.json';

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
 * Cấu trúc tệp Index lưu trên Cloud
 */
interface CloudFileItem {
    pathname: string;
    url: string;
    uploadedAt: string;
}

/**
 * Hàm ĐỌC danh sách từ tệp Index trên Cloud (Global)
 */
export const listCloudReports = async (): Promise<CloudFileItem[]> => {
    try {
        const token = getBlobToken();
        if (!token) return [];

        // Chúng ta lấy danh sách bằng cách đọc tệp index.json công khai
        // Để tránh cache của trình duyệt, chúng ta thêm tham số t ngẫu nhiên
        const response = await fetch(`https://v0.blob.vercel-storage.com/${INDEX_FILE_PATH}?t=${Date.now()}`);
        
        if (response.status === 404) {
            console.log("Chưa có tệp Index trên Cloud, khởi tạo danh sách trống.");
            return [];
        }

        if (!response.ok) throw new Error("Không thể đọc danh sách từ Cloud.");
        
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("Lỗi khi tải Global Index:", e);
        // Fallback về localStorage nếu Cloud lỗi
        const localRaw = localStorage.getItem('gemini_cloud_index_v1');
        return localRaw ? JSON.parse(localRaw) : [];
    }
};

/**
 * Hàm CẬP NHẬT danh sách Index trên Cloud
 */
const updateGlobalCloudIndex = async (newItem: CloudFileItem) => {
    try {
        const token = getBlobToken();
        if (!token) return;

        // 1. Lấy danh sách hiện tại
        const currentList = await listCloudReports();
        
        // 2. Thêm mục mới vào đầu (tránh trùng lặp URL)
        const filteredList = currentList.filter(item => item.url !== newItem.url);
        const updatedList = [newItem, ...filteredList];

        // 3. Ghi đè tệp index.json lên Cloud
        await put(INDEX_FILE_PATH, JSON.stringify(updatedList, null, 2), {
            access: 'public',
            contentType: 'application/json',
            token: token,
            addRandomSuffix: false, // Giữ cố định tên tệp index
        });
        
        // Cập nhật thêm vào Local để backup
        localStorage.setItem('gemini_cloud_index_v1', JSON.stringify(updatedList));
    } catch (e) {
        console.error("Lỗi khi cập nhật Global Index:", e);
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

    // 1. Upload tệp biên bản HTML lên Vercel
    const blob = await put(`bien-ban/${fileName}.html`, htmlContent, {
      access: 'public',
      contentType: 'text/html',
      token: token,
    });
    
    // 2. Cập nhật vào "Sổ cái" Global trên Cloud
    const newItem = {
        pathname: `bien-ban/${fileName}.html`,
        url: blob.url,
        uploadedAt: new Date().toISOString()
    };
    
    await updateGlobalCloudIndex(newItem);
    
    alert("✅ Đã lưu lên Cloud và đồng bộ Sổ cái thành công!");
    return blob.url;
  } catch (error: any) {
    console.error("Lỗi khi lưu vào Vercel Blob:", error);
    alert(`Lỗi hệ thống: ${error.message}`);
    return null;
  }
};

/**
 * Hàm xóa vết tệp tin (Chỉ xóa trong Sổ cái)
 */
export const deleteCloudReport = async (url: string) => {
    try {
        const token = getBlobToken();
        if (!token) return;

        const currentList = await listCloudReports();
        const updatedList = currentList.filter(item => item.url !== url);

        await put(INDEX_FILE_PATH, JSON.stringify(updatedList, null, 2), {
            access: 'public',
            contentType: 'application/json',
            token: token,
            addRandomSuffix: false,
        });

        localStorage.setItem('gemini_cloud_index_v1', JSON.stringify(updatedList));
    } catch (e) {
        console.error("Lỗi khi xóa vết Cloud Index:", e);
    }
};
