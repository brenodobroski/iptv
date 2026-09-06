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
# "/hls/" foi adicionado porque, em transmissões ao vivo com HLS adaptativo, o
# Xtream gera as variantes de qualidade e os segmentos dentro de um caminho
# "/hls/<id>-<hash>/..." — diferente de "/live/", "/movie/", "/series/". Sem
# isso, o próprio proxy bloqueava esses links com 403, mesmo já vindo
# corretamente reescritos pela lógica de m3u8.
ALLOWED_PATH_PARTS = ("/player_api.php", "/live/", "/movie/", "/series/", "/hls/", "/xmltv.php")

# Client HTTP ÚNICO e reaproveitado entre requisições (pool de conexões).
# Antes criávamos um `httpx.AsyncClient` novo a cada chamada — isso força um
# handshake TCP+TLS do zero toda vez. Pra TV ao vivo, onde o player pede um
# segmento .ts novo a cada poucos segundos, esse overhead repetido é o que
# fazia o vídeo ficar "carregando" pra sempre: o buffer nunca conseguia
# andar mais rápido que a demora de cada conexão nova.
client = httpx.AsyncClient(timeout=60.0, follow_redirects=True)

# Tamanho máximo de cada pedaço de vídeo repassado por execução (ver uso mais
# abaixo). 6 MB dá vários segundos de vídeo de sobra pro player continuar
# tocando enquanto pede o próximo pedaço, mas termina rápido o bastante pra
# nunca chegar perto do limite de duração de uma função serverless.
MAX_CHUNK_BYTES = 6 * 1024 * 1024


def _parse_range_header(range_header):
    """Extrai (inicio, fim) de um cabeçalho 'Range: bytes=100-200' ou
    'bytes=100-'. Se não houver cabeçalho, assume que o pedido começa do
    byte 0 (comportamento padrão de navegador na primeira requisição)."""
    if not range_header or not range_header.startswith("bytes="):
        return 0, None
    partes = range_header.split("=", 1)[1].split("-")
    inicio = int(partes[0]) if partes[0] else 0
    fim = int(partes[1]) if len(partes) > 1 and partes[1] else None
    return inicio, fim


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
    return any(p in caminho for p in ("/live/", "/movie/", "/series/", "/hls/"))


@app.get("/api/proxy")
async def proxy(request: Request, url: str = Query(...)):
    parsed = urlparse(url)

    # Só aceita http/https e um caminho que pareça da API IPTV
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL invalida.")
    if not any(part in parsed.path for part in ALLOWED_PATH_PARTS):
        raise HTTPException(status_code=403, detail="Endpoint nao permitido.")

    # --- Arquivos de vídeo de verdade (segmento .ts, filme, episódio) ---
    # Aqui NÃO podemos baixar/repassar o arquivo inteiro numa execução só: filmes
    # têm centenas de MB/alguns GB, e funções serverless da Vercel têm um limite
    # rígido de duração por execução (maxDuration). Se um pedido de vídeo pedir
    # "me manda o resto do arquivo" e isso demorar mais que esse limite, a Vercel
    # MATA a função no meio da transferência — a conexão cai sem nenhum erro
    # limpo, e o player trava, exigindo fechar e reabrir pra criar uma conexão
    # nova. Para evitar isso, NUNCA repassamos mais que MAX_CHUNK_BYTES de uma
    # vez, não importa quanto o player pediu — cada chamada termina em poucos
    # segundos, bem longe do limite, e o player simplesmente pede o próximo
    # pedaço em seguida (é assim que streaming de vídeo profissional funciona).
    if _e_arquivo_de_midia(parsed.path):
        inicio, fim_pedido = _parse_range_header(request.headers.get("range"))
        fim_desejado = inicio + MAX_CHUNK_BYTES - 1
        if fim_pedido is not None:
            fim_desejado = min(fim_desejado, fim_pedido)
        tamanho_do_pedaco = fim_desejado - inicio + 1

        headers_upstream = {"range": f"bytes={inicio}-{fim_desejado}"}
        try:
            req_upstream = client.build_request("GET", url, headers=headers_upstream)
            upstream = await client.send(req_upstream, stream=True)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Falha ao contatar o servidor IPTV.")

        media_type = upstream.headers.get("content-type", "video/mp2t")
        headers_resposta = {"Accept-Ranges": "bytes"}
        status_resposta = 206

        if upstream.status_code == 206 and "content-range" in upstream.headers:
            # Caminho normal: a origem entendeu nosso Range e já nos diz
            # exatamente qual pedaço (e o tamanho total do arquivo) ela mandou.
            # Confiamos nesse valor, só reforçamos o corte no gerador abaixo
            # como rede de segurança caso ela mande além do combinado.
            headers_resposta["Content-Range"] = upstream.headers["content-range"]
            if "content-length" in upstream.headers:
                tamanho_do_pedaco = min(tamanho_do_pedaco, int(upstream.headers["content-length"]))
        elif upstream.status_code == 200:
            # Caso raro: a origem não suporta Range e mandou o arquivo inteiro.
            # Ainda assim cortamos o quanto REPASSAMOS pra manter a execução
            # curta — usamos o Content-Length dela pra saber o tamanho real
            # total e montar um Content-Range coerente nós mesmos.
            tamanho_total = upstream.headers.get("content-length")
            fim_real = inicio + tamanho_do_pedaco - 1
            if tamanho_total:
                fim_real = min(fim_real, int(tamanho_total) - 1)
                tamanho_do_pedaco = fim_real - inicio + 1
                headers_resposta["Content-Range"] = f"bytes {inicio}-{fim_real}/{tamanho_total}"
        else:
            # Erro de verdade vindo da origem (404, 403, etc.) — repassa como está.
            status_resposta = upstream.status_code

        if status_resposta == 206:
            headers_resposta["Content-Length"] = str(tamanho_do_pedaco)

        async def gerador_de_bytes():
            enviado = 0
            try:
                async for pedaco in upstream.aiter_bytes():
                    if status_resposta == 206:
                        restante = tamanho_do_pedaco - enviado
                        if restante <= 0:
                            break
                        if len(pedaco) > restante:
                            pedaco = pedaco[:restante]
                    yield pedaco
                    enviado += len(pedaco)
                    if status_resposta == 206 and enviado >= tamanho_do_pedaco:
                        break
            finally:
                await upstream.aclose()

        return StreamingResponse(
            gerador_de_bytes(),
            status_code=status_resposta,
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