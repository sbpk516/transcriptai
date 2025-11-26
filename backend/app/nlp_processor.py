"""
NLP Processor for TranscriptAI Phase 3: NLP Analysis.

This module provides core NLP processing capabilities including:
- Text preprocessing and cleaning
- Model loading and caching
- Basic text analysis utilities
- Integration with existing pipeline
"""

import json
import os
import logging
import asyncio
import time
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
import re
import string

# NLP Libraries
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from nltk.stem import WordNetLemmatizer
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# Local imports
from .debug_utils import debug_helper
import logging

logger = logging.getLogger(__name__)


class NLPProcessor:
    """
    Core NLP processor for text analysis and insights extraction.
    
    This class provides the foundation for all NLP operations in TranscriptAI,
    including text preprocessing, model management, and basic analysis.
    """
    
    def __init__(self):
        """Initialize the NLP processor with models and utilities."""
        self.logger = logger
        self._model_loaded = False
        self.models_loaded = False  # Compatibility alias via property setter
        self.models = {}
        self.cache = {}
        self.nltk_available = False
        self._loading_in_progress = False
        self._loading_started_ts: Optional[float] = None
        self._last_load_elapsed: Optional[float] = None
        self._last_loaded_at: Optional[str] = None
        self._last_load_error: Optional[str] = None
        self._load_lock = asyncio.Lock()

        # Initialize NLTK components
        self._initialize_nltk()
        
        # Initialize sentiment analyzer
        self.sentiment_analyzer = SentimentIntensityAnalyzer()
        
        # Intent classification patterns (rule-based for now)
        self.intent_patterns = {
            'customer support request': [
                'help', 'support', 'assist', 'problem', 'issue', 'trouble',
                'broken', 'not working', 'error', 'fix', 'repair'
            ],
            'sales inquiry': [
                'price', 'cost', 'buy', 'purchase', 'order', 'quote',
                'discount', 'deal', 'offer', 'sale', 'promotion'
            ],
            'complaint or issue': [
                'complaint', 'angry', 'furious', 'unhappy', 'dissatisfied',
                'wrong', 'bad', 'terrible', 'horrible', 'unacceptable'
            ],
            'general information': [
                'what', 'how', 'when', 'where', 'why', 'information',
                'details', 'explain', 'tell me', 'question'
            ],
            'appointment booking': [
                'appointment', 'schedule', 'book', 'reservation', 'meeting',
                'time', 'date', 'calendar', 'available'
            ],
            'technical problem': [
                'technical', 'system', 'software', 'hardware', 'network',
                'connection', 'login', 'password', 'access', 'download'
            ],
            'billing question': [
                'bill', 'payment', 'charge', 'invoice', 'account',
                'money', 'refund', 'credit', 'debit', 'subscription'
            ],
            'product inquiry': [
                'product', 'feature', 'specification', 'model', 'version',
                'compatibility', 'requirement', 'specs'
            ]
        }
        
        self.logger.info("NLP Processor initialized successfully")
    
    def _initialize_nltk(self):
        """Initialize NLTK components and download required data."""
        try:
            offline_mode = os.getenv("TRANSCRIPTAI_MODE", "").lower() == "desktop" or os.getenv("TRANSCRIPTAI_OFFLINE", "0") == "1"
            if offline_mode:
                # In offline/desktop mode, skip downloads to avoid startup delays/timeouts
                self.logger.info("NLTK offline mode: skipping downloads; using bundled resources or fallbacks")
            else:
                try:
                    nltk.download('punkt', quiet=True)
                    nltk.download('stopwords', quiet=True)
                    nltk.download('wordnet', quiet=True)
                except Exception as dl_err:
                    # Download failures are tolerated; we will fall back
                    self.logger.warning(f"NLTK download failed or unavailable, falling back: {dl_err}")

            # Try to initialize components; if this fails, use fallbacks
            try:
                self.stop_words = set(stopwords.words('english'))
                self.lemmatizer = WordNetLemmatizer()
                # Probe tokenizer once
                _ = word_tokenize("probe")
                self.nltk_available = True
                self.logger.info("NLTK components initialized successfully")
            except Exception as init_err:
                self.logger.warning(f"NLTK resources not available, using offline-safe fallbacks: {init_err}")
                # Fallback stop words (minimal)
                self.stop_words = set([
                    'the','a','an','is','are','am','and','or','but','if','then','else','for','to','of','in','on','with','by','as','at','this','that','these','those','be','been','being','it','its','we','you','they','he','she','i','me','my','our','your','their'
                ])
                # Fallback lemmatizer: identity
                class _IdentityLemmatizer:
                    def lemmatize(self, token: str) -> str:
                        return token
                self.lemmatizer = _IdentityLemmatizer()
                self.nltk_available = False
            
        except Exception as e:
            self.logger.error(f"Failed to initialize NLTK: {e}")
            debug_helper.capture_exception("nlp_nltk_init", e, {})
            # Use fallbacks if any unexpected error occurs
            self.stop_words = set([
                'the','a','an','is','are','am','and','or','but','if','then','else','for','to','of','in','on','with','by','as','at','this','that','these','those','be','been','being','it','its','we','you','they','he','she','i','me','my','our','your','their'
            ])
            class _IdentityLemmatizer:
                def lemmatize(self, token: str) -> str:
                    return token
            self.lemmatizer = _IdentityLemmatizer()
            self.nltk_available = False
    
    async def _load_resources(self) -> None:
        """Load and cache NLP models asynchronously."""
        if self._model_loaded:
            return

        try:
            self.logger.info("Loading NLP models...")

            # For now, we're using rule-based approach
            # In future, this can be replaced with ML models
            self.models_loaded = True
            self._last_load_error = None
            self.logger.info("NLP models loaded successfully (rule-based)")

            debug_helper.log_debug_info(
                "nlp_models_loaded",
                {"models_loaded": ["rule_based_intent", "vader_sentiment"]}
            )

        except Exception as e:
            self.models_loaded = False
            self._last_load_error = str(e)
            self.logger.error(f"Failed to load NLP models: {e}")
            debug_helper.capture_exception("nlp_models_load", e, {})
            raise

    async def load_models(self):
        """Compatibility wrapper to support legacy callers."""
        await self._load_resources()

    async def ensure_loaded(self, timeout: Optional[float] = None, *, background: bool = False) -> bool:
        """Ensure NLP resources are loaded."""
        if self._model_loaded:
            return False

        acquired = False
        start_wait = time.perf_counter()
        try:
            if timeout is None:
                await self._load_lock.acquire()
                acquired = True
            else:
                await asyncio.wait_for(self._load_lock.acquire(), timeout)
                acquired = True

            if self._model_loaded:
                return False

            self._loading_in_progress = True
            self._loading_started_ts = time.perf_counter()
            self.logger.info("[NLP] model_load status=begin background=%s", background)
            await self._load_resources()
            elapsed = time.perf_counter() - (self._loading_started_ts or time.perf_counter())
            self._last_load_elapsed = elapsed
            if self._model_loaded:
                self._last_load_error = None
                self._last_loaded_at = datetime.now().isoformat()
                self.logger.info("[NLP] model_load status=complete elapsed=%.3fs", elapsed)
                return True
            self.logger.error("[NLP] model_load status=failed elapsed=%.3fs", elapsed)
            self._last_load_error = "NLP models failed to load"
            raise RuntimeError("NLP models failed to load")
        except asyncio.TimeoutError:
            waited = time.perf_counter() - start_wait
            self._last_load_error = f"timeout after {waited:.3f}s waiting for NLP load lock"
            raise TimeoutError(self._last_load_error)
        finally:
            self._loading_in_progress = False
            self._loading_started_ts = None
            if acquired and self._load_lock.locked():
                self._load_lock.release()

    @property
    def models_loaded(self) -> bool:
        """Compatibility alias for legacy checks."""
        return self._model_loaded

    @models_loaded.setter
    def models_loaded(self, value: bool) -> None:
        self._model_loaded = value

    def get_status(self) -> Dict[str, Any]:
        """Return current NLP resource status for diagnostics."""
        if self._loading_in_progress:
            status = "loading"
        elif self._model_loaded:
            status = "ready"
        else:
            status = "not_loaded"

        return {
            "status": status,
            "loaded": self._model_loaded,
            "loading": self._loading_in_progress,
            "last_load_elapsed": self._last_load_elapsed,
            "last_loaded_at": self._last_loaded_at,
            "last_error": self._last_load_error,
        }

    def preprocess_text(self, text: str) -> str:
        """
        Preprocess and clean text for analysis.
        
        Args:
            text: Raw text to preprocess
            
        Returns:
            Cleaned and preprocessed text
        """
        try:
            if not text or not isinstance(text, str):
                return ""
            
            # Convert to lowercase
            text = text.lower()
            
            # Remove special characters but keep basic punctuation
            text = re.sub(r'[^\w\s\.\,\!\?\-]', '', text)
            
            # Remove extra whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            
            # Remove leading/trailing punctuation
            text = text.strip(string.punctuation)
            
            return text
            
        except Exception as e:
            self.logger.error(f"Error preprocessing text: {e}")
            debug_helper.capture_exception("nlp_preprocess", e, {"text_length": len(text) if text else 0})
            return text if text else ""
    
    def extract_keywords(self, text: str, max_keywords: int = 10) -> List[str]:
        """
        Extract key terms and phrases from text.
        
        Args:
            text: Input text
            max_keywords: Maximum number of keywords to extract
            
        Returns:
            List of extracted keywords
        """
        try:
            if not text:
                return []
            
            # Preprocess text
            clean_text = self.preprocess_text(text)
            
            # Tokenize (fallback to regex if NLTK tokenizer unavailable)
            if self.nltk_available:
                tokens = word_tokenize(clean_text)
            else:
                # Simple regex tokenization on word boundaries
                tokens = re.findall(r"[A-Za-z0-9']+", clean_text)
            
            # Remove stop words and short tokens
            keywords = [
                token for token in tokens 
                if token.lower() not in self.stop_words 
                and len(token) > 2
                and not token.isnumeric()
            ]
            
            # Lemmatize
            keywords = [self.lemmatizer.lemmatize(token) for token in keywords]
            
            # Count frequency
            from collections import Counter
            keyword_freq = Counter(keywords)
            
            # Return top keywords
            return [keyword for keyword, _ in keyword_freq.most_common(max_keywords)]
            
        except Exception as e:
            self.logger.error(f"Error extracting keywords: {e}")
            debug_helper.capture_exception("nlp_keywords", e, {"text_length": len(text) if text else 0})
            return []
    
    def analyze_sentiment_vader(self, text: str) -> Dict[str, Any]:
        """
        Analyze sentiment using VADER sentiment analyzer.
        
        Args:
            text: Input text
            
        Returns:
            Dictionary with sentiment scores and classification
        """
        try:
            if not text:
                return {
                    "sentiment": "neutral",
                    "sentiment_score": 0,
                    "compound_score": 0,
                    "positive_score": 0,
                    "negative_score": 0,
                    "neutral_score": 0
                }
            
            # Get sentiment scores
            scores = self.sentiment_analyzer.polarity_scores(text)
            
            # Determine sentiment classification
            compound_score = scores['compound']
            if compound_score >= 0.05:
                sentiment = "positive"
                sentiment_score = int(compound_score * 100)
            elif compound_score <= -0.05:
                sentiment = "negative"
                sentiment_score = int(compound_score * 100)
            else:
                sentiment = "neutral"
                sentiment_score = 0
            
            return {
                "sentiment": sentiment,
                "sentiment_score": sentiment_score,
                "compound_score": compound_score,
                "positive_score": scores['pos'],
                "negative_score": scores['neg'],
                "neutral_score": scores['neu']
            }
            
        except Exception as e:
            self.logger.error(f"Error analyzing sentiment: {e}")
            debug_helper.capture_exception("nlp_sentiment", e, {"text_length": len(text) if text else 0})
            return {
                "sentiment": "neutral",
                "sentiment_score": 0,
                "compound_score": 0,
                "positive_score": 0,
                "negative_score": 0,
                "neutral_score": 0
            }

    async def detect_intent(self, text: str, candidate_labels: List[str]) -> Dict[str, Any]:
        """
        Detect intent using rule-based pattern matching.
        
        Args:
            text: Input text
            candidate_labels: List of possible intent labels (not used in rule-based)
            
        Returns:
            Dictionary with detected intent and confidence
        """
        try:
            if not self.models_loaded:
                await self.ensure_loaded()
            
            if not text:
                return {
                    "intent": "unknown",
                    "confidence": 0.0,
                    "candidates": []
                }
            
            # Convert text to lowercase for pattern matching
            text_lower = text.lower()
            
            # Score each intent based on keyword matches
            intent_scores = {}
            for intent, keywords in self.intent_patterns.items():
                score = 0
                for keyword in keywords:
                    if keyword in text_lower:
                        score += 1
                intent_scores[intent] = score
            
            # Find the intent with highest score
            if intent_scores:
                best_intent = max(intent_scores, key=intent_scores.get)
                best_score = intent_scores[best_intent]
                
                # Convert score to confidence (0-1 scale)
                max_possible_score = max(len(keywords) for keywords in self.intent_patterns.values())
                confidence = min(1.0, best_score / max_possible_score) if max_possible_score > 0 else 0.0
                
                # If no keywords matched, default to general information
                if best_score == 0:
                    best_intent = "general information"
                    confidence = 0.1
            else:
                best_intent = "general information"
                confidence = 0.1
            
            # Format candidates
            candidates = [
                {"label": intent, "score": score / max(len(keywords) for keywords in self.intent_patterns.values())}
                for intent, score in intent_scores.items()
            ]
            
            return {
                "intent": best_intent,
                "confidence": confidence,
                "candidates": candidates
            }
            
        except Exception as e:
            self.logger.error(f"Error detecting intent: {e}")
            debug_helper.capture_exception("nlp_intent", e, {
                "text_length": len(text) if text else 0
            })
            return {
                "intent": "unknown",
                "confidence": 0.0,
                "candidates": []
            }
    
    def assess_risk(self, text: str, sentiment_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Assess risk level based on text content and sentiment.
        
        Args:
            text: Input text
            sentiment_data: Sentiment analysis results
            
        Returns:
            Dictionary with risk assessment
        """
        try:
            # Initialize risk scores
            escalation_risk = "low"
            risk_score = 0
            urgency_level = "low"
            compliance_risk = "none"
            
            # Risk indicators
            high_risk_keywords = [
                'urgent', 'emergency', 'critical', 'immediately', 'asap',
                'complaint', 'sue', 'lawyer', 'legal', 'escalate',
                'cancel', 'refund', 'money back', 'dispute', 'wrong',
                'angry', 'furious', 'unacceptable', 'terrible', 'horrible'
            ]
            
            compliance_keywords = [
                'privacy', 'data', 'personal', 'confidential', 'secure',
                'breach', 'hack', 'unauthorized', 'access', 'information'
            ]
            
            urgency_keywords = [
                'urgent', 'emergency', 'critical', 'immediately', 'asap',
                'now', 'today', 'deadline', 'time sensitive'
            ]
            
            # Check for risk indicators
            text_lower = text.lower()
            
            # Escalation risk
            high_risk_count = sum(1 for keyword in high_risk_keywords if keyword in text_lower)
            if high_risk_count >= 3:
                escalation_risk = "high"
                risk_score = 80
            elif high_risk_count >= 1:
                escalation_risk = "medium"
                risk_score = 50
            
            # Urgency level
            urgency_count = sum(1 for keyword in urgency_keywords if keyword in text_lower)
            if urgency_count >= 2:
                urgency_level = "critical"
            elif urgency_count >= 1:
                urgency_level = "high"
            
            # Compliance risk
            compliance_count = sum(1 for keyword in compliance_keywords if keyword in text_lower)
            if compliance_count >= 2:
                compliance_risk = "high"
            elif compliance_count >= 1:
                compliance_risk = "medium"
            
            # Adjust based on sentiment
            if sentiment_data.get('sentiment') == 'negative':
                risk_score = min(100, risk_score + 20)
                if escalation_risk == "low":
                    escalation_risk = "medium"
            
            return {
                "escalation_risk": escalation_risk,
                "risk_score": risk_score,
                "urgency_level": urgency_level,
                "compliance_risk": compliance_risk
            }
            
        except Exception as e:
            self.logger.error(f"Error assessing risk: {e}")
            debug_helper.capture_exception("nlp_risk", e, {"text_length": len(text) if text else 0})
            return {
                "escalation_risk": "low",
                "risk_score": 0,
                "urgency_level": "low",
                "compliance_risk": "none"
            }
    
    async def analyze_text(self, text: str, call_id: str) -> Dict[str, Any]:
        """
        Perform comprehensive text analysis.
        
        Args:
            text: Input text to analyze
            call_id: Call identifier for logging
            
        Returns:
            Dictionary with complete analysis results
        """
        try:
            self.logger.info(f"Starting comprehensive text analysis for call {call_id}")
            
            # Ensure models are loaded
            if not self.models_loaded:
                await self.ensure_loaded()
            
            # Preprocess text
            clean_text = self.preprocess_text(text)
            
            # Extract keywords
            keywords = self.extract_keywords(clean_text)
            
            # Analyze sentiment
            sentiment_data = self.analyze_sentiment_vader(clean_text)
            
            # Detect intent (using common customer service intents)
            intent_labels = [
                "customer support request",
                "sales inquiry", 
                "complaint or issue",
                "general information",
                "appointment booking",
                "technical problem",
                "billing question",
                "product inquiry"
            ]
            intent_data = await self.detect_intent(clean_text, intent_labels)
            
            # Assess risk
            risk_data = self.assess_risk(clean_text, sentiment_data)
            
            # Compile results
            analysis_result = {
                "call_id": call_id,
                "text_length": len(text),
                "clean_text_length": len(clean_text),
                "keywords": keywords,
                "sentiment": sentiment_data,
                "intent": intent_data,
                "risk": risk_data,
                "analysis_timestamp": asyncio.get_event_loop().time()
            }
            
            self.logger.info(f"Text analysis completed for call {call_id}")
            debug_helper.log_debug_info(
                "nlp_analysis_complete",
                {
                    "call_id": call_id,
                    "text_length": len(text),
                    "intent": intent_data.get("intent"),
                    "sentiment": sentiment_data.get("sentiment"),
                    "risk_level": risk_data.get("escalation_risk")
                }
            )
            
            return analysis_result
            
        except Exception as e:
            self.logger.error(f"Error in comprehensive text analysis: {e}")
            debug_helper.capture_exception("nlp_comprehensive_analysis", e, {"call_id": call_id})
            raise


# Global instance
nlp_processor = NLPProcessor()
