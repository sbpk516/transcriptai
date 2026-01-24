import React, { useState, useEffect } from 'react';
import { recordingsService } from './recordingsService';
import type { Call, PipelineResult } from './recordingsService';
import { RecordingCard } from './components/RecordingCard';

export const RecordingsView: React.FC = () => {
    const [calls, setCalls] = useState<Call[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
    const [searchQuery, setSearchQuery] = useState('');

    // Selection state for multi-delete
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);

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
            // Remove from selection if selected
            setSelectedIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        } catch (err) {
            console.error('Failed to delete call:', err);
            // Re-fetch to ensure sync (optional)
            fetchCalls();
        }
    };

    const handleSelect = (id: string, selected: boolean) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (selected) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    };

    const handleSelectAll = (selected: boolean) => {
        if (selected) {
            setSelectedIds(new Set(filteredCalls.map(c => c.call_id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;

        const count = selectedIds.size;
        if (!confirm(`Are you sure you want to delete ${count} recording${count > 1 ? 's' : ''}? This cannot be undone.`)) {
            return;
        }

        setIsDeleting(true);
        try {
            const { deleted, failed } = await recordingsService.deleteCalls(Array.from(selectedIds));

            // Remove deleted items from state
            setCalls(prev => prev.filter(call => !deleted.includes(call.call_id)));
            setSelectedIds(new Set());

            if (failed.length > 0) {
                alert(`Failed to delete ${failed.length} recording${failed.length > 1 ? 's' : ''}. Please try again.`);
            }
        } catch (err) {
            console.error('Bulk delete failed:', err);
            fetchCalls();
        } finally {
            setIsDeleting(false);
        }
    };

    const sortedCalls = [...calls].sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    const filteredCalls = sortedCalls.filter(call => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (call.original_filename || call.call_id).toLowerCase().includes(query) ||
            call.status.toLowerCase().includes(query);
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

                {/* Search Bar */}
                <div className="mb-6 relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="text-slate-500">🔍</span>
                    </div>
                    <input
                        type="text"
                        placeholder="Search transcripts..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-xl border border-white/5 bg-slate-900/50 pl-10 pr-4 py-3 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all backdrop-blur-sm"
                    />
                </div>

                {/* Toolbar */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        {/* Select All Checkbox */}
                        {filteredCalls.length > 0 && (
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={filteredCalls.length > 0 && selectedIds.size === filteredCalls.length}
                                    ref={(el) => {
                                        if (el) {
                                            el.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredCalls.length;
                                        }
                                    }}
                                    onChange={(e) => handleSelectAll(e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 focus:ring-1 cursor-pointer"
                                />
                                <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">
                                    Select all
                                </span>
                            </label>
                        )}

                        {/* Selection Info & Bulk Delete */}
                        {selectedIds.size > 0 && (
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-300">
                                    {selectedIds.size} selected
                                </span>
                                <button
                                    onClick={handleBulkDelete}
                                    disabled={isDeleting}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors border border-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isDeleting ? (
                                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 001.5.06l.3-7.5z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    {isDeleting ? 'Deleting...' : 'Delete selected'}
                                </button>
                            </div>
                        )}

                        {selectedIds.size === 0 && (
                            <div className="flex items-center gap-2 text-sm font-medium text-blue-400">
                                <span>Transcripts ({filteredCalls.length})</span>
                            </div>
                        )}
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
                    filteredCalls.map(call => (
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
                            isSelected={selectedIds.has(call.call_id)}
                            onSelect={handleSelect}
                        />
                    ))
                )}
            </div>
        </div>
    );
};
