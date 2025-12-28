# Cleanup Recommendations - Unused Files

## ✅ Definitely Unused (Safe to Delete)

### 1. PyInstaller Spec Files
These are **NOT used** by the build script. The build uses command-line arguments directly.

```bash
# Safe to delete:
rm -f signalhub-backend.spec
rm -f backend/signalhub-backend.spec
rm -f backend/test-mlx-bundle.spec
```

### 2. Test/Transcript File
- `Test1.txt` - Contains transcript text, not referenced anywhere

```bash
rm -f Test1.txt
```

### 3. Old Log File
- `backend/logs/signalhub.log` - Old log with previous project name

```bash
rm -f backend/logs/signalhub.log
```

## ⚠️ Potentially Unused (Verify First)

### 1. Package Tarball
- `ichbinbekir-node-global-key-listener-0.4.1.tgz` (1.1MB)
  - This is a local package tarball
  - The package is installed via npm from registry
  - **Action**: Check if needed for offline installs, otherwise can delete

### 2. Duplicate Config File
- `ports.config` - Appears to be duplicate of `config/ports.env`
  - `config.js` is **USED** (keep it)
  - `ports.config` might be unused
  - **Action**: Verify if any script uses `ports.config` before deleting

## 📁 Legacy Directories (Archive/Delete After Verification)

### 1. Old Data Directories
- `signalhub_data/` (root)
- `backend/signalhub_data/`
- **Action**: Check contents, migrate data if needed, then delete

### 2. Old Build Artifacts
- `desktop/dist/SignalHub-*.dmg` (if exists)
- `backend/build/signalhub-backend/` (build artifacts)
- **Action**: Can be deleted (regenerated on build)

## 🖼️ Media Files (Check Documentation)

- `duration.png` (root) - Might be duplicate of `screenshots/duration.png`
- `ViteReactTS.png` and `ViteReactTS1.pdf` - Check if referenced in docs

## 📊 Quick Cleanup Script

```bash
#!/bin/bash
# Safe cleanup - removes definitely unused files

echo "Cleaning up unused files..."

# Remove unused spec files
rm -f signalhub-backend.spec
rm -f backend/signalhub-backend.spec
rm -f backend/test-mlx-bundle.spec

# Remove test file
rm -f Test1.txt

# Remove old log file
rm -f backend/logs/signalhub.log

echo "✅ Cleanup complete!"
echo ""
echo "⚠️  Manual review needed for:"
echo "   - ichbinbekir-node-global-key-listener-0.4.1.tgz"
echo "   - ports.config"
echo "   - signalhub_data/ directories"
echo "   - Old build artifacts"
```

## Summary

**Safe to delete immediately**: 5 files
- 3 spec files
- 1 test file  
- 1 old log file

**Need verification**: 4+ items
- Package tarball
- Duplicate config
- Legacy directories
- Media files

