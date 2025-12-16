# Feature Impact Log

This log tracks the impact of every feature addition to TranscriptAI.

**Purpose:** Maintain visibility into how the app grows over time and catch problems early.

---

## Current Baseline (December 2024)

| Metric | Value | Notes |
|--------|-------|-------|
| DMG Size | 477 MB | Acceptable for now |
| Backend Bundle | 752 MB | Before compression |
| Python Dependencies | 21 | requirements.txt |
| Frontend Dependencies | ~8 | package.json |
| Python Files | 40 | backend/ |
| TypeScript Files | 44 | frontend/src/ |
| Backend Source | 1.3 MB | backend/app/ |
| Frontend Source | 356 KB | frontend/src/ |

### Top Bundle Components
| Component | Size | Notes |
|-----------|------|-------|
| torch | 385 MB | PyTorch for Whisper |
| llvmlite | 111 MB | NumPy JIT |
| nltk_data | 68 MB | NLP data files |
| scipy | 40 MB | Scientific computing |
| numpy | 18 MB | Array operations |

---

## Feature Impact History

| Date | Feature | Files Changed | New Dependencies | Size Delta | Perf Delta | Notes |
|------|---------|---------------|------------------|------------|------------|-------|
| 2024-12-16 | Baseline | - | - | 477 MB | - | Initial measurement |
| | | | | | | |
| | | | | | | |
| | | | | | | |

---

## How to Update This Log

After completing any feature:

1. Run `./scripts/monitor-size.sh` to get current sizes
2. Run `./scripts/benchmark-performance.sh` to get performance metrics
3. Calculate deltas from previous entry
4. Add new row to the table above

### Entry Format

```
| YYYY-MM-DD | Feature Name | N files | dep1, dep2 | +X MB | +Y% startup | Brief notes |
```

### What to Track

- **Files Changed:** Count of files modified/added
- **New Dependencies:** List any new pip/npm packages
- **Size Delta:** Change in DMG size (or estimated bundle impact)
- **Perf Delta:** Change in startup time or transcription speed
- **Notes:** Any relevant context

---

## Alerts

**Add an alert here if any feature causes:**

- DMG size increase > 20 MB
- Startup time increase > 20%
- Transcription speed decrease > 15%
- More than 5 new dependencies

### Alert History

| Date | Feature | Issue | Resolution |
|------|---------|-------|------------|
| | | | |

---

## Trends

Update this section monthly:

### December 2024
- Starting baseline: 477 MB DMG
- Features added: 0
- Net size change: 0

### January 2025
- (To be updated)

---

## Guidelines

1. **Every feature gets logged** - No exceptions
2. **Be honest about impact** - Don't hide problems
3. **Investigate anomalies** - Big jumps need explanation
4. **Keep it updated** - Stale logs are useless


