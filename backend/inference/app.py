# Inference API logic (FastAPI)
import logging
import os
import getpass
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from backend.ingestion.app import build_chroma_index

app_fastapi = FastAPI()
app_fastapi.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

retriever = None

@app_fastapi.on_event("startup")
def startup_event():
    global retriever
    logging.info("Loading retriever from persisted Chroma index...")
    try:
        _, retriever_obj = build_chroma_index([], persist_directory="./chroma_db")
        retriever = retriever_obj
        logging.info("Retriever loaded.")
    except Exception as e:
        logging.error(f"Failed to load retriever: {e}")
        import traceback
        traceback.print_exc()

@app_fastapi.post("/rag")
async def rag_query(request: Request):
    global retriever
    data = await request.json()
    query = data.get("query", "")
    if not query:
        return {"answer": "No query provided."}
    if retriever is None:
        return {"answer": "Retriever not loaded yet. Please try again in a few seconds."}
    results = retriever.retrieve(query)
    answer = results[0].node.text if results else "No answer found."
    return {"answer": answer}

if __name__ == "__main__":
    if not os.environ.get("OPENAI_API_KEY"):
        openai_key = getpass.getpass(prompt="Enter your OPENAI_API_KEY (input hidden): ")
        os.environ["OPENAI_API_KEY"] = openai_key
    import uvicorn
    uvicorn.run(app_fastapi, host="0.0.0.0", port=8000)
