"""
Database models for TranscriptAI application.
"""
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean
from sqlalchemy.sql import func
from .database import Base


class User(Base):
    """User model for authentication and management."""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Call(Base):
    """Call model for storing call metadata."""
    __tablename__ = "calls"
    
    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(100), unique=True, index=True, nullable=False)
    duration = Column(Integer)  # Duration in seconds
    file_path = Column(String(255))  # Path to audio file
    original_filename = Column(String(255))  # Original uploaded filename
    file_size_bytes = Column(Integer)  # File size in bytes
    status = Column(String(50), default="pending")  # pending, processing, completed, failed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Transcript(Base):
    """Transcript model for storing call transcripts."""
    __tablename__ = "transcripts"
    
    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(100), index=True, nullable=False)
    text = Column(Text, nullable=False)
    confidence = Column(Integer)  # Confidence score (0-100)
    language = Column(String(10), default="en")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Analysis(Base):
    """Analysis model for storing AI analysis results."""
    __tablename__ = "analyses"
    
    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(100), index=True, nullable=False)
    intent = Column(String(100))
    intent_confidence = Column(Integer)  # 0-100 confidence score
    sentiment = Column(String(50))  # positive, negative, neutral
    sentiment_score = Column(Integer)  # -100 to 100
    escalation_risk = Column(String(50))  # low, medium, high
    risk_score = Column(Integer)  # 0 to 100
    keywords = Column(Text)  # JSON array of keywords
    topics = Column(Text)  # JSON array of topics
    urgency_level = Column(String(50))  # low, medium, high, critical
    compliance_risk = Column(String(50))  # none, low, medium, high
    created_at = Column(DateTime(timezone=True), server_default=func.now())
