
import requests
import time
import sys

BASE_URL = "http://127.0.0.1:8001/api/v1"
CHAT_URL = f"{BASE_URL}/chat"

def run_test():
    print("🚀 Starting RAG Verification...")

    # 1. Index a Dummy Transcript
    transcript_id = f"test-rag-{int(time.time())}"
    text = (
        "TranscriptAI is a powerful tool for converting speech to text. "
        "It uses Whisper for transcription and Llama for chat. "
        "The project was migrated from a pure Python backend to a Hybrid C++/Python architecture in v2.0. "
        "Sir Ken Robinson argues that schools kill creativity by prioritizing academic ability."
    )
    
    print(f"--> Indexing transcript: {transcript_id}")
    try:
        res = requests.post(f"{CHAT_URL}/index", json={
            "transcript_id": transcript_id,
            "text": text,
            "metadata": {"source": "verification_script"}
        })
        res.raise_for_status()
        print("✅ Indexing started (Background Task)")
    except Exception as e:
        print(f"❌ Indexing failed: {e}")
        return

    # Wait for indexing (it's fast but async)
    time.sleep(2)

    # 2. Query - Retrieval Only check?
    # The current API does Retrieval + Generation in one go.
    # We can check if sources are returned even if LLM fails (fallback logic in chat.py).
    
    question = "What does Sir Ken Robinson argue?"
    print(f"--> Asking: '{question}'")
    
    try:
        res = requests.post(f"{CHAT_URL}/query", json={
            "question": question,
            "transcript_ids": [transcript_id] 
        })
        res.raise_for_status()
        data = res.json()
        
        print(f"✅ Response received!")
        print(f"   Answer: {data['answer'][:100]}...")
        print(f"   Sources: {len(data['sources'])}")
        
        if len(data['sources']) > 0:
            print("   ✅ Retrieval worked (Found sources)")
        else:
            print("   ❌ Retrieval failed (No sources)")

        if "offline" in data['answer'].lower() or "brain is offline" in data['answer'].lower():
             print("   ⚠️ LLM is offline (Expected if llama-server not running)")
        else:
             print("   ✅ LLM appears to be working")
             
    except Exception as e:
        print(f"❌ Query failed: {e}")

if __name__ == "__main__":
    try:
        # Ensure backend is up? This script assumes running against a live backend.
        # But we are in agentic mode, we can't easily spawn the whole unified backend here without blocking.
        # We rely on previous verification or manual start.
        # Actually, I'll try to run it.
        run_test()
    except KeyboardInterrupt:
        pass
