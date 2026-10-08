"""
LM Studio MCP Bridge - FastAPI ↔ LM Studio Embeddings
Connects music-playlist FastAPI to LM Studio's local LLM/embeddings server.
"""
import os
import json
import requests
import asyncio
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Configuration
LMSTUDIO_API_URL = os.getenv("LMSTUDIO_API_URL", "http://localhost:1234/v1")
LMSTUDIO_EMBED_URL = f"{LMSTUDIO_API_URL}/embeddings"
LMSTUDIO_CHAT_URL = f"{LMSTUDIO_API_URL}/chat/completions"
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text-v1.5")

# Pydantic models
class EmbeddingRequest(BaseModel):
    text: str
    model: Optional[str] = None

class BatchEmbeddingRequest(BaseModel):
    texts: List[str]
    model: Optional[str] = None

class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    model: Optional[str] = None
    temperature: Optional[float] = 0.7

class LMStudioBridge:
    """Bridge between FastAPI and LM Studio's local LLM server."""
    
    def __init__(self):
        self.api_url = LMSTUDIO_API_URL
        self.embed_url = LMSTUDIO_EMBED_URL
        self.chat_url = LMSTUDIO_CHAT_URL
        self.model = EMBEDDING_MODEL
    
    async def check_server(self) -> Dict[str, Any]:
        """Check if LM Studio server is running."""
        try:
            response = requests.get(f"{self.api_url}/models", timeout=5)
            response.raise_for_status()
            return {"status": "online", "models": response.json()}
        except requests.exceptions.RequestException as e:
            return {"status": "offline", "error": str(e)}
    
    def get_embedding(self, text: str, model: Optional[str] = None) -> List[float]:
        """Get embedding vector from LM Studio."""
        model_name = model or self.model
        try:
            response = requests.post(
                self.embed_url,
                json={"model": model_name, "input": text},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            return data["data"][0]["embedding"]
        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=500, detail=f"LM Studio error: {e}")
    
    def get_batch_embeddings(self, texts: List[str], model: Optional[str] = None) -> List[List[float]]:
        """Get batch embeddings from LM Studio."""
        model_name = model or self.model
        try:
            response = requests.post(
                self.embed_url,
                json={"model": model_name, "input": texts},
                timeout=60
            )
            response.raise_for_status()
            data = response.json()
            return [item["embedding"] for item in data["data"]]
        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=500, detail=f"LM Studio error: {e}")
    
    def chat(self, messages: List[Dict[str, str]], model: Optional[str] = None, temperature: float = 0.7) -> str:
        """Send chat completion request to LM Studio."""
        model_name = model or self.model
        try:
            response = requests.post(
                self.chat_url,
                json={
                    "model": model_name,
                    "messages": messages,
                    "temperature": temperature
                },
                timeout=60
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=500, detail=f"LM Studio error: {e}")
    
    def embed_music_tracks(self, tracks_path: str) -> List[dict]:
        """Embed all music tracks from JSONL file."""
        tracks = []
        texts = []
        with open(tracks_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    track = json.loads(line)
                    text = f"{track.get('artist', '')} - {track.get('title', '')}"
                    texts.append(text)
                    tracks.append(track)
                except json.JSONDecodeError:
                    continue
        
        embeddings = self.get_batch_embeddings(texts)
        
        for i, track in enumerate(tracks):
            track["embedding"] = embeddings[i]
            track["embedding_text"] = texts[i]
        
        return tracks

# Initialize bridge
bridge = LMStudioBridge()

def register_lmstudio_routes(app: FastAPI):
    """Register LM Studio routes on the FastAPI app."""
    
    @app.post("/lmstudio/embed")
    async def embed(request: EmbeddingRequest):
        """Get embedding vector for single text."""
        embedding = bridge.get_embedding(request.text, request.model)
        return {"embedding": embedding, "model": request.model or bridge.model}
    
    @app.post("/lmstudio/embed/batch")
    async def embed_batch(request: BatchEmbeddingRequest):
        """Get batch embeddings for multiple texts."""
        embeddings = bridge.get_batch_embeddings(request.texts, request.model)
        return {"embeddings": embeddings, "model": request.model or bridge.model}
    
    @app.post("/lmstudio/chat")
    async def chat(request: ChatRequest):
        """Send chat completion to LM Studio."""
        result = bridge.chat(request.messages, request.model, request.temperature)
        return {"response": result, "model": request.model or bridge.model}
    
    @app.get("/lmstudio/status")
    async def status():
        """Check LM Studio server status."""
        return await bridge.check_server()
    
    @app.post("/lmstudio/embed/music")
    async def embed_music(region: str = "Japan"):
        """Embed all music tracks for a region."""
        tracks_path = f"/home/bons/music-playlist/data/{region}/tracks.jsonl"
        if not os.path.exists(tracks_path):
            raise HTTPException(status_code=404, detail=f"Tracks file not found: {tracks_path}")
        tracks = bridge.embed_music_tracks(tracks_path)
        return {"region": region, "count": len(tracks), "tracks": tracks}