"""
Unified audio enhancement pipeline combining VAD and noise suppression.
Single entry point for all audio preprocessing before transcription.

This module provides a simple interface to apply both noise suppression
and voice activity detection to audio files before sending to Whisper.
"""
import os
import logging
import tempfile
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass, field

logger = logging.getLogger('transcriptai.audio_enhancer')


@dataclass
class EnhancementResult:
    """Result of audio enhancement processing."""
    original_path: str
    enhanced_path: str
    noise_reduced: bool = False
    vad_applied: bool = False
    speech_detected: bool = True
    speech_ratio: float = 1.0
    should_skip: bool = False
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        """Return True if enhancement completed without critical errors."""
        return self.error is None


class AudioEnhancer:
    """
    Unified audio enhancement pipeline.

    Combines noise suppression and VAD into a single processing pipeline.
    Both features can be enabled/disabled independently via configuration.

    Usage:
        enhancer = get_audio_enhancer()

        # Full enhancement (noise + VAD)
        result = enhancer.enhance(audio_path)
        if result.should_skip:
            # No speech detected, skip transcription
            return ""

        # Quick VAD check only
        if enhancer.should_skip_chunk(audio_path):
            return ""  # Silent chunk

        # Use enhanced audio for transcription
        transcribe(result.enhanced_path)
    """

    def __init__(self):
        """Initialize the audio enhancer."""
        self._vad_processor = None
        self._initialized = False

    @property
    def vad_processor(self):
        """Lazy load VAD processor."""
        if self._vad_processor is None:
            try:
                from .vad_processor import get_vad_processor
                self._vad_processor = get_vad_processor()
            except Exception as e:
                logger.warning(f"Failed to initialize VAD processor: {e}")
        return self._vad_processor

    def enhance(
        self,
        audio_path: str,
        apply_noise_reduction: Optional[bool] = None,
        apply_vad: Optional[bool] = None,
        noise_strength: Optional[float] = None
    ) -> EnhancementResult:
        """
        Apply audio enhancement pipeline.

        Processes audio through noise suppression and VAD filtering.
        Each step can be enabled/disabled via parameters or global config.

        Args:
            audio_path: Path to audio file (should be 16kHz WAV)
            apply_noise_reduction: Override config (None = use config)
            apply_vad: Override config (None = use config)
            noise_strength: Override noise reduction strength (None = use config)

        Returns:
            EnhancementResult with enhanced audio path and metadata

        Note:
            If both noise reduction and VAD are disabled, returns original path.
            If VAD detects no speech, should_skip will be True.
        """
        from .config import (
            is_vad_enabled,
            is_noise_suppression_enabled,
            get_noise_reduction_strength
        )

        result = EnhancementResult(
            original_path=audio_path,
            enhanced_path=audio_path
        )

        # Validate input
        if not os.path.exists(audio_path):
            result.error = f"Audio file not found: {audio_path}"
            return result

        # Determine what to apply
        do_noise = apply_noise_reduction if apply_noise_reduction is not None else is_noise_suppression_enabled()
        do_vad = apply_vad if apply_vad is not None else is_vad_enabled()
        strength = noise_strength if noise_strength is not None else get_noise_reduction_strength()

        current_path = audio_path

        # Step 1: Noise suppression
        if do_noise:
            try:
                from .noise_processor import reduce_noise

                noise_result = reduce_noise(
                    current_path,
                    strength=strength,
                    stationary=True  # Better for meeting audio (AC, fans, etc.)
                )

                if noise_result.success:
                    current_path = noise_result.output_path
                    result.noise_reduced = True
                    result.metadata['noise_reduction_strength'] = strength
                    logger.debug(f"Noise reduction applied to {audio_path}")
                else:
                    logger.warning(f"Noise reduction failed: {noise_result.error}")

            except Exception as e:
                logger.warning(f"Noise reduction error, continuing: {e}")

        # Step 2: VAD check
        if do_vad:
            try:
                if self.vad_processor:
                    vad_result = self.vad_processor.analyze(current_path)

                    result.vad_applied = True
                    result.speech_detected = vad_result.has_speech
                    result.speech_ratio = vad_result.speech_ratio
                    result.should_skip = not vad_result.has_speech
                    result.metadata['speech_segments'] = len(vad_result.speech_segments)
                    result.metadata['total_duration'] = vad_result.total_duration

                    if not vad_result.has_speech:
                        logger.info(f"VAD: No speech detected in {audio_path} (ratio={vad_result.speech_ratio:.2%})")
                else:
                    logger.debug("VAD processor not available, skipping VAD check")

            except Exception as e:
                logger.warning(f"VAD check failed, continuing: {e}")

        result.enhanced_path = current_path
        return result

    def should_skip_chunk(self, audio_path: str) -> bool:
        """
        Quick VAD check for live audio chunks.

        Use this for fast decision-making on whether to transcribe a chunk.
        Does NOT apply noise reduction.

        Args:
            audio_path: Path to audio chunk

        Returns:
            True if chunk should be skipped (no speech), False otherwise
        """
        from .config import is_vad_enabled

        if not is_vad_enabled():
            return False

        try:
            if self.vad_processor:
                return not self.vad_processor.is_speech_present(audio_path)
            return False
        except Exception as e:
            logger.warning(f"VAD quick check failed: {e}")
            return False  # Err on the side of processing

    def enhance_for_live(
        self,
        audio_path: str,
        skip_if_silent: bool = True
    ) -> Optional[str]:
        """
        Enhanced audio processing optimized for live transcription.

        This is a convenience method that:
        1. Skips processing if no speech detected (returns None)
        2. Applies noise reduction if enabled
        3. Returns the path to use for transcription

        Args:
            audio_path: Path to audio chunk
            skip_if_silent: If True, return None for silent chunks

        Returns:
            Path to enhanced audio, or None if should skip
        """
        result = self.enhance(audio_path)

        if skip_if_silent and result.should_skip:
            return None

        return result.enhanced_path

    def get_status(self) -> Dict[str, Any]:
        """
        Get status of audio enhancement components.

        Returns:
            Dict with status of VAD and noise suppression
        """
        from .config import is_vad_enabled, is_noise_suppression_enabled
        from .noise_processor import is_noisereduce_available

        vad_available = False
        if self.vad_processor:
            vad_available = self.vad_processor._load_model()

        return {
            "vad": {
                "enabled": is_vad_enabled(),
                "available": vad_available
            },
            "noise_suppression": {
                "enabled": is_noise_suppression_enabled(),
                "available": is_noisereduce_available()
            }
        }


# =============================================================================
# Global instance (lazy initialized)
# =============================================================================

_audio_enhancer: Optional[AudioEnhancer] = None


def get_audio_enhancer() -> AudioEnhancer:
    """
    Get or create the global AudioEnhancer instance.

    Returns:
        AudioEnhancer singleton instance
    """
    global _audio_enhancer
    if _audio_enhancer is None:
        _audio_enhancer = AudioEnhancer()
    return _audio_enhancer


def enhance_audio(audio_path: str, **kwargs) -> EnhancementResult:
    """
    Convenience function to enhance audio file.

    Args:
        audio_path: Path to audio file
        **kwargs: Additional arguments passed to AudioEnhancer.enhance()

    Returns:
        EnhancementResult with enhanced audio path
    """
    return get_audio_enhancer().enhance(audio_path, **kwargs)


def should_skip_chunk(audio_path: str) -> bool:
    """
    Convenience function for quick VAD check.

    Args:
        audio_path: Path to audio chunk

    Returns:
        True if chunk should be skipped (no speech)
    """
    return get_audio_enhancer().should_skip_chunk(audio_path)
