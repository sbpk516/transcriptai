# Cursor AI Development Instructions - SignalHub

## 🎯 **MANDATORY GUIDELINES FOR CURSOR AI**

### **ALWAYS FOLLOW THESE PRINCIPLES:**

1. **📋 READ THE GUIDELINES FIRST**
   - Before starting any development, read `DEVELOPMENT_GUIDELINES.md`
   - Follow the 5-minute rule strictly
   - Test after every change

2. **🔍 DIAGNOSE BEFORE FIXING**
   - Run `./scripts/quick-debug.sh` to understand the current state
   - Identify the root cause before implementing solutions
   - Don't guess - verify the issue

3. **⚡ IMPLEMENT INCREMENTALLY**
   - Make one small change at a time
   - Test immediately after each change
   - If it breaks, you know exactly what caused it

4. **📝 DOCUMENT EVERYTHING**
   - Explain what you're doing and why
   - Document any errors and their solutions
   - Update relevant guides when you find new solutions

---

## 🚀 **DEVELOPMENT WORKFLOW FOR CURSOR**

### **Step 1: Environment Check (2 minutes)**
```bash
# Always start with this
./scripts/quick-debug.sh
```

### **Step 2: Understand the Request**
- Clarify what the user wants to achieve
- Break it down into small, testable steps
- Identify the simplest possible implementation

### **Step 3: Implement Incrementally**
- Start with the simplest working version
- Add complexity one step at a time
- Test after each addition

### **Step 4: Validate and Document**
- Test the complete feature
- **🔍 Perform mandatory self-review** (user can say "Review your work")
- Update documentation
- Provide clear instructions for future use

---

## 🛠️ **COMMON PATTERNS FOR CURSOR**

### **When Adding New Features:**
1. **Check current state**: `./scripts/quick-debug.sh`
2. **Create minimal implementation**
3. **Test it works**
4. **Add complexity incrementally**
5. **Document the solution**

### **When Fixing Bugs:**
1. **Reproduce the issue**
2. **Identify root cause**
3. **Implement minimal fix**
4. **Test the fix**
5. **Add prevention measures**

### **When Setting Up New Components:**
1. **Start with basic structure**
2. **Add essential functionality**
3. **Test integration**
4. **Add advanced features**
5. **Optimize and document**

---

## 📋 **CHECKLIST FOR EVERY DEVELOPMENT SESSION**

### **Before Starting:**
- [ ] Read `DEVELOPMENT_GUIDELINES.md`
- [ ] Run `./scripts/quick-debug.sh`
- [ ] Understand the user's request clearly
- [ ] Plan incremental implementation steps

### **During Development:**
- [ ] Make one change at a time
- [ ] Test after every change
- [ ] Document what you're doing
- [ ] Follow the 5-minute rule

### **After Completion:**
- [ ] Test the complete feature
- [ ] **🔍 MANDATORY: Perform self-review** (see AI_REVIEW_PROTOCOL.md)
- [ ] Update relevant documentation
- [ ] Provide clear usage instructions
- [ ] Suggest improvements to the process

---

## 🎯 **SPECIFIC INSTRUCTIONS FOR COMMON TASKS**

### **Frontend Development:**
```bash
# Always start with health check
cd frontend && npm run check

# Use safe development
npm run dev:safe

# Test file resolution
curl -s http://localhost:3000/src/main.tsx | head -3
```

### **Backend Development:**
```bash
# Check imports
cd backend && python -c "import app"

# Test API
curl http://localhost:8000/health

# Check logs
tail -f logs/signalhub.log
```

### **Database Changes:**
```bash
# Test connection
psql -d signalhub -c "SELECT 1;"

# Check migrations
# (Add specific commands based on your migration system)
```

---

## 🚨 **EMERGENCY PROCEDURES FOR CURSOR**

### **When Things Go Wrong:**
1. **Stop immediately** - don't continue building on broken foundation
2. **Run diagnostics**: `./scripts/quick-debug.sh`
3. **Identify the issue** - what exactly broke?
4. **Implement minimal fix** - simplest solution that works
5. **Test thoroughly** - ensure no regressions
6. **Document the issue and solution**

### **When User Reports Issues:**
1. **Ask for specific error messages**
2. **Request current state information**
3. **Run diagnostics to understand the environment**
4. **Reproduce the issue if possible**
5. **Implement targeted fix**
6. **Test the fix thoroughly**

---

## 📚 **REFERENCE DOCUMENTS FOR CURSOR**

### **Primary Guides:**
- `DEVELOPMENT_GUIDELINES.md` - Core development principles
- `docs/AI_REVIEW_PROTOCOL.md` - **Mandatory review process**
- `FRONTEND_DEBUGGING_GUIDE.md` - Frontend-specific issues
- `FRONTEND_QUICK_REFERENCE.md` - Quick frontend commands

### **Scripts:**
- `./scripts/quick-debug.sh` - Comprehensive system check
- `./scripts/frontend-health-check.sh` - Frontend-specific check

### **Configuration:**
- `frontend/package.json` - Frontend dependencies and scripts
- `backend/requirements.txt` - Backend dependencies
- `.gitignore` - Files to exclude from version control

---

## 🎓 **LEARNING AND IMPROVEMENT**

### **After Each Session:**
1. **What worked well?**
2. **What could be improved?**
3. **What new tools would help?**
4. **What documentation needs updating?**

### **Continuous Improvement:**
- Update this file based on new learnings
- Add new debugging tools as needed
- Improve automation scripts
- Refine development processes

---

## 🎯 **SUCCESS CRITERIA FOR CURSOR**

### **Development Quality:**
- ✅ **Features work correctly on first try**
- ✅ **No regressions introduced**
- ✅ **Code is clean and well-documented**
- ✅ **Solutions are simple and maintainable**

### **User Experience:**
- ✅ **Clear communication of what's being done**
- ✅ **Quick resolution of issues**
- ✅ **Helpful error messages and debugging info**
- ✅ **Easy-to-follow instructions**

### **Process Efficiency:**
- ✅ **Development time minimized**
- ✅ **Debugging time minimized**
- ✅ **Documentation always up to date**
- ✅ **Tools and scripts improve over time**

---

## 🚀 **REMEMBER: SIMPLE IS BETTER**

**When in doubt, choose the simpler solution. A working simple solution is better than a complex broken one.**

**Always test, always document, always improve.**
