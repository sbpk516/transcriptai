import React, { useState } from 'react';
import { recordingsService } from '../recordingsService';
import type { Call, PipelineResult } from '../recordingsService';
import { AudioPlayer } from './AudioPlayer';
import { useTranscriptionStream } from '../../../services/api/live';
import { exportTranscript, type ExportFormat } from '../../../services/api/results';

interface RecordingCardProps {
    call: Call;
    onDelete: (id: string) => void;
    onExpand?: (id: string) => void;
    isExpanded?: boolean;
    details?: PipelineResult | null;
    loadingDetails?: boolean;
    onReanalyze?: (id: string) => Promise<void>;
    isReanalyzing?: boolean;
}

export const RecordingCard: React.FC<RecordingCardProps> = ({
    call,
    onDelete,
    onExpand,
    isExpanded: controlledExpanded,
    details,
    loadingDetails,
    onReanalyze,
    isReanalyzing,
}) => {
    const [localExpanded, setLocalExpanded] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [formattingEnabled, setFormattingEnabled] = useState(true);
    const [isExporting, setIsExporting] = useState(false);

    const isExpanded = controlledExpanded !== undefined ? controlledExpanded : localExpanded;

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'completed': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            case 'processing': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
            case 'uploaded': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
            case 'failed': return 'bg-red-500/10 text-red-400 border-red-500/20';
            default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
        }
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this recording? This cannot be undone.')) {
            setIsDeleting(true);
            try {
                await onDelete(call.call_id);
            } catch (error) {
                console.error('Delete failed', error);
                setIsDeleting(false);
            }
        }
    };

    const handleDownload = (e: React.MouseEvent) => {
        e.stopPropagation();
        const url = recordingsService.getAudioUrl(call.call_id);
        const link = document.createElement('a');
        link.href = url;
        link.download = call.original_filename || `recording-${call.call_id}.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div
            className={`group relative bg-slate-800/40 rounded-xl border border-white/5 overflow-hidden hover:bg-slate-800/60 hover:border-white/10 transition-all duration-300 ${isExpanded ? 'ring-1 ring-indigo-500/30 bg-slate-800/80 shadow-lg shadow-black/20' : ''
                }`}
        >
            {/* Main card content - clickable to expand */}
            <div
                onClick={() => {
                    if (onExpand) {
                        onExpand(call.call_id);
                    } else {
                        setLocalExpanded(!localExpanded);
                    }
                }}
                className="p-4 cursor-pointer select-none"
            >
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${getStatusColor(call.status)} bg-opacity-10`}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                                <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                                <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
                                {call.original_filename || `Recording ${call.call_id.substring(0, 8)}`}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span className="flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                        <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
                                    </svg>
                                    {recordingsService.formatDate(call.created_at)}
                                </span>
                                <span className="w-1 h-1 rounded-full bg-slate-700"></span>
                                <span className="font-mono">{recordingsService.formatDuration(call.duration || 0)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">


                        {/* Copy Button */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (details?.transcription?.transcription_text) {
                                    navigator.clipboard.writeText(details.transcription.transcription_text);
                                } else if (onExpand) {
                                    // If not loaded, expand first
                                    onExpand(call.call_id);
                                    // Just a hint, actual copy relies on details being there
                                }
                            }}
                            title="Copy Transcript"
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path fillRule="evenodd" d="M13.887 3.182c.396.037.79.08 1.183.128C16.194 3.45 17 4.414 17 5.517V16.75A2.25 2.25 0 0114.75 19h-9.5A2.25 2.25 0 013 16.75V5.517c0-1.103.806-2.068 1.93-2.207.393-.048.787-.09 1.183-.128A3.001 3.001 0 019 1h2c1.373 0 2.531.923 2.887 2.182zM7.5 4A1.5 1.5 0 019 2.5h2A1.5 1.5 0 0112.5 4v.5h-5V4z" clipRule="evenodd" />
                            </svg>
                        </button>

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onExpand) {
                                    onExpand(call.call_id);
                                } else {
                                    setLocalExpanded(!localExpanded);
                                }
                            }}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                            </svg>
                        </button>
                    </div>
                </div>

                {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-slate-700/50 space-y-4 animate-fadeIn" onClick={e => e.stopPropagation()}>
                        {/* Audio Player in separate container to avoid re-renders */}
                        <div className="p-1">
                            <AudioPlayer callId={call.call_id} duration={call.duration} />
                        </div>

                        {/* Live Transcript / Details */}
                        {['processing', 'transcribing'].includes(call.status) ? (
                            <div className="bg-slate-900/40 rounded-lg p-4 border border-indigo-500/20">
                                <h4 className="text-xs font-semibold text-indigo-400 mb-2 uppercase tracking-wide">Live Transcription</h4>
                                <LiveTranscript callId={call.call_id} />
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Toolbar (Matches Design) */}
                                <div className="flex flex-wrap items-center justify-between gap-3 p-2 bg-slate-900/50 rounded-lg border border-white/5">
                                    <div className="flex items-center gap-1 bg-slate-800/80 rounded-lg p-1 border border-white/5">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setFormattingEnabled(false); }}
                                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${!formattingEnabled ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                                        >
                                            Plain
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setFormattingEnabled(true); }}
                                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${formattingEnabled ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                                        >
                                            Formatted
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const text = details?.transcription?.transcription_text;
                                                if (text) {
                                                    navigator.clipboard.writeText(text);
                                                    // Visual feedback handled by button state or toast usually,
                                                    // but for now we'll just rely on the click.
                                                }
                                            }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                                <path fillRule="evenodd" d="M13.887 3.182c.396.037.79.08 1.183.128C16.194 3.45 17 4.414 17 5.517V16.75A2.25 2.25 0 0114.75 19h-9.5A2.25 2.25 0 013 16.75V5.517c0-1.103.806-2.068 1.93-2.207.393-.048.787-.09 1.183-.128A3.001 3.001 0 019 1h2c1.373 0 2.531.923 2.887 2.182zM7.5 4A1.5 1.5 0 019 2.5h2A1.5 1.5 0 0112.5 4v.5h-5V4z" clipRule="evenodd" />
                                            </svg>
                                            Copy
                                        </button>
                                        <div className="relative">
                                            <select
                                                onClick={(e) => e.stopPropagation()}
                                                disabled={isExporting}
                                                value=""
                                                onChange={async (e) => {
                                                    e.stopPropagation();
                                                    const format = e.target.value as ExportFormat;
                                                    if (!format) return;

                                                    try {
                                                        setIsExporting(true);
                                                        const blob = await exportTranscript(call.call_id, format);

                                                        // Get filename
                                                        const baseName = (call.original_filename || 'transcript').replace(/\.[^.]+$/, '');

                                                        // Download the file
                                                        const url = URL.createObjectURL(blob);
                                                        const a = document.createElement('a');
                                                        a.download = `${baseName}.${format}`;
                                                        a.href = url;
                                                        document.body.appendChild(a);
                                                        a.click();
                                                        document.body.removeChild(a);
                                                        URL.revokeObjectURL(url);
                                                    } catch (err) {
                                                        console.error('Export failed:', err);
                                                        alert('Export failed. Please try again.');
                                                    } finally {
                                                        setIsExporting(false);
                                                    }
                                                }}
                                                className="appearance-none flex items-center gap-1.5 pl-8 pr-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <option value="" disabled>
                                                    {isExporting ? 'Exporting...' : 'Download'}
                                                </option>
                                                <option value="txt">TXT</option>
                                                <option value="docx">DOCX</option>
                                                <option value="pdf">PDF</option>
                                            </select>
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                                <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                                                <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>

                                {/* Reanalyze Action (Moved below toolbar if needed, or kept) */}
                                <div className="flex justify-end">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (onReanalyze) onReanalyze(call.call_id);
                                        }}
                                        disabled={isReanalyzing}
                                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 ${isReanalyzing ? 'animate-spin' : ''}`}>
                                            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
                                        </svg>
                                        {isReanalyzing ? 'Reanalyzing...' : 'Re-analyze Audio'}
                                    </button>
                                </div>

                                {/* Transcript Text */}
                                {loadingDetails ? (
                                    <div className="flex items-center gap-2 text-sm text-slate-500">
                                        <div className="w-2 h-2 rounded-full bg-slate-500 animate-pulse"></div>
                                        Loading details...
                                    </div>
                                ) : details?.transcription?.transcription_text ? (
                                    <div className="bg-slate-900/30 rounded-xl p-4 border border-white/5 font-mono text-sm leading-relaxed text-slate-300 max-h-[400px] overflow-y-auto custom-scrollbar">
                                        {formattingEnabled ? (
                                            <FormattedText text={details.transcription.transcription_text} />
                                        ) : (
                                            <p className="whitespace-pre-wrap">{details.transcription.transcription_text}</p>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500 italic">No transcript available.</p>
                                )}

                                {/* NLP Stats */}
                                {details?.nlp_analysis && (
                                    <div className="grid grid-cols-3 gap-4 border-t border-slate-700/50 pt-4">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Sentiment</p>
                                            <p className="text-sm font-medium text-slate-200 capitalize">{details.nlp_analysis.sentiment?.overall || 'Neutral'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Intent</p>
                                            <p className="text-sm font-medium text-slate-200 capitalize">{details.nlp_analysis.intent?.detected || 'None'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Risk</p>
                                            <p className="text-sm font-medium text-slate-200 capitalize">{details.nlp_analysis.risk?.escalation_risk || 'Low'}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex items-center justify-between pt-2">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleDownload}
                                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 mr-1.5">
                                        <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                                        <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                                    </svg>
                                    Download Audio
                                    <span className="ml-1.5 text-slate-500 hidden sm:inline">({recordingsService.formatBytes(call.file_size_bytes || 0)})</span>
                                </button>
                            </div>

                            <button
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors"
                            >
                                {isDeleting ? (
                                    <svg className="w-3.5 h-3.5 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 mr-1.5">
                                        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 001.5.06l.3-7.5z" clipRule="evenodd" />
                                    </svg>
                                )}
                                {isDeleting ? 'Deleting...' : 'Delete Recording'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};


function LiveTranscript({ callId }: { callId: string }) {
    const { text, completed, error, progress } = useTranscriptionStream(callId);
    return (
        <div className="space-y-2">
            {progress !== null && !completed && (
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                </div>
            )}
            <p className="text-sm text-slate-300 font-mono leading-relaxed whitespace-pre-wrap min-h-[60px]">
                {text || (completed ? '' : 'Waiting for live transcription...')}
            </p>
            {error && <p className="text-xs text-red-400">Connection lost. Check network.</p>}
        </div>
    );
}

import { formatTranscript } from '../../../utils/transcript';

const FormattedText: React.FC<{ text: string }> = ({ text }) => {
    const paragraphs = formatTranscript(text, { sentencesPerParagraph: 3, preserveExistingNewlines: true });
    return (
        <div className="space-y-4">
            {paragraphs.map((p, i) => (
                <p key={i} className="text-slate-300 leading-relaxed font-sans text-base">
                    {p}
                </p>
            ))}
        </div>
    );
};

