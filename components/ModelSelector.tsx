
import React from 'react';

interface ModelSelectorProps {
    onModelChange: (model: string) => void;
    disabled: boolean;
    initialModel: string;
}

const models = [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Mới nhất - Nhanh & Thông minh)' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Suy luận phức tạp - Deep Reasoning)' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Tiết kiệm - Ổn định)' },
];

const ModelSelector: React.FC<ModelSelectorProps> = ({ onModelChange, disabled, initialModel }) => {
    return (
        <div className="p-4 bg-gray-700/50 rounded-lg">
            <label htmlFor="model-select" className="block text-sm font-medium text-gray-300 mb-2">
                Chọn Model xử lý. Khuyên dùng "Gemini 2.0 Flash" cho tốc độ và chất lượng cân bằng nhất.
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
