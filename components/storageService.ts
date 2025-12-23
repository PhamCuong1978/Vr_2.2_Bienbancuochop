
import { put, del } from '@vercel/blob';

const REGISTRY_PATH = 'bien-ban/registry.json';
const STORE_URL_CACHE_KEY = 'vercel_blob_store_url';

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
 * Kỹ thuật Discovery: Tìm Base URL của Store
 */
const getStoreBaseUrl = async (token: string): Promise<string | null> => {
    // 1. Thử lấy từ cache
    const cached = localStorage.getItem(STORE_URL_CACHE_KEY);
    if (cached) return cached;

    try {
        // 2. Nếu không có, thực hiện một lệnh put nhỏ để lấy URL
        const blob = await put('system/discovery.txt', 'discovery', {
            access: 'public',
            token: token,
            addRandomSuffix: false
        });
        
        // URL có dạng: https://[store-id].public.blob.vercel-storage.com/system/discovery.txt
        const baseUrl = blob.url.split('/system/')[0];
        localStorage.setItem(STORE_URL_CACHE_KEY, baseUrl);
        return baseUrl;
    } catch (e) {
        console.error("Discovery failed:", e);
        return null;
    }
};

/**
 * Hàm LẤY danh sách từ Sổ cái Registry (Vượt lỗi CORS)
 */
export const listCloudReports = async (): Promise<CloudFileItem[]> => {
    try {
        const token = getBlobToken();
        if (!token) return [];

        const baseUrl = await getStoreBaseUrl(token);
        if (!baseUrl) return [];

        // Đọc trực tiếp tệp registry.json bằng fetch (GET có CORS tốt)
        // Thêm tham số t để tránh cache trình duyệt
        const response = await fetch(`${baseUrl}/${REGISTRY_PATH}?t=${Date.now()}`);
        
        if (response.status === 404) return [];
        if (!response.ok) throw new Error("Registry Error");

        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn("Lấy danh sách từ Cloud thất bại, dùng Local Index làm backup.");
        const local = localStorage.getItem('gemini_cloud_index_v1');
        return local ? JSON.parse(local) : [];
    }
};

/**
 * Hàm CẬP NHẬT Sổ cái Registry
 */
const updateRegistry = async (token: string, newItem: CloudFileItem) => {
    try {
        const currentList = await listCloudReports();
        // Lọc trùng và đưa item mới lên đầu
        const filtered = currentList.filter(item => item.pathname !== newItem.pathname);
        const updated = [newItem, ...filtered];

        // Ghi đè tệp registry.json
        await put(REGISTRY_PATH, JSON.stringify(updated, null, 2), {
            access: 'public',
            contentType: 'application/json',
            token: token,
            addRandomSuffix: false // CỐ ĐỊNH URL ĐỂ FETCH
        });
        
        localStorage.setItem('gemini_cloud_index_v1', JSON.stringify(updated));
    } catch (e) {
        console.error("Update registry failed:", e);
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

  try {
    // 1. Upload tệp HTML
    const pathname = `bien-ban/${fileName}.html`;
    const blob = await put(pathname, htmlContent, {
      access: 'public',
      contentType: 'text/html',
      token: token,
      addRandomSuffix: true
    });
    
    // 2. Cập nhật Registry
    await updateRegistry(token, {
        pathname: pathname,
        url: blob.url,
        uploadedAt: new Date().toISOString()
    });
    
    alert("✅ Đã lưu lên Cloud và đồng bộ thành công!");
    return blob.url;
  } catch (error: any) {
    console.error("Lỗi khi lưu vào Vercel Blob:", error);
    alert(`Lỗi: ${error.message}`);
    return null;
  }
};

/**
 * Hàm xóa tệp tin (Xóa trong Registry và Cloud)
 */
export const deleteCloudReport = async (url: string) => {
    try {
        const token = getBlobToken();
        if (!token) return;

        // 1. Xóa thực thể trên Cloud
        await del(url, { token: token });

        // 2. Cập nhật Registry
        const currentList = await listCloudReports();
        const updated = currentList.filter(item => item.url !== url);
        
        await put(REGISTRY_PATH, JSON.stringify(updated, null, 2), {
            access: 'public',
            contentType: 'application/json',
            token: token,
            addRandomSuffix: false
        });

        localStorage.setItem('gemini_cloud_index_v1', JSON.stringify(updated));
    } catch (e) {
        console.error("Lỗi khi xóa file:", e);
    }
};
