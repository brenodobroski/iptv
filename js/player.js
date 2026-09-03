// Instanciando os players (depende do VideoJS já ter sido carregado no HTML)
const player = videojs('my-video');
const livePlayer = videojs('live-mini-video');

function forcarFechamentoPlayer() {
    if (document.getElementById('player-wrapper').style.display === 'flex') {
        player.pause();
        document.getElementById('player-wrapper').style.display = 'none';
        videoEmReproducao = null;
    }
    if (livePlayer) livePlayer.pause();
}

function abrirPlayer(url, metadados = null) {
    if (!url) return;
    videoEmReproducao = metadados; 
    lastViewBeforePlayer = document.querySelector('.view-section.active').id;
    const wrapper = document.getElementById('player-wrapper');
    wrapper.style.display = 'flex';
    
    let urlCorrigida = url.toLowerCase().includes('.ts') && !url.toLowerCase().includes('/movie/') && !url.toLowerCase().includes('/series/') ? url.replace('.ts', '.m3u8') : url;
    
    player.src({ src: urlCorrigida, type: urlCorrigida.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4' });
    
    player.ready(() => { 
        if (videoEmReproducao && historicoAssistidos[videoEmReproducao.id]) {
            player.currentTime(historicoAssistidos[videoEmReproducao.id].currentTime); 
        }
    });
    
    player.play().catch(e => console.error(e));
}

// Salva o histórico (Continuar assistindo)
player.on('timeupdate', () => {
    if (!videoEmReproducao || videoEmReproducao.aba === 'live') return;
    
    const currentTime = player.currentTime(); 
    const duration = player.duration();
    
    if (duration && currentTime > 5) {
        const percent = currentTime / duration;
        if (percent > 0.95) {
            delete historicoAssistidos[videoEmReproducao.id];
        } else {
            historicoAssistidos[videoEmReproducao.id] = { 
                ...videoEmReproducao, 
                currentTime: currentTime, 
                duration: duration, 
                percent: percent, 
                timestamp: Date.now() 
            };
        }
        localStorage.setItem('iptv_api_history', JSON.stringify(historicoAssistidos));
    }
});

document.getElementById('btn-fechar-player').addEventListener('click', () => {
    player.pause(); 
    document.getElementById('player-wrapper').style.display = 'none'; 
    videoEmReproducao = null;
    
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