
import { ProcessingOptions } from '../components/Options';

// Fix: Add a global declaration for `webkitAudioContext` to support older browsers.
declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}

/**
 * Encodes an AudioBuffer into a WAV file blob.
 * Standard 16-bit PCM WAV format.
 */
const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numChannels = 1; // Force Mono for stability with Gemini
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    // Flatten to mono if needed
    let channelData = buffer.getChannelData(0);
    if (buffer.numberOfChannels > 1) {
        // Simple downmix if strictly needed, but usually we handle this in processing
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        const mono = new Float32Array(left.length);
        for (let i = 0; i < left.length; i++) {
            mono[i] = (left[i] + right[i]) / 2;
        }
        channelData = mono;
    }

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const bufferLength = channelData.length;
    const byteRate = sampleRate * blockAlign;
    const dataSize = bufferLength * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    let offset = 0;

    // RIFF identifier
    writeString(view, offset, 'RIFF'); offset += 4;
    // file length
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    // RIFF type
    writeString(view, offset, 'WAVE'); offset += 4;
    // format chunk identifier
    writeString(view, offset, 'fmt '); offset += 4;
    // format chunk length
    view.setUint32(offset, 16, true); offset += 4;
    // sample format (raw)
    view.setUint16(offset, format, true); offset += 2;
    // channel count
    view.setUint16(offset, numChannels, true); offset += 2;
    // sample rate
    view.setUint32(offset, sampleRate, true); offset += 4;
    // byte rate (sample rate * block align)
    view.setUint32(offset, byteRate, true); offset += 4;
    // block align (channel count * bytes per sample)
    view.setUint16(offset, blockAlign, true); offset += 2;
    // bits per sample
    view.setUint16(offset, bitDepth, true); offset += 2;
    // data chunk identifier
    writeString(view, offset, 'data'); offset += 4;
    // data chunk length
    view.setUint32(offset, dataSize, true); offset += 4;

    // Write PCM samples
    for (let i = 0; i < bufferLength; i++) {
        let sample = Math.max(-1, Math.min(1, channelData[i]));
        // Convert float to 16-bit PCM
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, sample, true);
        offset += 2;
    }

    return new Blob([view], { type: "audio/wav" });
};

/**
 * Processes an audio file based on selected options.
 * @param file The original audio file.
 * @param options The processing options selected by the user.
 * @returns A promise that resolves to the processed WAV file.
 */
export const processAudio = async (file: File, options: ProcessingOptions): Promise<File> => {
    let originalBuffer: AudioBuffer;
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        try {
            originalBuffer = await audioContext.decodeAudioData(arrayBuffer);
        } catch (decodeError) {
            console.error("Decoding error", decodeError);
            throw new Error("Audio decoding failed. The file may be corrupt or in a format not supported by your browser.");
        }
        
        // If no processing is needed, strictly return original to avoid conversion artifacts
        // UNLESS the file is likely unsupported by Gemini directly (e.g. some m4a or weird codecs), 
        // but Gemini supports most. However, users select options to improve quality.
        const needsProcessing = Object.values(options).some(v => v);
        
        // Always process if options are selected OR if we want to ensure standard WAV format to fix the "F F F" issue
        // We will default to processing to sanitize the audio container.
        
        let processedBuffer = originalBuffer;
        
        // Step 1: Resample to 16kHz and convert to mono for consistency.
        // This is crucial for Gemini to minimize tokens and hallucinations.
        const targetSampleRate = 16000;
        
        // Use OfflineAudioContext for faster-than-realtime processing
        // We force mono (1 channel) and 16kHz here.
        const offlineContext = new OfflineAudioContext(1, (originalBuffer.duration * targetSampleRate), targetSampleRate);
        const source = offlineContext.createBufferSource();
        source.buffer = originalBuffer;
        
        // Create a processing chain
        let currentNode: AudioNode = source;
        
        // Step 4: Normalize Volume (Apply BEFORE rendering if possible, but easier to do on buffer data)
        // We will do data-level manipulation after rendering for silence and normalization to be precise.
        
        currentNode.connect(offlineContext.destination);
        source.start(0);
        
        processedBuffer = await offlineContext.startRendering();

        let channelData = processedBuffer.getChannelData(0);

        // Step 3: Noise Reduction (Simple Gate)
        if (options.noiseReduction) {
            const noiseThreshold = 0.015; // Adjusted threshold
            for (let i = 0; i < channelData.length; i++) {
                if (Math.abs(channelData[i]) < noiseThreshold) {
                    channelData[i] = 0; // Hard gate for silence
                }
            }
        }

        // Step 2: Remove Silence (Aggressive trimming)
        if (options.removeSilence) {
            const silenceThreshold = 0.01;
            const minSilenceDuration = 0.5; // 500ms
            const paddingSamples = Math.floor(0.1 * targetSampleRate); // 100ms padding
            const minSilenceSamples = Math.floor(minSilenceDuration * targetSampleRate);
            
            const chunks: Float32Array[] = [];
            let isSilent = true;
            let chunkStart = 0;
            let silenceStart = 0;
            let totalLength = 0;

            // Simple state machine to identify speech segments
            for (let i = 0; i < channelData.length; i++) {
                const amp = Math.abs(channelData[i]);
                
                if (amp > silenceThreshold) {
                    if (isSilent) {
                        // Speech starts
                        isSilent = false;
                        // backtrack to include padding if possible
                        chunkStart = Math.max(0, i - paddingSamples);
                    }
                } else {
                    if (!isSilent) {
                        // Potential silence starts
                        silenceStart = i;
                        isSilent = true;
                    } else {
                        // Continuing silence
                        if ((i - silenceStart) > minSilenceSamples) {
                            // Valid silence gap confirmed.
                            // Cut the previous chunk
                            const chunkEnd = Math.min(channelData.length, silenceStart + paddingSamples);
                            const chunk = channelData.slice(chunkStart, chunkEnd);
                            if (chunk.length > 0) {
                                chunks.push(chunk);
                                totalLength += chunk.length;
                            }
                            // Reset start for next potential chunk, effectively skipping this silence
                            // We stay in isSilent state until amp > threshold again
                        }
                    }
                }
            }
            
            // Handle end of file
            if (!isSilent) {
                 const chunk = channelData.slice(chunkStart);
                 chunks.push(chunk);
                 totalLength += chunk.length;
            } else if (chunks.length === 0 && channelData.length > 0) {
                 // If the whole file was "silent" but processed, keep it to avoid empty errors
                 // Or it implies the file is empty.
                 // Let's keep original if we detected nothing, usually safer.
            }

            if (chunks.length > 0) {
                const newBuffer = new AudioBuffer({
                    length: totalLength,
                    numberOfChannels: 1,
                    sampleRate: targetSampleRate
                });
                const newData = newBuffer.getChannelData(0);
                let offset = 0;
                for (const chunk of chunks) {
                    newData.set(chunk, offset);
                    offset += chunk.length;
                }
                processedBuffer = newBuffer;
                channelData = processedBuffer.getChannelData(0);
            }
        }
        
        // Step 4: Normalize Volume
        if (options.normalizeVolume) {
            let maxAmp = 0;
            for (let i = 0; i < channelData.length; i++) {
                if (Math.abs(channelData[i]) > maxAmp) maxAmp = Math.abs(channelData[i]);
            }
            if (maxAmp > 0.001 && maxAmp < 0.9) {
                const gain = 0.9 / maxAmp;
                for (let i = 0; i < channelData.length; i++) {
                    channelData[i] *= gain;
                }
            }
        }

        const wavBlob = audioBufferToWav(processedBuffer);
        const originalFileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        const newFileName = `${originalFileName}_processed.wav`;

        return new File([wavBlob], newFileName, { type: 'audio/wav' });

    } catch (error) {
        console.error("Failed to process audio:", error);
        // Fallback: Return original file if processing fails to ensure user can still try
        // But warn in console.
        return file;
    }
};
