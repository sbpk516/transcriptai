import { apiClient } from '../../services/api/client';
import { API_BASE_URL } from '../../types/constants';

export interface Call {
    id: number;
    call_id: string;
    status: string;
    duration?: number;
    original_filename?: string;
    file_size_bytes?: number;
    created_at: string;
}

export interface ProcessingStatus {
    call_id: string;
    found: boolean;
    status: string;
    processing_stage: string;
    has_transcript: boolean;
    has_analysis: boolean;
    transcript_summary?: {
        language: string;
        confidence: number;
    };
    analysis_summary?: {
        intents: string[];
        count: number;
    };
}

export interface PipelineResult {
    call_id: string;
    status: string;
    created_at: string;
    audio_url?: string;
    transcription?: {
        transcription_text: string;
        language: string;
        confidence: number;
    };
    nlp_analysis?: {
        sentiment?: {
            overall: string;
            confidence: number;
        };
        intent?: {
            detected: string;
            confidence: number;
        };
        risk?: {
            escalation_risk: string;
            reason?: string;
        };
        summary?: string;
        topics?: string[];
    };
    file_info?: {
        original_filename: string;
        file_size: number;
        file_path: string;
    };
}

export const recordingsService = {
    getCalls: async (): Promise<Call[]> => {
        try {
            const response = await apiClient.get('/api/v1/calls');
            return response.data.calls || [];
        } catch (error) {
            console.error('Failed to fetch calls:', error);
            throw error;
        }
    },

    getCallStatus: async (callId: string): Promise<ProcessingStatus> => {
        try {
            const response = await apiClient.get(`/api/v1/calls/${callId}/status`);
            return response.data;
        } catch (error) {
            console.error(`Failed to fetch status for call ${callId}:`, error);
            throw error;
        }
    },

    getCallDetails: async (callId: string): Promise<PipelineResult> => {
        try {
            const response = await apiClient.get(`/api/v1/pipeline/results/${callId}`);
            return response.data.data;
        } catch (error) {
            console.error(`Failed to fetch details for call ${callId}:`, error);
            throw error;
        }
    },

    reanalyzeCall: async (callId: string): Promise<void> => {
        try {
            await apiClient.post(`/api/v1/pipeline/reanalyze/${callId}`);
        } catch (error) {
            console.error(`Failed to reanalyze call ${callId}:`, error);
            throw error;
        }
    },

    deleteCall: async (callId: string): Promise<void> => {
        try {
            await apiClient.delete(`/api/v1/calls/${callId}`);
        } catch (error) {
            console.error(`Failed to delete call ${callId}:`, error);
            throw error;
        }
    },

    getAudioUrl: (callId: string): string => {
        // If API_BASE_URL already has a trailing slash, handle it (though usually it doesn't)
        const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
        return `${base}/api/v1/audio/${callId}`;
    },

    formatDuration: (seconds: number): string => {
        if (!seconds) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    formatDate: (dateString: string): string => {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    formatBytes: (bytes: number, decimals = 2): string => {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
};
