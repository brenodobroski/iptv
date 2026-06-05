from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI()

# Libera o CORS para o seu frontend local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/proxy")
async def get_m3u(url: str):
    # httpx lida muito bem com requisições longas e arquivos grandes
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        return response.text