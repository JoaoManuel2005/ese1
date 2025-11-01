from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from rag_pipeline import RAGPipeline

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rag_pipeline = RAGPipeline()

@app.post("/rag")
async def rag_endpoint(request: Request):
    body = await request.json()
    query = body.get("query", "")
    result = rag_pipeline.run(query)
    return result
