# Frontend Quick Reference - SignalHub

## 🚀 Quick Start Commands

### **Safe Development (Recommended):**
```bash
cd frontend
npm run dev:safe    # Runs health check + starts Vite
```

### **Manual Development:**
```bash
cd frontend
npm run dev         # Starts Vite directly
```

## 🔧 Common Commands

### **Health & Diagnostics:**
```bash
npm run check       # Run health check
npm run type-check  # TypeScript compilation check
npm run clean       # Clear Vite cache
npm run restart     # Kill Vite + restart
```

### **Development:**
```bash
npm run dev         # Start development server
npm run build       # Build for production
npm run preview     # Preview production build
npm run lint        # Run ESLint
```

## 🚨 Quick Troubleshooting

### **Blank Page Issue:**
```bash
# 1. Check directory
pwd | grep -q "frontend$" || cd frontend

# 2. Test file resolution
curl -s http://localhost:3000/src/main.tsx | head -3

# 3. Restart if needed
npm run restart
```

### **Import Errors:**
```bash
# 1. Check TypeScript
npm run type-check

# 2. Check dependencies
npm list react react-dom

# 3. Reinstall if needed
rm -rf node_modules package-lock.json && npm install
```

### **Port Issues:**
```bash
# 1. Check port usage
lsof -i :3000

# 2. Kill existing processes
pkill -f vite

# 3. Start fresh
npm run dev
```

## 📁 Directory Structure

```
signalhub/
├── frontend/           ← ALWAYS WORK FROM HERE
│   ├── src/
│   │   ├── main.tsx   ← React entry point
│   │   ├── App.tsx    ← Main component
│   │   └── index.css  ← Styles
│   ├── package.json   ← Dependencies
│   └── vite.config.ts ← Vite configuration
└── backend/           ← Backend API
```

## 🎯 Key Prevention Rules

### **1. Always Check Directory:**
```bash
# ✅ Correct
cd signalhub/frontend
npm run dev

# ❌ Wrong
cd signalhub
npm run dev
```

### **2. Use Safe Commands:**
```bash
# ✅ Recommended
npm run dev:safe

# ⚠️ Manual (risk of issues)
npm run dev
```

### **3. Test File Resolution:**
```bash
# Quick test
curl -s http://localhost:3000/src/main.tsx | grep -q "import" && echo "✅ OK" || echo "❌ Issue"
```

## 🔍 Debug Mode

### **Start with Debug Logs:**
```bash
npx vite --debug --port 3000
```

### **Check Vite Logs:**
Look for these patterns:
- `vite:resolve /src/main.tsx -> null` = Directory issue
- `vite:html-fallback` = File resolution failed
- `vite:time` = Normal operation

## 📞 Emergency Commands

### **Complete Reset:**
```bash
cd frontend
pkill -f vite
rm -rf node_modules/.vite
npm install
npm run dev:safe
```

### **Quick Fix for Blank Page:**
```bash
cd frontend && pkill -f vite && npm run dev
```

## 🎉 Success Indicators

### **✅ Everything Working:**
- `curl http://localhost:3000` returns HTML
- `curl http://localhost:3000/src/main.tsx` returns React code
- Browser shows "Hello World! SignalHub Frontend is Working!"

### **❌ Issues Present:**
- `curl` returns 404
- Browser shows blank page
- Vite logs show `-> null` resolutions
