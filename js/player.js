// Instanciando os players (depende do VideoJS já ter sido carregado no HTML)
// Opções de buffer/ABR ajustadas para HLS iniciar mais rápido e trocar de qualidade sem travar
const VJS_HLS_OPTIONS = {
    preload: 'auto',
    liveui: true,
    html5: {
        vhs: {
            overrideNative: true,
            enableLowInitialPlaylist: true, // começa numa qualidade menor pra dar play mais rápido
            fastQualityChange: true,
            smoothQualityChange: true,
            useBandwidthFromLocalStorage: true // guarda estimativa de banda entre sessões
        },
        nativeAudioTracks: false,
        nativeVideoTracks: false
    }
};

const player = videojs('my-video', VJS_HLS_OPTIONS);
const livePlayer = videojs('live-mini-video', VJS_HLS_OPTIONS);

// Lembra o volume/mudo entre sessões (não é sobre "continuar assistindo", é sobre não perder a preferência de som)
(function restaurarVolume() {
    const volSalvo = parseFloat(localStorage.getItem('iptv_player_volume'));
    const mutedSalvo = localStorage.getItem('iptv_player_muted') === '1';
    if (!isNaN(volSalvo)) { player.volume(volSalvo); livePlayer.volume(volSalvo); }
    if (mutedSalvo) { player.muted(true); livePlayer.muted(true); }
})();
player.on('volumechange', () => {
    localStorage.setItem('iptv_player_volume', player.volume());
    localStorage.setItem('iptv_player_muted', player.muted() ? '1' : '0');
});

function forcarFechamentoPlayer() {
    if (document.getElementById('player-wrapper').style.display === 'flex') {
        persistirHistorico(true);
        player.pause();
        document.getElementById('player-wrapper').style.display = 'none';
        videoEmReproducao = null;
        esconderErroPlayer();
        pararWatchdogTravamento();
        esconderBotaoProximoEpisodio();
    }
    if (livePlayer) livePlayer.pause();
}

// Pequeno aviso não-intrusivo tipo "Retomando de 12:34"
function mostrarToastPlayer(texto) {
    let toast = document.getElementById('player-resume-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'player-resume-toast';
        document.getElementById('player-wrapper').appendChild(toast);
    }
    toast.textContent = texto;
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

function formatarTempo(segundos) {
    const s = Math.floor(segundos % 60).toString().padStart(2, '0');
    const m = Math.floor((segundos / 60) % 60).toString().padStart(2, '0');
    const h = Math.floor(segundos / 3600);
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

let loadingTimeoutId = null;

// ================== RECUPERAÇÃO AUTOMÁTICA DE TRAVAMENTO ==================
// Filmes/séries são arquivos grandes, e o proxy agora entrega em pedaços
// pequenos (ver main.py) — mas mesmo assim uma rede instável pode falhar num
// pedaço específico. Hoje, quando isso acontecia, o vídeo só travava e a
// pessoa precisava sair do player e apertar play de novo manualmente (o que,
// por sorte, resume do ponto salvo — mas exige que ELA perceba o problema).
// A ideia aqui é fazer automaticamente o que "sair e dar play de novo" fazia:
// reabrir a mesma URL (retomando de onde parou, graças ao histórico salvo),
// sem incomodar a pessoa, e só mostrar um erro de verdade se isso falhar
// repetidas vezes seguidas (nesse caso, provavelmente é a internet dela ou o
// servidor do provedor que está fora do ar).
let tentativasAutoRecuperacao = 0;
const MAX_TENTATIVAS_AUTO_RECUPERACAO = 4;
let watchdogTravamentoId = null;
let ultimoTempoWatchdog = -1;

function tentarRecuperarPlayer(motivo) {
    if (!videoEmReproducao || !videoEmReproducao.url) {
        mostrarErroPlayer('Não foi possível reproduzir este conteúdo.');
        return;
    }
    tentativasAutoRecuperacao++;
    if (tentativasAutoRecuperacao > MAX_TENTATIVAS_AUTO_RECUPERACAO) {
        mostrarErroPlayer('A reprodução caiu várias vezes seguidas. Verifique sua conexão e tente novamente em instantes.');
        return;
    }
    console.warn(`[player] ${motivo} — recuperando automaticamente (tentativa ${tentativasAutoRecuperacao}/${MAX_TENTATIVAS_AUTO_RECUPERACAO})`);
    mostrarToastPlayer('Reconectando...');
    abrirPlayer(videoEmReproducao.url, videoEmReproducao, true);
}

function iniciarWatchdogTravamento() {
    pararWatchdogTravamento();
    ultimoTempoWatchdog = -1;
    watchdogTravamentoId = setInterval(() => {
        if (document.getElementById('player-wrapper').style.display !== 'flex') return;
        if (player.paused() || player.seeking() || player.ended()) {
            ultimoTempoWatchdog = player.currentTime();
            return;
        }
        const tempoAtual = player.currentTime();
        if (tempoAtual === ultimoTempoWatchdog) {
            tentarRecuperarPlayer('Reprodução parou de avançar');
        } else {
            tentativasAutoRecuperacao = 0; // voltou a andar normal — zera o contador
        }
        ultimoTempoWatchdog = tempoAtual;
    }, 10000); // checa a cada 10s
}

function pararWatchdogTravamento() {
    if (watchdogTravamentoId) clearInterval(watchdogTravamentoId);
    watchdogTravamentoId = null;
}

function abrirPlayer(url, metadados = null, ehTentativaAutomatica = false) {
    if (!url) return;
    // Só zera o contador de tentativas quando é uma abertura NOVA pedida pela
    // pessoa — se for uma reconexão automática (ehTentativaAutomatica=true),
    // preserva a contagem pra não tentar pra sempre em loop infinito.
    if (!ehTentativaAutomatica) tentativasAutoRecuperacao = 0;

    videoEmReproducao = metadados; 
    lastViewBeforePlayer = document.querySelector('.view-section.active').id;
    const wrapper = document.getElementById('player-wrapper');
    wrapper.style.display = 'flex';

    esconderErroPlayer();
    esconderBotaoProximoEpisodio();
    mostrarCarregandoPlayer(true);
    clearTimeout(loadingTimeoutId);
    
    let urlCorrigida = url.toLowerCase().includes('.ts') && !url.toLowerCase().includes('/movie/') && !url.toLowerCase().includes('/series/') ? url.replace('.ts', '.m3u8') : url;

    // IMPORTANTE: o provedor Xtream só fala HTTP, mas a página roda em HTTPS (Vercel).
    // Se mandarmos a URL http:// direto pro video.js, o navegador bloqueia por
    // "Mixed Content" (erro CODE:2 MEDIA_ERR_NETWORK). Por isso passamos pelo mesmo
    // proxy Python usado nas chamadas de API — ele também reescreve os links internos
    // do .m3u8 (segmentos/variantes) pra continuarem em HTTPS. Se um dia a URL já vier
    // em https://, não precisa proxiar.
    if (urlCorrigida.toLowerCase().startsWith('http://')) {
        urlCorrigida = montarUrlProxy(urlCorrigida);
    }

    player.src({ src: urlCorrigida, type: urlCorrigida.toLowerCase().includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4' });

    function pararDeCarregar() {
        mostrarCarregandoPlayer(false);
        clearTimeout(loadingTimeoutId);
    }

    // IMPORTANTE: `player.ready()` só dispara uma vez na vida do player (na inicialização),
    // então numa segunda reprodução ele já roda na hora, ANTES da nova fonte carregar os metadados
    // — por isso o "continuar de onde parou" não funcionava de forma confiável.
    // O evento correto pra buscar (seek) é 'loadedmetadata', que dispara toda vez que uma nova
    // fonte (src) é carregada e a duração/currentTime já são válidos.
    player.one('loadedmetadata', () => {
        pararDeCarregar();
        const savedProgress = videoEmReproducao && historicoAssistidos[videoEmReproducao.id];
        if (savedProgress && savedProgress.currentTime > 0) {
            player.currentTime(savedProgress.currentTime);
            mostrarToastPlayer(`Continuando de ${formatarTempo(savedProgress.currentTime)}`);
        }
    });
    // Rede de segurança: se por algum motivo 'loadedmetadata' não disparar mas o vídeo
    // já está de fato tocando, tira o spinner de qualquer jeito.
    player.one('playing', pararDeCarregar);
    // Só liga o vigia de travamento DEPOIS que a reprodução realmente começou —
    // evita falso alarme durante o carregamento inicial (buffer ainda em 0).
    player.one('playing', iniciarWatchdogTravamento);

    // Rede de segurança 2: se depois de 15s nada aconteceu (link travado, servidor fora do
    // ar, CORS, etc), não deixa o spinner girando pra sempre — tenta reconectar sozinho
    // antes de incomodar a pessoa com uma mensagem de erro.
    loadingTimeoutId = setTimeout(() => {
        if (player.paused() && (player.readyState() < 2)) {
            mostrarCarregandoPlayer(false);
            tentarRecuperarPlayer('Demorou demais pra carregar');
        }
    }, 15000);

    // AbortError aqui é inofensivo: acontece quando um play() em andamento é
    // interrompido por um pause() (ex: usuário troca de canal rápido, ou fechamos
    // o player enquanto a promise ainda não resolveu). Não indica falha real.
    player.play().catch(e => {
        if (e && e.name === 'AbortError') return;
        console.error(e);
    });
}

function mostrarCarregandoPlayer(mostrar) {
    const wrapper = document.getElementById('player-wrapper');
    if (!wrapper) return;
    wrapper.classList.toggle('player-loading', mostrar);
}

function esconderErroPlayer() {
    const erroEl = document.getElementById('player-erro-msg');
    if (erroEl) erroEl.remove();
}

// Tratamento de erro do player (canal fora do ar, link quebrado, demora demais, etc) — em vez
// de travar mudo ou girando pra sempre, mostra uma mensagem clara com botão de tentar de novo.
function mostrarErroPlayer(mensagem) {
    clearTimeout(loadingTimeoutId);
    mostrarCarregandoPlayer(false);
    esconderErroPlayer();
    const erroEl = document.createElement('div');
    erroEl.id = 'player-erro-msg';
    erroEl.innerHTML = `
        <p style="margin-bottom:12px;">${mensagem}</p>
        <button id="btn-retry-player">Tentar novamente</button>
    `;
    document.getElementById('player-wrapper').appendChild(erroEl);
    document.getElementById('btn-retry-player').onclick = () => {
        if (videoEmReproducao && videoEmReproducao.url) abrirPlayer(videoEmReproducao.url, videoEmReproducao);
    };
}

player.on('error', () => tentarRecuperarPlayer('Erro de rede/mídia reportado pelo video.js'));

// Atalhos de teclado: espaço (play/pause), setas (±10s), M (mudo)
document.addEventListener('keydown', (e) => {
    if (document.getElementById('player-wrapper').style.display !== 'flex') return;
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
        case 'Space': e.preventDefault(); player.paused() ? player.play() : player.pause(); break;
        case 'ArrowRight': player.currentTime(player.currentTime() + 10); break;
        case 'ArrowLeft': player.currentTime(Math.max(0, player.currentTime() - 10)); break;
        case 'KeyM': player.muted(!player.muted()); break;
    }
});

// Salva o histórico (Continuar assistindo).
// Gravar no localStorage a cada "timeupdate" (que dispara várias vezes por segundo) é caro e
// pode até engasgar o vídeo — por isso jogamos o valor pra uma variável em memória o tempo todo,
// mas só GRAVAMOS no localStorage no máximo 1x a cada 5s (e sempre ao pausar/trocar de vídeo).
let progressoPendente = null;
let ultimoSaveHistorico = 0;
const HISTORICO_SAVE_INTERVAL = 5000;

function persistirHistorico(forcar = false) {
    if (!progressoPendente) return;
    const agora = Date.now();
    if (!forcar && (agora - ultimoSaveHistorico) < HISTORICO_SAVE_INTERVAL) return;

    const { id, dados } = progressoPendente;
    if (dados === null) delete historicoAssistidos[id];
    else historicoAssistidos[id] = dados;

    localStorage.setItem('iptv_api_history', JSON.stringify(historicoAssistidos));
    ultimoSaveHistorico = agora;
    progressoPendente = null;
}

player.on('timeupdate', () => {
    if (!videoEmReproducao || videoEmReproducao.aba === 'live') return;
    
    const currentTime = player.currentTime(); 
    const duration = player.duration();
    
    if (duration && currentTime > 5) {
        const percent = currentTime / duration;
        if (percent > 0.95) {
            progressoPendente = { id: videoEmReproducao.id, dados: null };
            // Registra que esse episódio/filme foi assistido até o fim — ao
            // contrário do progresso acima (que é apagado), este registro fica
            // pra sempre, e é o que faz aparecer "✓ Assistido" na lista.
            marcarComoCompleto(videoEmReproducao.id);
        } else {
            progressoPendente = { 
                id: videoEmReproducao.id,
                dados: { 
                    ...videoEmReproducao, 
                    currentTime, 
                    duration, 
                    percent, 
                    timestamp: Date.now() 
                }
            };
        }
        persistirHistorico(false);
    }

    // ============ BOTÃO "PRÓXIMO EPISÓDIO" (últimos 10 segundos) ============
    if (videoEmReproducao.aba === 'series' && Array.isArray(videoEmReproducao.listaEpisodios)) {
        const proximo = videoEmReproducao.listaEpisodios[videoEmReproducao.indiceEpisodio + 1];
        const faltam = duration ? duration - currentTime : Infinity;
        if (proximo && duration && faltam <= 10) {
            mostrarBotaoProximoEpisodio(proximo, videoEmReproducao.listaEpisodios, videoEmReproducao.indiceEpisodio + 1);
        } else {
            esconderBotaoProximoEpisodio();
        }
    }
});

// Se o vídeo chegar ao fim naturalmente (sem o usuário ter pausado antes),
// garante que o episódio é marcado como completo mesmo que o timeupdate não
// tenha rodado bem na última fração de segundo.
player.on('ended', () => {
    if (videoEmReproducao && videoEmReproducao.aba !== 'live') {
        marcarComoCompleto(videoEmReproducao.id);
        progressoPendente = { id: videoEmReproducao.id, dados: null };
        persistirHistorico(true);
    }
});

// Cria (ou atualiza) o botão flutuante de "Próximo episódio" no canto inferior
// direito do player. `proximo` é o objeto { id, name, url, temporada } vindo
// da lista achatada de episódios montada em abrirDetalhesMedia (ui.js).
function mostrarBotaoProximoEpisodio(proximo, listaCompleta, indiceProximo) {
    let btn = document.getElementById('btn-proximo-episodio');
    if (btn) return; // já está visível, não recria
    btn = document.createElement('button');
    btn.id = 'btn-proximo-episodio';
    btn.className = 'btn-proximo-episodio';
    btn.innerHTML = `
        <span class="prox-ep-textos">
            <span class="prox-ep-label">Próximo episódio</span>
            <span class="prox-ep-nome">${proximo.name || ''}</span>
        </span>
        <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    `;
    btn.onclick = () => {
        esconderBotaoProximoEpisodio();
        abrirPlayer(proximo.url, {
            id: proximo.id,
            name: proximo.name,
            url: proximo.url,
            aba: 'series',
            listaEpisodios: listaCompleta,
            indiceEpisodio: indiceProximo
        });
    };
    document.getElementById('player-wrapper').appendChild(btn);
}

function esconderBotaoProximoEpisodio() {
    const btn = document.getElementById('btn-proximo-episodio');
    if (btn) btn.remove();
}
window.esconderBotaoProximoEpisodio = esconderBotaoProximoEpisodio;

// Garante que o progresso mais recente não se perde ao pausar, trocar de vídeo ou fechar a aba
player.on('pause', () => persistirHistorico(true));
window.addEventListener('beforeunload', () => persistirHistorico(true));

document.getElementById('btn-fechar-player').addEventListener('click', () => {
    persistirHistorico(true);
    player.pause(); 
    document.getElementById('player-wrapper').style.display = 'none'; 
    videoEmReproducao = null;
    esconderErroPlayer();
    pararWatchdogTravamento();
    esconderBotaoProximoEpisodio();
    
    if (lastViewBeforePlayer === 'home-view') {
        renderizarHome(); // chamando função de ui.js
    }
    else if (lastViewBeforePlayer === 'media-detail' && mediaAtivaObj) {
        abrirDetalhesMedia(mediaAtivaObj.id, mediaAtivaObj.tipo); // chamando função de ui.js
    }
});

function decodeEPG(str) {
    if (!str) return '';
    try {
        // Tenta descodificar de Base64 para UTF-8 (para acentos funcionarem)
        return decodeURIComponent(escape(window.atob(str)));
    } catch (e) {
        // Se não for Base64, devolve o texto original
        return str; 
    }
}

// Disponibiliza a mesma função com o nome usado em ui.js e em buscarEPGSilencioso
window.decodeBase64EPG = decodeEPG;


// Carrega EPG (Programação do Canal Ao vivo)
async function carregarEPGCanal(streamId) {
    const epgContent = document.getElementById('live-epg-container');
    epgContent.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">Carregando EPG...</div>';
    
    try {
        const data = await fetchAPI('get_short_epg', `&stream_id=${streamId}`);
        if (data && data.epg_listings && data.epg_listings.length > 0) {
            let htmlElements = '';
            
            data.epg_listings.forEach((prog, index) => {
                // Descodifica o título que vem em Base64
                const title = decodeEPG(prog.title); 
                
                // Formata o horário (Ex: "17:05 - 17:40")
                const start = prog.start ? (prog.start.includes(' ') ? prog.start.split(' ')[1].substring(0, 5) : prog.start) : '';
                const end = prog.end ? (prog.end.includes(' ') ? prog.end.split(' ')[1].substring(0, 5) : prog.end) : '';
                const timeStr = (start && end) ? `${start} - ${end}` : start;
                
                // O primeiro item (índice 0) costuma ser o programa atual, então marcamos como active
                const isActive = index === 0 ? 'active' : '';
                
                // Atualiza o subtítulo na lista da esquerda
                if (index === 0) {
                    const miniProg = document.getElementById(`prog-mini-${streamId}`);
                    if (miniProg) miniProg.textContent = `${timeStr} ${title}`;
                }

                // Cria a linha estilo Apple TV+
                htmlElements += `
                    <div class="epg-row ${isActive}">
                        <span class="epg-time">${timeStr}</span>
                        <span class="epg-title">${title}</span>
                        <div class="epg-progress"><div class="epg-progress-fill"></div></div>
                        <div class="epg-dot"></div>
                    </div>
                `;
            });
            epgContent.innerHTML = htmlElements;
        } else {
            epgContent.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">Nenhuma programação disponível para este canal.</div>';
            const miniProg = document.getElementById(`prog-mini-${streamId}`);
            if (miniProg) miniProg.textContent = "Programação Indisponível";
        }
    } catch (err) { 
        epgContent.innerHTML = '<div style="color: var(--event-color); padding: 20px;">Falha ao buscar EPG.</div>'; 
    }
}

// ================== FILA DE BUSCA DE EPG (evita 429 "Too Many Requests") ==================
// Quando a lista Ao Vivo renderiza e várias linhas já aparecem na tela de uma vez, o
// IntersectionObserver do ui.js chamava buscarEPGSilencioso() pra CADA UMA delas ao mesmo
// tempo — 15, 20, 30 chamadas simultâneas pro provedor. Muitos provedores Xtream (ainda
// mais os mais baratos/revendidos) têm um limite de requisições por segundo BEM baixo, e
// respondem 429 quando isso acontece. Essa fila garante no máximo algumas chamadas em
// paralelo, e se o provedor mesmo assim mandar um 429, dá uma pausa curta antes de tentar
// as próximas — em vez de continuar martelando e piorar o bloqueio.
const filaEpg = [];
let epgEmAndamento = 0;
const EPG_MAX_CONCORRENTE = 3;
let epgPausadoAte = 0;

function processarFilaEpg() {
    if (Date.now() < epgPausadoAte) {
        setTimeout(processarFilaEpg, epgPausadoAte - Date.now() + 50);
        return;
    }
    while (epgEmAndamento < EPG_MAX_CONCORRENTE && filaEpg.length > 0) {
        const streamId = filaEpg.shift();
        epgEmAndamento++;
        executarBuscaEpg(streamId).finally(() => {
            epgEmAndamento--;
            processarFilaEpg();
        });
    }
}

async function executarBuscaEpg(streamId) {
    const miniProg = document.getElementById(`prog-mini-${streamId}`);
    try {
        const data = await fetchAPI('get_short_epg', `&stream_id=${streamId}`);
        if (!miniProg) return;

        if (data && data.epg_listings && data.epg_listings.length > 0) {
            const prog = data.epg_listings[0];
            const title = window.decodeBase64EPG(prog.title);
            const start = prog.start ? (prog.start.includes(' ') ? prog.start.split(' ')[1].substring(0, 5) : prog.start) : '';
            const end = prog.end ? (prog.end.includes(' ') ? prog.end.split(' ')[1].substring(0, 5) : prog.end) : '';
            const timeStr = (start && end) ? `${start} - ${end}` : start;
            miniProg.textContent = `${timeStr} ${title}`;
        } else {
            miniProg.textContent = "Programação Indisponível";
        }
    } catch (e) {
        if (e && e.status === 429) {
            // O provedor pediu pra parar um pouco — pausa a fila toda por 5s e devolve
            // esse canal pra tentar de novo depois, em vez de descartar o pedido.
            epgPausadoAte = Date.now() + 5000;
            filaEpg.push(streamId);
            return;
        }
        if (miniProg) miniProg.textContent = "Programação Indisponível";
    }
}

window.buscarEPGSilencioso = function(streamId) {
    if (filaEpg.includes(streamId)) return;
    filaEpg.push(streamId);
    processarFilaEpg();
};