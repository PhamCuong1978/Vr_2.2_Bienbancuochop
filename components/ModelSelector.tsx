
import React from 'react';

interface ModelSelectorProps {
    onModelChange: (model: string) => void;
    disabled: boolean;
    initialModel: string;
}

const models = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Khuyên dùng - Nhanh & Chuẩn)' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro (Suy luận sâu - Tốt nhất cho nội dung khó)' },
    { id: 'gemini-2.5-flash-lite-latest', name: 'Gemini 2.5 Flash Lite (Siêu tốc & Tiết kiệm)' },
];

const ModelSelector: React.FC<ModelSelectorProps> = ({ onModelChange, disabled, initialModel }) => {
    return (
        <div className="p-4 bg-gray-700/50 rounded-lg">
            <label htmlFor="model-select" className="block text-sm font-medium text-gray-300 mb-2">
                Chọn Model AI xử lý văn bản (Transcription):
                <span className="block text-[10px] text-gray-400 font-normal mt-1">
                    * Lưu ý: Các tác vụ phức tạp (Tạo biên bản, Phân biệt giọng) sẽ tự động dùng Gemini 3.0 Pro để đạt chất lượng cao nhất.
                </span>
            </label>
            <select
                id="model-select"
                value={initialModel}
                onChange={(e) => onModelChange(e.target.value)}
                disabled={disabled}
                className="w-full bg-gray-600 border border-gray-500 text-white rounded-lg p-2 focus:ring-cyan-500 focus:border-cyan-500"
            >
                {models.map(model => (
                    <option key={model.id} value={model.id}>
                        {model.name}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default ModelSelector;
