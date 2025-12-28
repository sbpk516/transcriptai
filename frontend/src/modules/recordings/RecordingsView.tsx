import React, { useState, useEffect } from 'react';
import { recordingsService } from './recordingsService';
import type { Call, PipelineResult } from './recordingsService';
import { RecordingCard } from './components/RecordingCard';

export const RecordingsView: React.FC = () => {
    const [calls, setCalls] = useState<Call[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

    // Detail view state
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [detailsCache, setDetailsCache] = useState<Record<string, PipelineResult>>({});
    const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
    const [reanalyzing, setReanalyzing] = useState<Record<string, boolean>>({});

    const fetchDetails = async (callId: string) => {
        if (detailsCache[callId]) return;

        setLoadingDetails(prev => ({ ...prev, [callId]: true }));
        try {
            const data = await recordingsService.getCallDetails(callId);
            setDetailsCache(prev => ({ ...prev, [callId]: data }));
        } catch (err) {
            console.error(`Failed to fetch details for ${callId}`, err);
        } finally {
            setLoadingDetails(prev => ({ ...prev, [callId]: false }));
        }
    };

    const handleExpand = (callId: string) => {
        if (expandedId === callId) {
            setExpandedId(null);
        } else {
            setExpandedId(callId);
            fetchDetails(callId);
        }
    };

    const handleReanalyze = async (callId: string) => {
        setReanalyzing(prev => ({ ...prev, [callId]: true }));
        try {
            await recordingsService.reanalyzeCall(callId);
            // Refresh details after a short delay or poll
            await new Promise(r => setTimeout(r, 1000));
            const data = await recordingsService.getCallDetails(callId);
            setDetailsCache(prev => ({ ...prev, [callId]: data }));
        } catch (err) {
            console.error('Reanalyze failed', err);
            alert('Failed to start re-analysis');
        } finally {
            setReanalyzing(prev => ({ ...prev, [callId]: false }));
        }
    };

    const fetchCalls = async () => {
        setLoading(true);
        try {
            const data = await recordingsService.getCalls();
            setCalls(data);
            setError(null);
        } catch (err) {
            console.error('Error fetching calls:', err);
            setError('Failed to load recordings. Please check if the backend is running.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCalls();
    }, []);

    const handleDelete = async (id: string) => {
        try {
            await recordingsService.deleteCall(id);
            // Optimistic update
            setCalls(calls.filter(call => call.call_id !== id));
        } catch (err) {
            console.error('Failed to delete call:', err);
            // Re-fetch to ensure sync (optional)
            fetchCalls();
        }
    };

    const sortedCalls = [...calls].sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    const stats = {
        total: calls.length,
        completed: calls.filter(c => c.status === 'completed').length,
        inFlight: calls.filter(c => ['processing', 'uploaded'].includes(c.status)).length
    };

    return (
        <div className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden">
            {/* Header Section */}
            <div className="flex-none p-8 pb-4">
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400 mb-2">
                    Transcript history
                </h1>
                <p className="text-slate-400 text-sm mb-6">
                    Review capture history, live-stream status, and AI summaries inside modern cards with subtle glows.
                </p>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-white/5 backdrop-blur-sm">
                        <h2 className="text-4xl font-bold text-white mb-1">{stats.total}</h2>
                        <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Records</p>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-white/5 backdrop-blur-sm">
                        <h2 className="text-4xl font-bold text-white mb-1">{stats.completed}</h2>
                        <p className="text-xs uppercase tracking-wider text-emerald-500/70 font-semibold">Completed</p>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-white/5 backdrop-blur-sm">
                        <h2 className="text-4xl font-bold text-white mb-1">{stats.inFlight}</h2>
                        <p className="text-xs uppercase tracking-wider text-blue-500/70 font-semibold">In Flight</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-blue-400">
                        <span>Transcripts ({calls.length})</span>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={fetchCalls}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}>
                                <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
                            </svg>
                            Refresh
                        </button>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span>Sort by created date</span>
                            <select
                                value={sortOrder}
                                onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
                                className="bg-slate-800 border-none rounded text-slate-200 text-xs py-1 pl-2 pr-6 cursor-pointer focus:ring-1 focus:ring-indigo-500"
                            >
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Scrollable List */}
            <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-3 custom-scrollbar">
                {loading && calls.length === 0 ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-40 text-center">
                        <p className="text-red-400 mb-2">{error}</p>
                        <button onClick={fetchCalls} className="text-indigo-400 hover:text-indigo-300 underline text-sm">Retry</button>
                    </div>
                ) : calls.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-60 text-slate-500">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mb-3 opacity-20">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                        </svg>
                        <p>No recordings found.</p>
                        <p className="text-xs mt-1">Start a new capture to see it here.</p>
                    </div>
                ) : (
                    sortedCalls.map(call => (
                        <RecordingCard
                            key={call.call_id}
                            call={call}
                            onDelete={handleDelete}
                            isExpanded={expandedId === call.call_id}
                            onExpand={handleExpand}
                            details={detailsCache[call.call_id]}
                            loadingDetails={loadingDetails[call.call_id]}
                            onReanalyze={handleReanalyze}
                            isReanalyzing={reanalyzing[call.call_id]}
                        />
                    ))
                )}
            </div>
        </div>
    );
};
