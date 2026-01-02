
import sys
import os
import logging

# Add project root to path
sys.path.append(os.getcwd())

from backend.app.services.rag_service import RAGService
from backend.app.database import SessionLocal
from backend.app.models import Transcript

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("reindex")

def main():
    print("Initializing RAG Service...")
    rag = RAGService()
    
    print(f"DEBUG: rag.vector_store is {rag.vector_store}")
    
    if rag.vector_store is None:
        print("ERROR: RAG Service failed to initialize vector store.")
        return

    print("Connecting to database...")
    db = SessionLocal()
    
    try:
        transcripts = db.query(Transcript).all()
        print(f"Found {len(transcripts)} transcripts.")
        
        count = 0
        for t in transcripts:
            print(f"Indexing transcript for call {t.call_id}...")
            # Use call_id as transcript_id for consistency
            success = rag.index_transcript(t.call_id, t.text)
            if success:
                count += 1
        
        print(f"Successfully indexed {count}/{len(transcripts)} transcripts.")
        
    finally:
        db.close()

if __name__ == "__main__":
    main()
