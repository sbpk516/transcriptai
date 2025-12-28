# Frontend Debugging Guide - SignalHub

## 🚨 Common Issues & Prevention Strategies

### **Issue #1: Blank Page / 404 Errors**

#### **Root Cause:**
- Vite running from wrong directory
- File resolution failures (`/src/main.tsx -> null`)

#### **Prevention Checklist:**
- [ ] **Always run Vite from `frontend/` directory**
- [ ] **Verify current directory:** `pwd` should show `.../signalhub/frontend`
- [ ] **Check file existence:** `ls -la src/` should show `main.tsx`, `App.tsx`
- [ ] **Test file resolution:** `curl http://localhost:3000/src/main.tsx`

#### **Debug Commands:**
```bash
# 1. Check directory
pwd
ls -la src/

# 2. Start Vite from correct directory
cd frontend
npx vite --port 3000

# 3. Test file resolution
curl http://localhost:3000/src/main.tsx
```

### **Issue #2: Import/Module Errors**

#### **Root Cause:**
- Incorrect import paths
- Missing dependencies
- TypeScript configuration issues

#### **Prevention Checklist:**
- [ ] **Verify imports:** Check `main.tsx` imports `App` from `./App`
- [ ] **Check dependencies:** `npm list` for missing packages
- [ ] **TypeScript compilation:** `npx tsc --noEmit`
- [ ] **Path aliases:** Verify `@/` paths in `vite.config.ts`

#### **Debug Commands:**
```bash
# 1. Check TypeScript compilation
npx tsc --noEmit

# 2. Verify dependencies
npm list react react-dom

# 3. Check import paths
grep -r "import.*from" src/
```

### **Issue #3: Configuration Problems**

#### **Root Cause:**
- Incorrect Vite configuration
- PostCSS/Tailwind setup issues
- Proxy configuration errors

#### **Prevention Checklist:**
- [ ] **Vite config:** Verify `vite.config.ts` has correct paths
- [ ] **PostCSS config:** Check `postcss.config.js` plugins
- [ ] **Tailwind config:** Verify `tailwind.config.js` content paths
- [ ] **Proxy setup:** Test API proxy configuration

#### **Debug Commands:**
```bash
# 1. Test Vite config
npx vite --config vite.config.ts --debug

# 2. Check PostCSS
npx postcss --help

# 3. Test proxy
curl http://localhost:3000/api/health
```

## 🔧 Quick Diagnostic Commands

### **Environment Check:**
```bash
# 1. Directory verification
pwd && ls -la

# 2. File existence check
ls -la src/main.tsx src/App.tsx

# 3. Server status check
lsof -i :3000

# 4. File resolution test
curl -s http://localhost:3000/src/main.tsx | head -5
```

### **Configuration Check:**
```bash
# 1. Vite config validation
npx vite --config vite.config.ts --debug

# 2. TypeScript check
npx tsc --noEmit

# 3. Dependency check
npm list --depth=0
```

## 🚀 Best Practices

### **1. Always Use Correct Directory:**
```bash
# ❌ WRONG
cd signalhub
npx vite --port 3000

# ✅ CORRECT
cd signalhub/frontend
npx vite --port 3000
```

### **2. Verify Before Starting:**
```bash
# Check you're in the right place
pwd | grep -q "frontend$" && echo "✅ Correct directory" || echo "❌ Wrong directory"
```

### **3. Test File Resolution:**
```bash
# Test if files are accessible
curl -s http://localhost:3000/src/main.tsx | grep -q "import" && echo "✅ Files resolving" || echo "❌ File resolution failed"
```

## 📝 Troubleshooting Flow

### **When Frontend Shows Blank Page:**

1. **Check Directory:**
   ```bash
   pwd
   # Should be: /path/to/signalhub/frontend
   ```

2. **Verify Files:**
   ```bash
   ls -la src/main.tsx src/App.tsx
   # Should show both files exist
   ```

3. **Test Server:**
   ```bash
   curl http://localhost:3000/src/main.tsx
   # Should return React code, not 404
   ```

4. **Check Vite Logs:**
   ```bash
   npx vite --debug
   # Look for: vite:resolve /src/main.tsx -> null
   ```

5. **Fix Directory Issue:**
   ```bash
   cd frontend
   npx vite --port 3000
   ```

## 🎯 Prevention Summary

### **Before Starting Development:**
- [ ] Navigate to `frontend/` directory
- [ ] Verify all files exist
- [ ] Check TypeScript compilation
- [ ] Test server startup

### **During Development:**
- [ ] Monitor Vite logs for resolution errors
- [ ] Test file changes immediately
- [ ] Verify imports are correct
- [ ] Check browser console for errors

### **When Issues Occur:**
- [ ] Follow troubleshooting flow above
- [ ] Check directory first (most common cause)
- [ ] Verify file existence
- [ ] Test file resolution
- [ ] Check configuration files

## 📚 Reference Commands

```bash
# Quick health check
pwd && ls -la src/ && curl -s http://localhost:3000/src/main.tsx | head -3

# Restart server properly
pkill -f vite && cd frontend && npx vite --port 3000

# Debug mode
npx vite --debug --port 3000
```
