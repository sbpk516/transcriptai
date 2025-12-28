import React, { useRef, useState, useEffect } from 'react';
import { recordingsService } from '../recordingsService';

interface AudioPlayerProps {
    callId: string;
    duration?: number;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ callId, duration = 0 }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
            const progressPercent = (audio.currentTime / (audio.duration || duration || 1)) * 100;
            setProgress(progressPercent);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
        };

        const handleError = () => {
            setIsPlaying(false);
            setError('Failed to load audio');
        };

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('error', handleError);

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('error', handleError);
        };
    }, [duration]);

    const togglePlay = () => {
        if (!audioRef.current) return;

        if (isPlaying) {
            audioRef.current.pause();
        } else {
            // Reset error on retry
            setError(null);
            audioRef.current.play().catch(err => {
                console.error('Playback failed:', err);
                setError('Playback failed');
            });
        }
        setIsPlaying(!isPlaying);
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!audioRef.current) return;
        const newTime = (parseFloat(e.target.value) / 100) * (audioRef.current.duration || duration || 1);
        audioRef.current.currentTime = newTime;
        setProgress(parseFloat(e.target.value));
    };

    const audioUrl = recordingsService.getAudioUrl(callId);

    return (
        <div className="flex flex-col gap-2 w-full bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
            <audio ref={audioRef} src={audioUrl} preload="metadata" />

            <div className="flex items-center gap-3">
                <button
                    onClick={togglePlay}
                    className={`flex items-center justify-center w-10 h-10 rounded-full transition-all ${isPlaying
                            ? 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30'
                            : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                        }`}
                    title={isPlaying ? "Pause" : "Play"}
                >
                    {isPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                            <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5">
                            <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                        </svg>
                    )}
                </button>

                <div className="flex-1 flex flex-col justify-center">
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={progress}
                        onChange={handleSeek}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
                    />
                    <div className="flex justify-between text-xs text-slate-400 mt-1 font-mono">
                        <span>{recordingsService.formatDuration(currentTime)}</span>
                        <span>{recordingsService.formatDuration(duration || audioRef.current?.duration || 0)}</span>
                    </div>
                </div>

                {error && (
                    <div className="text-red-400 text-xs px-2 py-1 bg-red-900/20 rounded border border-red-900/30">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
};
