cd fron# Development Guidelines - SignalHub

## 🎯 **CORE DEVELOPMENT PRINCIPLES**

### **1. "Test After Every Change"**
- ✅ **Never make multiple changes without testing**
- ✅ **If something breaks, you know exactly what caused it**
- ✅ **Rollback is easy (just one change)**
- ✅ **Always test before committing**

### **2. "Start Simple, Add Complexity"**
- ✅ **Begin with the simplest possible setup**
- ✅ **Add features incrementally**
- ✅ **Validate each addition**
- ✅ **Don't over-engineer initially**

### **3. "Fail Fast and Fail Early"**
- ✅ **If something doesn't work in 2 minutes, stop and fix it**
- ✅ **Don't continue building on a broken foundation**
- ✅ **Address issues immediately**
- ✅ **Don't ignore warning signs**

### **4. "Document Each Step"**
- ✅ **Keep a log of what works and what doesn't**
- ✅ **Note any error messages**
- ✅ **Document the exact commands that work**
- ✅ **Update guides when solutions are found**

---

## ⏱️ **THE "5-MINUTE RULE"**

**If any step takes more than 5 minutes to get working, stop and:**

1. **Simplify the approach**
2. **Check if it's an environment issue**
3. **Try a different method**
4. **Don't build on broken foundations**

---

## 🚀 **DEVELOPMENT WORKFLOW**

### **Phase 1: Environment Setup (5 minutes)**
```bash
# 1. Check current state
pwd && ls -la

# 2. Verify dependencies
npm list --depth=0  # for frontend
pip list            # for backend

# 3. Test basic functionality
npm run check       # frontend health check
python -c "import app"  # backend import test
```

### **Phase 2: Minimal Working Setup (5 minutes)**
```bash
# 1. Create simplest possible implementation
# 2. Test it works
# 3. Document the working state
```

### **Phase 3: Incremental Development (15 minutes total)**
```bash
# 1. Add one feature at a time
# 2. Test after each addition
# 3. Commit working changes
# 4. Document what was added
```

### **Phase 4: Validation (immediate feedback)**
```bash
# 1. Test the complete feature
# 2. Verify no regressions
# 3. Update documentation
```

---

## 🔧 **DEBUGGING STRATEGY**

### **Step 1: Identify the Problem (2 minutes)**
```bash
# Check logs
tail -f logs/signalhub.log

# Check status
curl Yeah. http://localhost:8000/health  # backend
curl http://localhost:3000/src/main.tsx  # frontend

# Check processes
lsof -i :8000  # backend port
lsof -i :3000  # frontend port
```

### **Step 2: Isolate the Issue (2 minutes)**
```bash
# Test individual components
python -m pytest test_specific_component.py
npm run type-check  # frontend

# Check configuration
cat config.py  # backend
cat vite.config.ts  # frontend
```

### **Step 3: Fix or Simplify (1 minute)**
```bash
# If complex, simplify
# If broken, fix immediately
# If unclear, try different approach
```

---

## 📝 **DOCUMENTATION REQUIREMENTS**

### **For Every Feature:**
1. **What was implemented**
2. **How to test it**
3. **Any configuration changes**
4. **Known limitations**
5. **Troubleshooting steps**

### **For Every Bug Fix:**
1. **Root cause analysis**
2. **Solution implemented**
3. **Prevention measures**
4. **Similar issues to watch for**

---

## 🛠️ **TOOLS AND SCRIPTS**

### **Quick Health Checks:**
```bash
# Frontend
cd frontend && npm run check

# Backend
cd backend && python -c "from app.main import app; print('✅ Backend imports work')"

# Database
psql -d signalhub -c "SELECT 1;"  # if using PostgreSQL
```

### **Quick Fixes:**
```bash
# Frontend issues
cd frontend && npm run restart

# Backend issues
pkill -f uvicorn && cd backend && python -m uvicorn app.main:app --reload --port 8000

# Port conflicts
lsof -i :8000 | awk 'NR>1 {print $2}' | xargs kill -9
lsof -i :3000 | awk 'NR>1 {print $2}' | xargs kill -9
```

---

## 🎯 **QUALITY ASSURANCE**

### **Before Every Commit:**
- [ ] **Code compiles/transpiles without errors**
- [ ] **All tests pass**
- [ ] **No obvious bugs introduced**
- [ ] **Documentation updated**

### **Before Every Push:**
- [ ] **Full test suite passes**
- [ ] **Manual testing completed**
- [ ] **Code review checklist completed**
- [ ] **Commit message is descriptive**

---

## 🚨 **EMERGENCY PROCEDURES**

### **When Things Break Badly:**
```bash
# 1. Stop all processes
pkill -f vite && pkill -f uvicorn

# 2. Clear caches
rm -rf frontend/.vite backend/__pycache__

# 3. Reset to last working state
git stash && git checkout main

# 4. Start fresh
cd frontend && npm run dev:safe
cd backend && python -m uvicorn app.main:app --reload --port 8000
```

### **When Environment is Corrupted:**
```bash
# 1. Backup important changes
git stash

# 2. Clean environment
rm -rf node_modules package-lock.json
rm -rf __pycache__ .pytest_cache

# 3. Reinstall dependencies
npm install  # frontend
pip install -r requirements.txt  # backend

# 4. Test basic functionality
npm run check  # frontend
python -c "import app"  # backend
```

---

## 📊 **SUCCESS METRICS**

### **Development Speed:**
- ✅ **New features implemented in < 30 minutes**
- ✅ **Bugs fixed in < 10 minutes**
- ✅ **Environment issues resolved in < 5 minutes**

### **Code Quality:**
- ✅ **No broken builds**
- ✅ **All tests passing**
- ✅ **Documentation up to date**
- ✅ **No obvious bugs**

### **Team Productivity:**
- ✅ **Clear communication of changes**
- ✅ **Easy rollback procedures**
- ✅ **Consistent development environment**
- ✅ **Quick onboarding for new features**

---

## 🎓 **LEARNING AND IMPROVEMENT**

### **After Each Development Session:**
1. **What worked well?**
2. **What could be improved?**
3. **What tools/scripts would help?**
4. **What documentation needs updating?**

### **Weekly Review:**
1. **Update development guidelines**
2. **Improve automation scripts**
3. **Add new debugging tools**
4. **Refine processes**

---

cd ## 🔄 **CONTINUOUS IMPROVEMENT**

### **Always Ask:**
- **Can this be automated?**
- **Can this be simplified?**
- **Can this be documented better?**
- **Can this be tested more thoroughly?**

### **Never:**
- ❌ **Ignore error messages**
- ❌ **Build on broken foundations**
- ❌ **Skip testing**
- ❌ **Forget to document**

---

## 📚 **REFERENCE DOCUMENTS**

- **`FRONTEND_DEBUGGING_GUIDE.md`** - Frontend-specific issues
- **`FRONTEND_QUICK_REFERENCE.md`** - Quick frontend commands
- **`README.md`** - Project overview
- **`requirements.txt`** - Backend dependencies
- **`frontend/package.json`** - Frontend dependencies

---

## 🎯 **FOR CURSOR AI ASSISTANT**

**When helping with development, always:**

1. **Follow the 5-minute rule**
2. **Test after every change**
3. **Document what was done**
4. **Provide clear rollback instructions**
5. **Suggest improvements to this guide**

**Remember: It's better to have a simple working solution than a complex broken one!**
