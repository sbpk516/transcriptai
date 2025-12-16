# Feature Addition Process

This document defines the mandatory process for adding any new feature to TranscriptAI.

---

## Overview

Every feature addition follows this flow:

```
Request → Plan → Approve → Implement → Test → Verify → Document
```

**No shortcuts.** Skipping steps leads to broken features and wasted time.

---

## Phase 1: Request

### Before Starting Any Feature

- [ ] Create a Change Request using `docs/CHANGE_REQUEST_TEMPLATE.md`
- [ ] Identify maximum 3 files to modify
- [ ] Confirm no new dependencies (or justify each one)
- [ ] Define clear rollback plan
- [ ] Define test plan

### Questions to Answer

1. What exactly will this feature do?
2. Who benefits and how?
3. What's the simplest implementation?
4. What could go wrong?

---

## Phase 2: Baseline

### Record Current State

Before making any changes:

```bash
# Record performance baseline
./scripts/benchmark-performance.sh > baseline_before.txt

# Record size baseline
./scripts/monitor-size.sh > size_before.txt

# Ensure all tests pass
./scripts/smoke-test.sh
```

- [ ] Performance baseline recorded
- [ ] Size baseline recorded
- [ ] Smoke test passes
- [ ] All existing features work

---

## Phase 3: Implement

### Development Rules

1. **One change at a time** - Make a single logical change, then test
2. **Stay within scope** - Only modify files listed in Change Request
3. **No extras** - No "while I'm here" improvements
4. **Test constantly** - After every change, verify it works

### Implementation Checklist

- [ ] Working in dev mode (not building DMG)
- [ ] Changes limited to approved files
- [ ] No new dependencies added (or approved ones only)
- [ ] Each change tested immediately
- [ ] Code matches existing style

### If Something Breaks

1. **STOP** - Don't try to fix forward
2. **Identify** - What exact change caused the break?
3. **Revert** - Go back to last working state
4. **Fix** - Address root cause
5. **Continue** - Only after fix is verified

---

## Phase 4: Test

### Dev Mode Testing

```bash
# Start in dev mode
./scripts/dev-test.sh

# In another terminal, run smoke test
./scripts/smoke-test.sh
```

- [ ] New feature works as expected
- [ ] All smoke tests pass
- [ ] No console errors in browser
- [ ] No errors in backend logs

### Regression Testing

```bash
# Run regression tests
pytest tests/regression/ -v
```

- [ ] All regression tests pass
- [ ] Upload feature still works
- [ ] Live mic feature still works
- [ ] Results page still works
- [ ] Settings still work

---

## Phase 5: Verify

### Performance Check

```bash
# Record performance after changes
./scripts/benchmark-performance.sh > baseline_after.txt

# Compare
diff baseline_before.txt baseline_after.txt
```

**Acceptable thresholds:**
- Startup time: No more than 10% increase
- Transcription time: No more than 15% increase
- Memory usage: No more than 20% increase

- [ ] Performance within acceptable thresholds
- [ ] No significant degradation

### Size Check

```bash
# Record size after changes
./scripts/monitor-size.sh > size_after.txt

# Compare
diff size_before.txt size_after.txt
```

- [ ] No unexpected size increases
- [ ] New dependencies accounted for

---

## Phase 6: Document

### Update Impact Log

Add entry to `docs/FEATURE_IMPACT_LOG.md`:

```markdown
| Date | Feature | Files Changed | New Deps | Size Delta | Perf Delta |
|------|---------|---------------|----------|------------|------------|
| YYYY-MM-DD | Feature Name | 3 | none | +0MB | +0% |
```

### Update Other Docs

- [ ] Feature documented in relevant guide
- [ ] FEATURE_ROADMAP.md updated (if applicable)
- [ ] README updated (if user-facing change)

---

## Phase 7: Final Verification

### Before Considering Complete

- [ ] All Phase 4 tests pass
- [ ] All Phase 5 checks pass
- [ ] Documentation updated
- [ ] Impact log entry added
- [ ] Change request marked complete

### Only Then

- Build DMG if needed for release
- Otherwise, feature is ready for use in dev mode

---

## Quick Reference Checklist

Copy this for each feature:

```
## Feature: [Name]

### Pre-Implementation
- [ ] Change request created
- [ ] Baseline recorded
- [ ] Smoke test passes

### Implementation  
- [ ] Changes within scope
- [ ] No unauthorized dependencies
- [ ] Tested after each change

### Post-Implementation
- [ ] Feature works
- [ ] Regression tests pass
- [ ] Performance acceptable
- [ ] Size acceptable
- [ ] Documentation updated
- [ ] Impact log updated
```

---

## Common Mistakes to Avoid

1. **Skipping baseline** - Can't measure impact without it
2. **Changing too many files** - Harder to debug when things break
3. **Adding dependencies casually** - Each one has long-term cost
4. **Testing only happy path** - Edge cases cause production issues
5. **Forgetting documentation** - Future you will be confused
6. **Building DMG too early** - Waste 30 minutes on broken code


