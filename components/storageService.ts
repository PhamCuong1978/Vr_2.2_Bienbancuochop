
/**
 * Dịch vụ Lưu trữ Chuyên sâu cho Anh Cường
 * Không dùng SDK để tránh lỗi Header của Vercel
 */

const REGISTRY_PATH = 'bien-ban/registry_v3.json';
const STORE_BASE_URL_KEY = 'gemini_store_base_url_v3';

/**
 * Lấy Token bảo mật
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

interface CloudFileItem {
    pathname: string;
    url: string;
    uploadedAt: string;
}

/**
 * Lệnh PUT thuần túy (Thay thế cho SDK)
 * Bypasses CORS header restrictions
 */
const rawPut = async (pathname: string, content: string, contentType: string): Promise<any> => {
    const token = getBlobToken();
    if (!token) throw new Error("Thanh niên Cường ơi, thiếu Token rồi!");

    // Endpoint chuẩn của Vercel Blob API
    const url = `https://blob.vercel-storage.com/${pathname}`;

    const response = await fetch(url, {
        method: 'PUT',
        body: content,
        headers: {
            'authorization': `Bearer ${token}`,
            'x-api-version': '7',
            'content-type': contentType,
            // KHÔNG thêm bất kỳ Header tùy biến nào khác để tránh lỗi CORS Preflight
        }
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Vercel Từ Chối: ${err}`);
    }

    const result = await response.json();
    // Lưu lại Base URL để dùng cho các lần sau (Listing)
    if (result.url) {
        const baseUrl = result.url.split(`/${pathname}`)[0];
        localStorage.setItem(STORE_BASE_URL_KEY, baseUrl);
    }
    return result;
};

/**
 * Hàm lấy danh sách tệp tin
 */
export const listCloudReports = async (): Promise<CloudFileItem[]> => {
    try {
        const baseUrl = localStorage.getItem(STORE_BASE_URL_KEY);
        if (!baseUrl) return [];

        // Lấy Sổ cái Registry qua lệnh GET (Cực nhanh, không bao giờ lỗi CORS)
        const response = await fetch(`${baseUrl}/${REGISTRY_PATH}?t=${Date.now()}`);
        if (!response.ok) return [];

        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
};

/**
 * Hàm lưu biên bản (Cơ chế Registry mới)
 */
export const saveReportToCloud = async (fileName: string, htmlContent: string) => {
    try {
        const token = getBlobToken();
        if (!token) {
            alert("Anh Cường kiểm tra lại Token nhé!");
            return null;
        }

        // 1. Lưu file HTML chính
        const timestamp = Date.now();
        const pathname = `bien-ban/${fileName}_${timestamp}.html`;
        const blob = await rawPut(pathname, htmlContent, 'text/html');

        // 2. Cập nhật Sổ cái Registry
        const currentList = await listCloudReports();
        const newItem: CloudFileItem = {
            pathname: pathname,
            url: blob.url,
            uploadedAt: new Date().toISOString()
        };
        
        const updatedList = [newItem, ...currentList].slice(0, 100); // Giữ tối đa 100 biên bản gần nhất
        
        await rawPut(REGISTRY_PATH, JSON.stringify(updatedList), 'application/json');

        alert("✅ Tuyệt vời anh Cường! Lưu Cloud XONG.");
        return blob.url;
    } catch (error: any) {
        console.error("Lỗi chuyên sâu:", error);
        alert(`Hệ thống báo lỗi: ${error.message}`);
        return null;
    }
};

/**
 * Hàm xóa tệp
 */
export const deleteCloudReport = async (url: string) => {
    const token = getBlobToken();
    if (!token) return;

    try {
        // Với xóa, Vercel Blob API cần DELETE method
        await fetch(`https://blob.vercel-storage.com/delete`, {
            method: 'POST', // Vercel dùng POST cho action delete
            headers: {
                'authorization': `Bearer ${token}`,
                'content-type': 'application/json',
                'x-api-version': '7'
            },
            body: JSON.stringify({ urls: [url] })
        });

        // Cập nhật lại Registry
        const currentList = await listCloudReports();
        const updatedList = currentList.filter(item => item.url !== url);
        await rawPut(REGISTRY_PATH, JSON.stringify(updatedList), 'application/json');
    } catch (e) {
        console.error("Xóa thất bại:", e);
    }
};
