
print("Starting imports...")
try:
    print("Importing langchain_community.vectorstores...")
    from langchain_community.vectorstores import Chroma
    print("OK: Chroma")
except ImportError as e:
    print(f"FAIL: Chroma - {e}")
except Exception as e:
    print(f"ERROR: Chroma - {e}")

try:
    print("Importing langchain_community.embeddings...")
    from langchain_community.embeddings import SentenceTransformerEmbeddings
    print("OK: SentenceTransformerEmbeddings")
except ImportError as e:
    print(f"FAIL: SentenceTransformerEmbeddings - {e}")
except Exception as e:
    print(f"ERROR: SentenceTransformerEmbeddings - {e}")

try:
    print("Importing langchain.text_splitter...")
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    print("OK: RecursiveCharacterTextSplitter")
except ImportError as e:
    print(f"FAIL: RecursiveCharacterTextSplitter - {e}")
except Exception as e:
    print(f"ERROR: RecursiveCharacterTextSplitter - {e}")

print("Done.")
