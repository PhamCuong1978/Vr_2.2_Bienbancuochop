
/**
 * Application Version Configuration
 * 
 * Quy tắc đánh số (Theo yêu cầu):
 * Patch 0-9 -> Minor 0-9 -> Major
 * 
 * Logic tăng số:
 * - Tăng số cuối (Patch) từ 0 đến 9.
 * - Khi Patch vượt quá 9, reset về 0 và tăng số giữa (Minor).
 * - Khi Minor vượt quá 9, reset về 0 và tăng số đầu (Major).
 * 
 * Ví dụ: 
 * 2.2.0 -> 2.2.1 ... -> 2.2.9 
 * -> 2.3.0 ... -> 2.9.9 
 * -> 3.0.0
 */
export const APP_VERSION = '2.3.3';
