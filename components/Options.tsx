import React from 'react';

export interface ProcessingOptions {
    convertToMono16kHz: boolean;
    noiseReduction: boolean;
    normalizeVolume: boolean;
    removeSilence: boolean;
    identifySpeakers: boolean;
    speakerCount?: number; // New option
}

interface OptionsProps {
    disabled: boolean;
    options: ProcessingOptions;
    onOptionChange: (newOptions: ProcessingOptions) => void;
}

const OptionCheckbox: React.FC<{ label: string; disabled: boolean; checked: boolean; onChange: (checked: boolean) => void }> = ({ label, disabled, checked, onChange }) => (
    <label className={`flex items-center space-x-3 p-2 rounded hover:bg-gray-600/30 transition-colors ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input 
            type="checkbox"
            className="form-checkbox h-5 w-5 bg-gray-600 border-gray-500 rounded text-cyan-500 focus:ring-cyan-500 focus:ring-offset-gray-800"
            disabled={disabled}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-gray-300 text-sm font-medium">{label}</span>
    </label>
);


const Options: React.FC<OptionsProps> = ({ disabled, options, onOptionChange }) => {
    
    const handleOptionChange = (option: keyof ProcessingOptions, value: any) => {
        onOptionChange({ ...options, [option]: value });
    };

    return (
        <div className="space-y-2 p-5 bg-gray-800 rounded-xl border border-gray-700 shadow-sm">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Tùy chọn xử lý âm thanh</h3>
            
            <OptionCheckbox label="Convert to mono & 16kHz" disabled={disabled} checked={options.convertToMono16kHz} onChange={v => handleOptionChange('convertToMono16kHz', v)} />
            <OptionCheckbox label="Apply noise reduction" disabled={disabled} checked={options.noiseReduction} onChange={v => handleOptionChange('noiseReduction', v)} />
            <OptionCheckbox label="Normalize volume" disabled={disabled} checked={options.normalizeVolume} onChange={v => handleOptionChange('normalizeVolume', v)} />
            <OptionCheckbox label="Remove silence" disabled={disabled} checked={options.removeSilence} onChange={v => handleOptionChange('removeSilence', v)} />
            
            <div className="border-t border-gray-700 my-2 pt-2 space-y-2">
                 <OptionCheckbox label="Identify Speakers (Diarization)" disabled={disabled} checked={options.identifySpeakers} onChange={v => handleOptionChange('identifySpeakers', v)} />
                 
                 {options.identifySpeakers && (
                    <div className="ml-8 animate-fade-in p-3 bg-gray-900/50 rounded-lg border border-gray-700/50">
                        <label className="block text-xs text-cyan-400 font-semibold mb-1.5">
                            Số lượng người tham gia (Ước tính):
                        </label>
                        <input 
                            type="number" 
                            min="1" 
                            max="20"
                            placeholder="VD: 4"
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                            value={options.speakerCount || ''}
                            onChange={(e) => handleOptionChange('speakerCount', e.target.value ? parseInt(e.target.value) : undefined)}
                            disabled={disabled}
                        />
                        <p className="text-[10px] text-gray-500 mt-2 leading-tight">
                            * Giúp AI phân biệt giọng tốt hơn, tránh tạo ra người ảo.
                        </p>
                    </div>
                 )}
            </div>
        </div>
    );
};

export default Options;