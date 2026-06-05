from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
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

# Atualizamos a rota para refletir o caminho que o frontend vai chamar
@app.get("/api/proxy")
async def get_m3u(url: str):
    # httpx lida muito bem com requisições longas e arquivos grandes
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        
        # Retorna o texto bruto já sinalizando para o navegador que é um JSON
        return Response(content=response.text, media_type="application/json")