from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from urllib.parse import urlparse
import httpx

app = FastAPI()

# CORS — em produção, troque "*" pelo domínio do seu app (ex: https://breno-iptv.vercel.app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Apenas requisições para endpoints conhecidos da API Xtream são repassadas.
# Isso evita que o proxy seja usado como "open proxy" para qualquer site.
ALLOWED_PATH_PARTS = ("/player_api.php", "/live/", "/movie/", "/series/", "/xmltv.php")


@app.get("/api/proxy")
async def proxy(url: str = Query(...)):
    parsed = urlparse(url)

    # Só aceita http/https e um caminho que pareça da API IPTV
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL invalida.")
    if not any(part in parsed.path for part in ALLOWED_PATH_PARTS):
        raise HTTPException(status_code=403, detail="Endpoint nao permitido.")

    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.get(url)
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Falha ao contatar o servidor IPTV.")

    # Preserva o tipo de conteudo original quando existir, com fallback para JSON
    media_type = response.headers.get("content-type", "application/json")
    return Response(content=response.content, media_type=media_type, status_code=response.status_code)
