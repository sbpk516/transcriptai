# 🚀 SignalHub Pipeline Logging System

## 📋 What You'll See in the Logs

When you upload a file through the SignalHub pipeline, you'll now get **detailed JSON logs** saved to `logs/pipeline_logs/` that show exactly what happened at each step.

## 🔍 **Step-by-Step Execution Logging**

### **Step 1: Upload & Validation**
```
📋 SUBSTEP 1.1: File Validation
✅ File validation passed: {file_info}
💾 SUBSTEP 1.2: Saving file to disk  
✅ File saved to: /path/to/file.wav
🗄️ SUBSTEP 1.3: Creating database record
✅ Database record created: {call_id}
🔄 SUBSTEP 1.4: Updating call status
✅ Call status updated to 'uploaded'
```

### **Step 2: Audio Processing**
```
🔄 STEP 2: Starting AUDIO PROCESSING
✅ Audio processing completed
```

### **Step 3: Transcription**
```
🔄 STEP 3: Starting TRANSCRIPTION
✅ Transcription completed
```

### **Step 4: NLP Analysis**
```
🔄 STEP 4: Starting NLP ANALYSIS
✅ NLP analysis completed
```

### **Step 5: Database Storage**
```
🔄 STEP 5: Starting DATABASE STORAGE
✅ Database storage completed
```

## 📊 **What Gets Logged**

### **File Operations**
- Original filename and size
- Where file is saved on disk
- File validation results
- File processing status

### **Database Operations**
- What data is inserted into which tables
- Success/failure of each operation
- Exact data being stored

### **Timing Information**
- When each step started and completed
- Duration of each step
- Total pipeline execution time

### **Error Tracking**
- What went wrong and where
- Error details and context
- Failed operations

## 📁 **Log File Structure**

Each pipeline execution creates a JSON file like:
```
logs/pipeline_logs/pipeline_{call_id}_{timestamp}.json
```

Example: `pipeline_abc123-def456_20250903_212553.json`

## 🔧 **How to Use the Logs**

### **1. Find Your Upload**
- Look for the `call_id` from your upload response
- Find the corresponding log file

### **2. Analyze the Execution**
- See exactly which steps succeeded/failed
- Check timing of each operation
- Verify what data was stored

### **3. Debug Issues**
- Identify where things went wrong
- See what data was processed
- Check database operations

## 💡 **Example Log Output**

```json
{
  "pipeline_id": "abc123-def456",
  "event": "pipeline_started",
  "timestamp": "2025-09-03T21:25:53.665835",
  "file_info": {
    "filename": "audio.wav",
    "content_type": "audio/wav", 
    "size": 1024000,
    "upload_timestamp": "2025-09-03T21:25:53.665818"
  },
  "steps": [
    {
      "step_name": "upload",
      "event": "step_started",
      "timestamp": "2025-09-03T21:25:53.666536",
      "step_data": {
        "filename": "audio.wav",
        "content_type": "audio/wav",
        "file_size": 1024000
      }
    },
    {
      "step_name": "upload", 
      "substep_name": "file_validation",
      "event": "substep_executed",
      "timestamp": "2025-09-03T21:25:53.668347",
      "substep_data": {
        "filename": "audio.wav",
        "validation_start": "2025-09-03T21:25:53.668291"
      }
    }
    // ... more steps
  ]
}
```

## 🎯 **Benefits**

1. **Complete Visibility**: See every step of the pipeline
2. **Easy Debugging**: Know exactly where issues occur
3. **Performance Analysis**: Track timing of each operation
4. **Data Verification**: Confirm what gets stored in database
5. **Audit Trail**: Keep records of all processing

## 🚀 **Next Steps**

1. **Upload a file** through the frontend
2. **Check the logs** in `logs/pipeline_logs/`
3. **Analyze the execution** step by step
4. **Identify any issues** or bottlenecks

The logging system will show you exactly what's working and what's not, making it much easier to debug the duration calculation issue!

