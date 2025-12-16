# Change Request Template

Use this template BEFORE implementing any feature or significant change.

---

## Feature/Change: [Name]

### Summary
**What:** [One sentence description of the change]

**Why:** [User benefit - what problem does this solve?]

### Impact Assessment

**Files to modify:** (Maximum 3 for features, 1 for bug fixes)
1. 
2. 
3. 

**New dependencies:** 
- [ ] None required
- [ ] Required: [List with justification for each]

**Estimated lines of code:**
- Added: ~
- Modified: ~
- Deleted: ~

### Performance Consideration

**Performance impact:**
- [ ] None expected
- [ ] Potential concerns: [Describe]

**Memory impact:**
- [ ] None expected  
- [ ] Potential concerns: [Describe]

**Build size impact:**
- [ ] None expected
- [ ] Potential concerns: [Describe]

### Risk Assessment

**What could break:**
- 

**Rollback plan:**
- 

**Dependencies on other features:**
- [ ] None
- [ ] Depends on: [List]

### Test Plan

**How to verify it works:**
1. 
2. 
3. 

**How to verify nothing else broke:**
1. Run `scripts/smoke-test.sh`
2. 
3. 

### Approval

- [ ] Change request reviewed
- [ ] Approach approved
- [ ] Ready to implement

---

## Example: YouTube URL Transcription

### Summary
**What:** Add ability to paste a YouTube URL and transcribe the audio

**Why:** Students can transcribe lecture videos without manual download

### Impact Assessment

**Files to modify:**
1. `frontend/src/pages/Upload.tsx` - Add URL input field
2. `backend/app/main.py` - Add URL download endpoint
3. `backend/app/youtube_downloader.py` - New file for yt-dlp integration

**New dependencies:** 
- [x] Required: `yt-dlp` - Industry standard YouTube downloader, 5MB, no alternatives

**Estimated lines of code:**
- Added: ~150
- Modified: ~30
- Deleted: ~0

### Performance Consideration

**Performance impact:**
- [x] Potential concerns: Download time depends on video length, but runs async

**Memory impact:**
- [x] None expected (streams to disk, doesn't buffer in memory)

**Build size impact:**
- [x] Potential concerns: yt-dlp adds ~5MB to bundle

### Risk Assessment

**What could break:**
- Nothing existing - new isolated feature

**Rollback plan:**
- Remove the 3 files/changes, feature disappears cleanly

**Dependencies on other features:**
- [x] None

### Test Plan

**How to verify it works:**
1. Paste YouTube URL in upload page
2. Click "Transcribe"
3. Verify audio downloads and transcription appears

**How to verify nothing else broke:**
1. Run `scripts/smoke-test.sh`
2. Test normal file upload still works
3. Test live mic still works


