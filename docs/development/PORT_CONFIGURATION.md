# Port Configuration Reference

## Current Configuration
- **Backend Port**: 8001
- **Frontend Port**: 3000

## Files That Need Port Updates
When changing the backend port, update these files:

### Backend Files:
1. `README.md` - Line 140: `--port 8001`
2. `backend/package.json` - Lines 6, 7, 8, 15, 17: Replace `8001` with new port

### Frontend Files:
3. `frontend/vite.config.ts` - Line 17: `target: 'http://localhost:8001'`
4. `frontend/src/types/constants.ts` - Line 3: `'http://127.0.0.1:8001'`

## Quick Find & Replace Commands
To change from 8001 to NEW_PORT:

```bash
# Backend files
sed -i 's/8001/NEW_PORT/g' README.md
sed -i 's/8001/NEW_PORT/g' backend/package.json

# Frontend files  
sed -i 's/8001/NEW_PORT/g' frontend/vite.config.ts
sed -i 's/8001/NEW_PORT/g' frontend/src/types/constants.ts
```

## Example: Change to Port 9000
```bash
sed -i 's/8001/9000/g' README.md
sed -i 's/8001/9000/g' backend/package.json
sed -i 's/8001/9000/g' frontend/vite.config.ts
sed -i 's/8001/9000/g' frontend/src/types/constants.ts
```
