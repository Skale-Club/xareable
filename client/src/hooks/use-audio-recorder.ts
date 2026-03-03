import { useState, useRef, useCallback, useEffect } from "react";

interface AudioRecorderState {
    isRecording: boolean;
    isPaused: boolean;
    duration: number;
    audioBlob: Blob | null;
    audioBase64: string | null;
    waveformData: number[];
    isSupported: boolean;
}

interface UseAudioRecorderOptions {
    maxDuration?: number; // Max recording time in seconds
}

interface UseAudioRecorderReturn extends AudioRecorderState {
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    pauseRecording: () => void;
    resumeRecording: () => void;
    resetRecording: () => void;
    maxDuration: number;
}

const DEFAULT_MAX_DURATION = 120; // 2 minutes

export function useAudioRecorder(options?: UseAudioRecorderOptions): UseAudioRecorderReturn {
    const maxDuration = options?.maxDuration ?? DEFAULT_MAX_DURATION;
    const [state, setState] = useState<AudioRecorderState>({
        isRecording: false,
        isPaused: false,
        duration: 0,
        audioBlob: null,
        audioBase64: null,
        waveformData: [],
        isSupported: typeof navigator !== "undefined" && !!navigator.mediaDevices,
    });

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const startTimeRef = useRef<number>(0);
    const elapsedAtPauseRef = useRef<number>(0);
    const stopRecordingRef = useRef<() => void>(() => {});

    const updateWaveform = useCallback(() => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Sample 32 data points for visualization
        const samples = 32;
        const step = Math.floor(dataArray.length / samples);
        const waveform: number[] = [];

        for (let i = 0; i < samples; i++) {
            const value = dataArray[i * step];
            waveform.push(value / 255); // Normalize to 0-1
        }

        setState((prev) => ({ ...prev, waveformData: waveform }));

        if (mediaRecorderRef.current?.state === "recording") {
            animationFrameRef.current = requestAnimationFrame(updateWaveform);
        }
    }, []);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Close previous AudioContext if any
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }

            // Set up audio analyser for waveform
            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            // Set up MediaRecorder
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported("audio/webm")
                    ? "audio/webm"
                    : "audio/mp4",
            });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, {
                    type: mediaRecorder.mimeType,
                });

                // Convert to base64
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = (reader.result as string).split(",")[1];
                    setState((prev) => ({
                        ...prev,
                        audioBlob,
                        audioBase64: base64,
                        isRecording: false,
                        isPaused: false,
                    }));
                };
                reader.readAsDataURL(audioBlob);

                // Clean up stream and audio context
                stream.getTracks().forEach((track) => track.stop());

                if (audioContextRef.current) {
                    audioContextRef.current.close();
                    audioContextRef.current = null;
                }
                if (animationFrameRef.current) {
                    cancelAnimationFrame(animationFrameRef.current);
                }
                if (durationIntervalRef.current) {
                    clearInterval(durationIntervalRef.current);
                }
            };

            mediaRecorder.start();
            startTimeRef.current = Date.now();
            elapsedAtPauseRef.current = 0;

            // Start duration timer with auto-stop at maxDuration
            durationIntervalRef.current = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
                if (elapsed >= maxDuration) {
                    stopRecordingRef.current();
                    return;
                }
                setState((prev) => ({ ...prev, duration: elapsed }));
            }, 1000);

            // Start waveform visualization
            animationFrameRef.current = requestAnimationFrame(updateWaveform);

            setState((prev) => ({
                ...prev,
                isRecording: true,
                isPaused: false,
                audioBlob: null,
                audioBase64: null,
                waveformData: [],
            }));
        } catch (error) {
            console.error("Error starting recording:", error);
            throw error;
        }
    }, [updateWaveform]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
    }, []);
    stopRecordingRef.current = stopRecording;

    const pauseRecording = useCallback(() => {
        if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.pause();
            // Accumulate elapsed recording time so far
            elapsedAtPauseRef.current += Date.now() - startTimeRef.current;

            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }

            setState((prev) => ({ ...prev, isPaused: true }));
        }
    }, []);

    const resumeRecording = useCallback(() => {
        if (mediaRecorderRef.current?.state === "paused") {
            mediaRecorderRef.current.resume();
            // Reset startTime so elapsed calculation continues from accumulated total
            startTimeRef.current = Date.now();

            // Restart duration timer using accumulated elapsed + new elapsed
            durationIntervalRef.current = setInterval(() => {
                const elapsed = Math.floor(
                    (elapsedAtPauseRef.current + Date.now() - startTimeRef.current) / 1000
                );
                if (elapsed >= maxDuration) {
                    stopRecordingRef.current();
                    return;
                }
                setState((prev) => ({ ...prev, duration: elapsed }));
            }, 1000);

            // Restart waveform visualization
            animationFrameRef.current = requestAnimationFrame(updateWaveform);

            setState((prev) => ({ ...prev, isPaused: false }));
        }
    }, [updateWaveform]);

    const resetRecording = useCallback(() => {
        if (state.isRecording) {
            stopRecording();
        }

        setState({
            isRecording: false,
            isPaused: false,
            duration: 0,
            audioBlob: null,
            audioBase64: null,
            waveformData: [],
            isSupported: state.isSupported,
        });
        audioChunksRef.current = [];
    }, [state.isRecording, state.isSupported, stopRecording]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        };
    }, []);

    return {
        ...state,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        resetRecording,
        maxDuration,
    };
}
