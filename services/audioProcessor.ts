
import { ProcessingOptions } from '../components/Options';

// Fix: Add a global declaration for `webkitAudioContext` to support older browsers.
declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}

/**
 * Encodes an AudioBuffer into a WAV file blob.
 * @param buffer The AudioBuffer to encode.
 * @returns A Blob containing the WAV file data.
 */
const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    
    // Safety check for size > 2GB (browser limit for ArrayBuffer)
    if (length > 2 * 1024 * 1024 * 1024) {
        throw new Error("Generated audio file exceeds browser memory limits (2GB).");
    }

    let bufferArray;
    try {
        bufferArray = new ArrayBuffer(length);
    } catch (e) {
        throw new Error("Failed to allocate memory for processed audio. Try a smaller file or split it.");
    }

    const view = new DataView(bufferArray);
    const channels: Float32Array[] = [];
    let i, sample;
    let pos = 0;

    const setUint16 = (data: number) => {
        view.setUint16(pos, data, true);
        pos += 2;
    };
    const setUint32 = (data: number) => {
        view.setUint32(pos, data, true);
        pos += 4;
    };

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8);
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);
    setUint32(0x61746164); // "data" chunk
    setUint32(length - pos - 4);

    for (i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    let offset = 0;
    while (offset < buffer.length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
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
    
    // CRITICAL FIX: Manage AudioContext lifecycle to prevent "Max AudioContexts" error on Vercel/Browsers
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();

    try {
        const arrayBuffer = await file.arrayBuffer();
        try {
            originalBuffer = await audioContext.decodeAudioData(arrayBuffer);
        } catch (decodeError) {
            throw new Error("Audio decoding failed. The file may be corrupt or in a format not supported by your browser.");
        }
        
        let processedBuffer = originalBuffer;
        
        const needsProcessing = Object.values(options).some(v => v);
        
        // If no processing needed, just return original. 
        if (!needsProcessing) {
            return file;
        }

        // Step 1: Resample to 16kHz and convert to mono.
        // Protected by try/catch because OfflineAudioContext can also hit resource limits.
        if (options.convertToMono16kHz) {
            try {
                const targetSampleRate = 16000;
                const offlineContext = new OfflineAudioContext(1, originalBuffer.duration * targetSampleRate, targetSampleRate);
                const source = offlineContext.createBufferSource();
                source.buffer = originalBuffer;
                source.connect(offlineContext.destination);
                source.start(0);
                processedBuffer = await offlineContext.startRendering();
            } catch (offlineError) {
                console.warn("Offline Audio Processing failed, skipping resampling:", offlineError);
                // Fallback: Continue with original buffer if resampling fails
                processedBuffer = originalBuffer;
            }
        }

        let channelData = processedBuffer.getChannelData(0);

        // Step 2: Remove Silence (Pure JS processing, safe)
        if (options.removeSilence) {
            const silenceThreshold = 0.01; // -40dBFS
            const minSilenceDuration = 0.3; // 300ms
            const paddingDuration = 0.1; // 100ms
            const sampleRate = processedBuffer.sampleRate;
            const minSilenceSamples = Math.floor(minSilenceDuration * sampleRate);
            const paddingSamples = Math.floor(paddingDuration * sampleRate);

            const soundIntervals: { start: number; end: number }[] = [];
            let inSound = false;
            let soundStart = 0;

            for (let i = 0; i < channelData.length; i++) {
                if (!inSound && Math.abs(channelData[i]) > silenceThreshold) {
                    inSound = true;
                    soundStart = i;
                } else if (inSound && Math.abs(channelData[i]) < silenceThreshold) {
                    let silenceEnd = i;
                    while (silenceEnd < channelData.length && Math.abs(channelData[silenceEnd]) < silenceThreshold) {
                        silenceEnd++;
                    }
                    if ((silenceEnd - i) >= minSilenceSamples) {
                        inSound = false;
                        soundIntervals.push({ start: soundStart, end: i });
                    }
                    i = silenceEnd -1;
                }
            }
            if(inSound) soundIntervals.push({ start: soundStart, end: channelData.length });
            
            if (soundIntervals.length > 0) {
                const totalLength = soundIntervals.reduce((sum, interval) => sum + (interval.end - interval.start) + paddingSamples * 2, 0);
                const newBuffer = new AudioBuffer({ length: totalLength, numberOfChannels: 1, sampleRate: sampleRate });
                const newChannelData = newBuffer.getChannelData(0);
                let offset = 0;
                soundIntervals.forEach(interval => {
                    const segment = channelData.slice(interval.start, interval.end);
                    // Add padding
                    offset += paddingSamples; 
                    newChannelData.set(segment, offset);
                    offset += segment.length;
                    offset += paddingSamples;
                });
                processedBuffer = newBuffer;
                channelData = newChannelData;
            } else {
                 // Handle empty result
                 processedBuffer = new AudioBuffer({ length: sampleRate, numberOfChannels: 1, sampleRate: sampleRate });
                 channelData = processedBuffer.getChannelData(0);
            }
        }

        // Step 3: Noise Reduction (simple gate)
        if (options.noiseReduction) {
            const noiseThreshold = 0.02; // -34dBFS
            const reductionAmount = 0.2; // Reduce to 20% volume
            for (let i = 0; i < channelData.length; i++) {
                if (Math.abs(channelData[i]) < noiseThreshold) {
                    channelData[i] *= reductionAmount;
                }
            }
        }
        
        // Step 4: Normalize Volume
        if (options.normalizeVolume) {
            const max = channelData.reduce((max, val) => Math.max(max, Math.abs(val)), 0);
            if (max > 0.001) {
                const targetPeak = 0.95; // -0.44 dBFS
                const gainValue = targetPeak / max;
                for(let i=0; i<channelData.length; i++) {
                    channelData[i] *= gainValue;
                }
            }
        }

        const wavBlob = audioBufferToWav(processedBuffer);
        const originalFileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        const newFileName = `${originalFileName}_processed.wav`;

        return new File([wavBlob], newFileName, { type: 'audio/wav' });

    } catch (error) {
        console.error("Failed to process audio:", error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error("An unexpected error occurred during audio pre-processing.");
    } finally {
        // IMPORTANT: Close the audio context to free up hardware resources.
        if (audioContext && audioContext.state !== 'closed') {
            await audioContext.close();
        }
    }
};
