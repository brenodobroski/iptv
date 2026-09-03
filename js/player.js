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
    }
    if (livePlayer) livePlayer.pause();
}

// Pequeno aviso não-intrusivo tipo "Retomando de 12:34"
function mostrarToastPlayer(texto) {
    let toast = document.getElementById('player-resume-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'player-resume-toast';
        toast.style.cssText = 'position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(20,20,22,0.9);color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;z-index:50;pointer-events:none;transition:opacity 0.4s;';
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

function abrirPlayer(url, metadados = null) {
    if (!url) return;
    videoEmReproducao = metadados; 
    lastViewBeforePlayer = document.querySelector('.view-section.active').id;
    const wrapper = document.getElementById('player-wrapper');
    wrapper.style.display = 'flex';

    esconderErroPlayer();
    mostrarCarregandoPlayer(true);
    
    let urlCorrigida = url.toLowerCase().includes('.ts') && !url.toLowerCase().includes('/movie/') && !url.toLowerCase().includes('/series/') ? url.replace('.ts', '.m3u8') : url;
    
    player.src({ src: urlCorrigida, type: urlCorrigida.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4' });

    // IMPORTANTE: `player.ready()` só dispara uma vez na vida do player (na inicialização),
    // então numa segunda reprodução ele já roda na hora, ANTES da nova fonte carregar os metadados
    // — por isso o "continuar de onde parou" não funcionava de forma confiável.
    // O evento correto pra buscar (seek) é 'loadedmetadata', que dispara toda vez que uma nova
    // fonte (src) é carregada e a duração/currentTime já são válidos.
    player.one('loadedmetadata', () => {
        mostrarCarregandoPlayer(false);
        const savedProgress = videoEmReproducao && historicoAssistidos[videoEmReproducao.id];
        if (savedProgress && savedProgress.currentTime > 0) {
            player.currentTime(savedProgress.currentTime);
            mostrarToastPlayer(`Continuando de ${formatarTempo(savedProgress.currentTime)}`);
        }
    });

    player.play().catch(e => console.error(e));
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

// Tratamento de erro do player (canal fora do ar, link quebrado, etc) — em vez de travar mudo,
// mostra uma mensagem clara com botão de tentar de novo.
player.on('error', () => {
    mostrarCarregandoPlayer(false);
    esconderErroPlayer();
    const erroEl = document.createElement('div');
    erroEl.id = 'player-erro-msg';
    erroEl.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#fff;z-index:50;';
    erroEl.innerHTML = `
        <p style="margin-bottom:12px;">Não foi possível reproduzir este conteúdo.</p>
        <button id="btn-retry-player" style="padding:8px 20px;border-radius:6px;border:none;background:#ff5500;color:#fff;font-weight:bold;cursor:pointer;">Tentar novamente</button>
    `;
    document.getElementById('player-wrapper').appendChild(erroEl);
    document.getElementById('btn-retry-player').onclick = () => {
        if (videoEmReproducao && videoEmReproducao.url) abrirPlayer(videoEmReproducao.url, videoEmReproducao);
    };
});

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
});

// Garante que o progresso mais recente não se perde ao pausar, trocar de vídeo ou fechar a aba
player.on('pause', () => persistirHistorico(true));
window.addEventListener('beforeunload', () => persistirHistorico(true));

document.getElementById('btn-fechar-player').addEventListener('click', () => {
    persistirHistorico(true);
    player.pause(); 
    document.getElementById('player-wrapper').style.display = 'none'; 
    videoEmReproducao = null;
    esconderErroPlayer();
    
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

window.buscarEPGSilencioso = async function(streamId) {
    try {
        // Removido o &limit=1 que causava o erro na API do seu servidor
        const data = await fetchAPI('get_short_epg', `&stream_id=${streamId}`);
        const miniProg = document.getElementById(`prog-mini-${streamId}`);
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
    } catch(e) {
        const miniProg = document.getElementById(`prog-mini-${streamId}`);
        // Se a API falhar, mostra algo mais profissional que "Sem informação"
        if (miniProg) miniProg.textContent = "Programação Indisponível";
    }
};