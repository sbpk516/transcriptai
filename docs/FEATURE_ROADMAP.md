# TranscriptAI Feature Roadmap

> Last updated: December 15, 2025

This document outlines planned features prioritized by sales impact and development effort.

---

## 🎯 Priority 1: High Impact Features (Q1 2025)

### 1. YouTube/URL Transcription
**Target Users:** Students (59M TAM), Content Creators  
**Effort:** 5-7 days  
**Sales Impact:** +30% trial-to-purchase conversion

**Description:**
Paste a YouTube or video URL → Download audio → Transcribe offline → Display result

**Why It Matters:**
- "lecture summaries" for students (validated in TAM doc)
- 164K monthly searches for YouTube transcription tools
- Competitors (Tactiq, Glasp) are cloud-only — we'd be the first offline solution
- Viral potential: "I transcribed a 3-hour lecture in 2 minutes"

**Technical Approach:**
- Integrate `yt-dlp` Python library for video/audio download
- Feed downloaded audio to existing Whisper pipeline
- Add URL input field to Upload page
- Support: YouTube, Vimeo, and direct video URLs

**Evidence:**
- YouTube has 2.7B monthly active users
- Tactiq Chrome extension: 500K+ users
- r/medicalschool requests for lecture transcription: 800+ upvotes

---

### 2. Local AI Summaries & Action Items
**Target Users:** Freelancers (65M TAM), All users  
**Effort:** 10-14 days  
**Sales Impact:** +25% perceived value, competitive parity

**Description:**
After transcription, generate:
- TL;DR summary (3-5 sentences)
- Key points (5-7 bullet points)
- Action items (extracted tasks with owners if mentioned)

**Why It Matters:**
- "action item tagging" for freelancers (validated in TAM doc)
- Every competitor (Otter, Fireflies, Fathom) has this — we're behind without it
- Our differentiator: **100% offline** using local LLMs

**Technical Approach:**
- Option A: Integrate Ollama + Llama 3.2 8B or Mistral 7B
- Option B: Use `mlx-lm` (we already have MLX infrastructure)
- Simple prompts for summarization and action extraction
- Display in new "AI Insights" section on Results page

**Evidence:**
- G2 reviews: 73% mention summaries as key decision factor
- Otter.ai's #1 feature request (2022-2023) was better summaries

---

### 3. Export to Notion/Obsidian/Markdown
**Target Users:** Students, Freelancers, Knowledge workers  
**Effort:** 3-5 days  
**Sales Impact:** +15% retention

**Description:**
Export transcripts in formats that integrate with popular note-taking tools:
- **Notion**: Markdown with headings, timestamps
- **Obsidian**: .md file with YAML frontmatter
- **Google Docs**: .docx export
- **Structured Markdown**: Timestamps, speaker labels, paragraphs

**Why It Matters:**
- "collaborative study notes", "CRM-friendly exports" (validated in TAM doc)
- Notion: 30M+ users, Obsidian: 1M+ users
- Products with integrations have 2.5x higher retention

**Technical Approach:**
- Format existing transcript text with proper markdown structure
- Add export buttons: "Export to Notion", "Export to Obsidian", "Download .docx"
- Optional: Notion API integration for direct sync

---

## 🚀 Priority 2: Differentiation Features (Q2 2025)

### 4. Study Materials Generation (Flashcards, Quiz, Exam Notes)
**Target Users:** Students (especially med/law students)  
**Effort:** 12-14 days (builds on AI Summaries)  
**Sales Impact:** Creates competitive moat

**Description:**
From any transcript, generate:
- **Anki flashcards** (.apkg format)
- **Quiz questions** (multiple choice + short answer)
- **Condensed exam notes**
- **Key concepts summary**

**Why It Matters:**
- Competitors WON'T build this (enterprise focus, wrong market)
- Anki: 10M+ downloads, 89% of med students use it
- Students spend 4-6 hours/week manually creating flashcards
- 31K monthly searches for "youtube to flashcards" related terms

**Technical Approach:**
- Local LLM prompts for Q&A pair generation
- Anki export format (.apkg is SQLite-based)
- PDF export for quizzes
- Markdown export for exam notes

**Evidence:**
- r/medicalschool: "I wish there was a tool that could watch my lecture and generate Anki cards" — 847 upvotes
- r/MCAT: "I'd pay good money for something that transcribes Khan Academy videos and makes flashcards" — 156 upvotes

---

### 5. Speaker Diarization ("Who Said What")
**Target Users:** Meeting users, Interviewers, Podcast creators  
**Effort:** 10-14 days  
**Sales Impact:** +20% for meeting use cases

**Description:**
```
[Speaker 1 - 0:00]: Hello, welcome to the meeting.
[Speaker 2 - 0:05]: Thanks for having me.
```

**Technical Approach:**
- Integrate `pyannote-audio` (open-source, runs locally)
- Or use `whisperX` which adds diarization to Whisper
- Allow users to label speakers: "Speaker 1 → John"

---

### 6. Searchable Transcript History
**Target Users:** Power users with many transcripts  
**Effort:** 5-7 days  
**Sales Impact:** +10% retention

**Description:**
Full-text search across all past transcripts with highlighted results.

**Technical Approach:**
- SQLite FTS5 (Full-Text Search) — already built into SQLite
- Add search bar to Transcripts page
- Highlight matching text in results

---

## ⚡ Quick Win: Audio Playback & Download

### Audio File Access for Live Recordings
**Target Users:** All users  
**Effort:** 2-3 days  
**Sales Impact:** Improved user experience, reduces support requests

**Current State:**
- ✅ Audio files ARE being stored in `audio_uploads/live_sessions/<session_id>/`
- ✅ Combined WAV file is created after recording stops
- ✅ File path is stored in database (Call.file_path)
- ❌ No UI to download or playback the original audio
- ❌ No audio player in the Results/Transcripts view

**What to Add:**
1. **Download button** on each transcript card: "Download Audio (.wav)"
2. **Audio player** in expanded transcript view (HTML5 `<audio>` element)
3. **Backend endpoint**: `GET /api/v1/audio/{call_id}` to serve the file

**Why It's Valuable:**
| Use Case | Value |
|----------|-------|
| Re-listen to clarify unclear transcription | Accuracy verification |
| Re-transcribe with different model/settings | Flexibility |
| Share original audio with others | Collaboration |
| Backup/archive recordings | Data ownership |
| Verify transcription quality | Trust building |

**Technical Approach:**
```python
# Backend: Add endpoint to serve audio files
@app.get("/api/v1/audio/{call_id}")
async def get_audio_file(call_id: str):
    call = db.query(Call).filter(Call.call_id == call_id).first()
    return FileResponse(call.file_path, media_type="audio/wav")
```

```tsx
// Frontend: Add to Results.tsx
<audio controls src={`/api/v1/audio/${result.call_id}`} />
<Button onClick={() => downloadAudio(result.call_id)}>Download Audio</Button>
```

---

## 🔮 Priority 3: Future Considerations (Q3+ 2025)

### 7. Multi-Language Transcription + Translation
- Whisper already supports 99 languages
- Add language selector to UI
- Optional: Local translation model for cross-language output
- Critical for APAC market (45% of TAM)

### 8. Mobile Companion App
- Simple audio recorder on iPhone/Android
- Sync to desktop for local transcription
- React Native or Expo for cross-platform

### 9. Zoom/Teams/Meet Audio Capture
- Virtual audio device to capture system audio
- One-click: "Transcribe my current Zoom call"
- Higher complexity, potential platform TOS issues

### 10. Custom Vocabulary Training
- Add industry-specific terms: "Kubernetes", "HIPAA", "amortization"
- Whisper prompt conditioning or fine-tuning
- Valuable for legal, medical, tech professionals

---

## 📊 Implementation Timeline Summary

| Priority | Feature | Weeks | Cumulative |
|----------|---------|-------|------------|
| P1 | YouTube/URL Transcription | 1 | Week 1 |
| P1 | AI Summaries | 2 | Week 3 |
| P1 | Export Integrations | 1 | Week 4 |
| P2 | Study Materials | 2 | Week 6 |
| P2 | Speaker Diarization | 2 | Week 8 |
| P2 | Searchable History | 1 | Week 9 |

**Total P1 features: 4 weeks**  
**Total P1 + P2 features: 9 weeks**

---

## 🎯 Success Metrics

| Feature | Success Metric |
|---------|---------------|
| YouTube Transcription | 40%+ of new users try it in first session |
| AI Summaries | 70%+ of transcripts have summaries generated |
| Export Integrations | 30%+ of completed transcripts are exported |
| Study Materials | 50%+ retention among student users |

---

## 📝 Notes

- All features maintain **offline-first** principle
- No cloud dependencies for core functionality
- One-time purchase model preserved
- Privacy remains key differentiator

---

## Related Documents

- [TAM Analysis](./market/transcriptai_tam.md)
- [Tech Stack](./architecture/TECH_STACK.md)
- [Development Guidelines](./development/DEVELOPMENT_GUIDELINES.md)

