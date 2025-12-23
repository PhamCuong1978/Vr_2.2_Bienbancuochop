
/**
 * Dịch vụ Lưu trữ Tối giản cho Anh Cường (Bản 2.4.4)
 * Chỉ tập trung vào việc đẩy file HTML lên Cloud.
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
 * Tải trực tiếp file HTML lên Vercel Blob
 */
export const saveReportToCloud = async (fileName: string, htmlContent: string): Promise<string | null> => {
    const token = getBlobToken();
    if (!token) {
        alert("Thiếu Token Vercel để lưu trữ Cloud!");
        return null;
    }

    try {
        const timestamp = Date.now();
        const safeName = fileName.replace(/[/\\?%*:|"<>]/g, '-');
        const pathname = `bien-ban/${safeName}_${timestamp}.html`;
        
        // Endpoint PUT trực tiếp để tránh lỗi CORS phức tạp của SDK
        const url = `https://blob.vercel-storage.com/${pathname}`;

        const response = await fetch(url, {
            method: 'PUT',
            body: htmlContent,
            headers: {
                'authorization': `Bearer ${token}`,
                'x-api-version': '7',
                'content-type': 'text/html'
            }
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Vercel rejected: ${err}`);
        }

        const result = await response.json();
        return result.url; // Trả về link trực tiếp
    } catch (error: any) {
        console.error("Lỗi lưu Cloud:", error);
        alert(`Không thể lưu Cloud: ${error.message}`);
        return null;
    }
};

/**
 * Xóa file trên Cloud bằng URL (nếu cần)
 */
export const deleteCloudFile = async (url: string) => {
    const token = getBlobToken();
    if (!token) return;

    try {
        await fetch(`https://blob.vercel-storage.com/delete`, {
            method: 'POST',
            headers: {
                'authorization': `Bearer ${token}`,
                'content-type': 'application/json',
                'x-api-version': '7'
            },
            body: JSON.stringify({ urls: [url] })
        });
    } catch (e) {
        console.error("Xóa file Cloud thất bại:", e);
    }
};

// Các hàm cũ được giữ lại empty để tránh lỗi import ở các file khác nếu có
export const listCloudReports = async () => [];
export const deleteCloudReport = async (url: string) => {};
