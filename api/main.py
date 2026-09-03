from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from urllib.parse import urlparse, urljoin, quote
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

# Client HTTP ÚNICO e reaproveitado entre requisições (pool de conexões).
# Antes criávamos um `httpx.AsyncClient` novo a cada chamada — isso força um
# handshake TCP+TLS do zero toda vez. Pra TV ao vivo, onde o player pede um
# segmento .ts novo a cada poucos segundos, esse overhead repetido é o que
# fazia o vídeo ficar "carregando" pra sempre: o buffer nunca conseguia
# andar mais rápido que a demora de cada conexão nova.
client = httpx.AsyncClient(timeout=60.0, follow_redirects=True)


def _montar_url_proxy(base_absoluta: str, url_alvo: str) -> str:
    """Monta a URL do próprio proxy apontando para `url_alvo`, usando o mesmo host
    que o cliente já está usando para falar com este servidor (HTTPS)."""
    return f"{base_absoluta}api/proxy?url={quote(url_alvo, safe='')}"


def _e_arquivo_de_midia(path: str) -> bool:
    """True para segmentos .ts e arquivos de vídeo completos (filme/episódio).
    Falso para chamadas de API (JSON) e para a própria playlist .m3u8 (que
    precisa ser lida inteira em texto pra ser reescrita)."""
    caminho = path.lower()
    if "player_api.php" in caminho or caminho.endswith(".m3u8") or caminho.endswith(".php"):
        return False
    return any(p in caminho for p in ("/live/", "/movie/", "/series/"))


@app.get("/api/proxy")
async def proxy(request: Request, url: str = Query(...)):
    parsed = urlparse(url)

    # Só aceita http/https e um caminho que pareça da API IPTV
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL invalida.")
    if not any(part in parsed.path for part in ALLOWED_PATH_PARTS):
        raise HTTPException(status_code=403, detail="Endpoint nao permitido.")

    # --- Arquivos de vídeo de verdade (segmento .ts, filme, episódio) ---
    # Aqui NÃO podemos baixar o arquivo inteiro antes de responder: filmes têm
    # centenas de MB/alguns GB, e isso estoura tempo de execução e limite de
    # memória/tamanho de resposta de funções serverless — o navegador recebe
    # um arquivo cortado no meio e o video.js acusa "formato não suportado"
    # (CODE:4). A solução é encaminhar em streaming, pedaço por pedaço, e
    # repassar o cabeçalho "Range" (usado pelo player pra buscar/seek), senão
    # o player não consegue avançar/retroceder no vídeo.
    if _e_arquivo_de_midia(parsed.path):
        headers_upstream = {}
        range_header = request.headers.get("range")
        if range_header:
            headers_upstream["range"] = range_header

        try:
            req_upstream = client.build_request("GET", url, headers=headers_upstream)
            upstream = await client.send(req_upstream, stream=True)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Falha ao contatar o servidor IPTV.")

        media_type = upstream.headers.get("content-type", "video/mp2t")
        headers_resposta = {"Accept-Ranges": "bytes"}
        if "content-range" in upstream.headers:
            headers_resposta["Content-Range"] = upstream.headers["content-range"]
        if "content-length" in upstream.headers:
            headers_resposta["Content-Length"] = upstream.headers["content-length"]

        async def gerador_de_bytes():
            try:
                async for pedaco in upstream.aiter_bytes():
                    yield pedaco
            finally:
                await upstream.aclose()

        return StreamingResponse(
            gerador_de_bytes(),
            status_code=upstream.status_code,
            media_type=media_type,
            headers=headers_resposta,
        )

    # --- Chamadas de API (JSON) e playlists .m3u8 (texto pequeno) ---
    try:
        response = await client.get(url)
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Falha ao contatar o servidor IPTV.")

    # Preserva o tipo de conteudo original quando existir, com fallback para JSON
    media_type = response.headers.get("content-type", "application/json")

    # --- Correção do erro de "Mixed Content" no player ---
    # O provedor Xtream só fala HTTP. O app roda em HTTPS (Vercel), então o navegador
    # bloqueia qualquer requisição HTTP feita pelo player (Mixed Content). Já resolvemos
    # isso para a própria playlist (o player pede ela através deste proxy, em HTTPS).
    # Mas um arquivo .m3u8 contém, dentro dele, links (absolutos ou relativos) para os
    # segmentos de vídeo (.ts) ou para outras variantes de qualidade — e esses links
    # continuam apontando para http://. Se não reescrevermos essas linhas, o player lê
    # a playlist certinho, mas ao tentar baixar cada segmento cai no mesmo bloqueio.
    # Solução: quando a resposta é uma playlist HLS, trocamos cada linha de URI pelo
    # endereço deste mesmo proxy (em HTTPS), recursivamente.
    e_playlist_hls = "mpegurl" in media_type.lower() or parsed.path.lower().endswith(".m3u8")

    if e_playlist_hls and response.status_code == 200:
        base_absoluta = str(request.base_url)  # ex: https://breno-iptv.vercel.app/
        texto_original = response.content.decode("utf-8", errors="ignore")

        linhas_reescritas = []
        for linha in texto_original.splitlines():
            linha_limpa = linha.strip()
            if linha_limpa and not linha_limpa.startswith("#"):
                # Não é comentário/tag do m3u8 — é uma URI de segmento ou de variante.
                # Pode vir relativa (ex: "90013_1.ts") ou absoluta; resolvemos contra a
                # URL original antes de embrulhar no proxy.
                uri_absoluta = urljoin(url, linha_limpa)
                linhas_reescritas.append(_montar_url_proxy(base_absoluta, uri_absoluta))
            else:
                linhas_reescritas.append(linha)

        novo_conteudo = "\n".join(linhas_reescritas)
        return Response(content=novo_conteudo, media_type=media_type, status_code=response.status_code)

    return Response(content=response.content, media_type=media_type, status_code=response.status_code)

    # --- Correção do erro de "Mixed Content" no player ---
    # O provedor Xtream só fala HTTP. O app roda em HTTPS (Vercel), então o navegador
    # bloqueia qualquer requisição HTTP feita pelo player (Mixed Content). Já resolvemos
    # isso para a própria playlist (o player pede ela através deste proxy, em HTTPS).
    # Mas um arquivo .m3u8 contém, dentro dele, links (absolutos ou relativos) para os
    # segmentos de vídeo (.ts) ou para outras variantes de qualidade — e esses links
    # continuam apontando para http://. Se não reescrevermos essas linhas, o player lê
    # a playlist certinho, mas ao tentar baixar cada segmento cai no mesmo bloqueio.
    # Solução: quando a resposta é uma playlist HLS, trocamos cada linha de URI pelo
    # endereço deste mesmo proxy (em HTTPS), recursivamente.
    e_playlist_hls = "mpegurl" in media_type.lower() or parsed.path.lower().endswith(".m3u8")

    if e_playlist_hls and response.status_code == 200:
        base_absoluta = str(request.base_url)  # ex: https://breno-iptv.vercel.app/
        texto_original = response.content.decode("utf-8", errors="ignore")

        linhas_reescritas = []
        for linha in texto_original.splitlines():
            linha_limpa = linha.strip()
            if linha_limpa and not linha_limpa.startswith("#"):
                # Não é comentário/tag do m3u8 — é uma URI de segmento ou de variante.
                # Pode vir relativa (ex: "90013_1.ts") ou absoluta; resolvemos contra a
                # URL original antes de embrulhar no proxy.
                uri_absoluta = urljoin(url, linha_limpa)
                linhas_reescritas.append(_montar_url_proxy(base_absoluta, uri_absoluta))
            else:
                linhas_reescritas.append(linha)

        novo_conteudo = "\n".join(linhas_reescritas)
        return Response(content=novo_conteudo, media_type=media_type, status_code=response.status_code)

    return Response(content=response.content, media_type=media_type, status_code=response.status_code)