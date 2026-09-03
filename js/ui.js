function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// ================== FIX DO HEADER SOMENDO NO SCROLL ==================
// O header é feito pra ficar "transparente" lá no topo (pra combinar com o hero da Home) e
// ficar sólido conforme rola a página — só que não existia nenhum listener de scroll pra isso
// no código, então ele ficava sempre transparente e o conteúdo passava "por cima" visualmente.
// Aqui garantimos: 1) o header fica fixo no topo (não sai da tela), 2) ganha fundo sólido +
// leve blur assim que a página rola, com transição suave.
(function corrigirHeaderFixo() {
    const header = document.getElementById('top-nav');
    if (!header) return;

    // Garante que o header realmente fica fixo, mesmo que o CSS original não tenha isso 100% certo
    const posicaoAtual = getComputedStyle(header).position;
    if (posicaoAtual !== 'fixed' && posicaoAtual !== 'sticky') {
        header.style.position = 'fixed';
        header.style.top = '0';
        header.style.left = '0';
        header.style.right = '0';
    }
    header.style.zIndex = header.style.zIndex || '1000';
    header.style.transition = 'background-color 0.25s ease, backdrop-filter 0.25s ease, box-shadow 0.25s ease';

    function aplicarEstadoScroll() {
        // #main-area é onde o conteúdo realmente rola nesse layout; caímos pro window como fallback
        const mainArea = document.getElementById('main-area');
        const scrollY = (mainArea && mainArea.scrollHeight > mainArea.clientHeight) ? mainArea.scrollTop : window.scrollY;
        const rolou = scrollY > 40;

        header.classList.toggle('scrolled', rolou);
        header.style.backgroundColor = rolou ? 'rgba(10,10,12,0.92)' : 'transparent';
        header.style.backdropFilter = rolou ? 'blur(14px)' : 'none';
        header.style.boxShadow = rolou ? '0 2px 12px rgba(0,0,0,0.4)' : 'none';
    }

    aplicarEstadoScroll();
    window.addEventListener('scroll', aplicarEstadoScroll, { passive: true });
    document.getElementById('main-area')?.addEventListener('scroll', aplicarEstadoScroll, { passive: true });
    // A troca de aba muda o container ativo — reavalia o estado logo depois
    document.querySelectorAll('.nav-link').forEach(btn => btn.addEventListener('click', () => setTimeout(aplicarEstadoScroll, 50)));
})();

// Navegação Principal e Tabs
document.getElementById('btn-search').addEventListener('click', () => {
    const searchWrapper = document.getElementById('search-wrapper');
    const searchBox = document.getElementById('search-box');
    
    // Alterna entre mostrar e esconder a barra de pesquisa
    if (searchWrapper.classList.contains('active')) {
        searchWrapper.classList.remove('active');
        searchBox.value = ''; // Limpa a busca ao fechar
        // Se a busca estava filtrando algo, dispara o evento para resetar a grade
        searchBox.dispatchEvent(new Event('input')); 
    } else {
        searchWrapper.classList.add('active');
        // Corrige o bug de class (de .tab-btn para .nav-link)
        if (abaAtiva === 'home') document.querySelector('.nav-link[data-tab="vod"]').click();
        searchBox.focus();
    }
});

document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
        forcarFechamentoPlayer();
        document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        abaAtiva = e.currentTarget.getAttribute('data-tab');
        
        // Agora o input existe e não dará erro de null na linha 18
        document.getElementById('search-box').value = '';
        document.getElementById('grid-header').style.display = 'none';
        currentCatId = null;

        if (abaAtiva === 'home') {
            document.getElementById('category-bar').classList.add('hidden');
            document.getElementById('search-wrapper').classList.remove('active');
            if (dataLoaded) renderizarHome();
            switchView('home-view');
        } else if (abaAtiva === 'live') {
            // Quando clica em Ao Vivo:
            document.getElementById('category-bar').classList.add('hidden');
            if (dataLoaded) {
                renderizarCategoriasLiveSidebar(); // Gera o sidebar
                renderizarGrade(db.live, 'live'); // Mostra todos os canais por padrão
                switchView('grid-view');
            }
        } else {
            // Quando clica em Filmes ou Séries:
            document.getElementById('category-bar').classList.remove('hidden');
            if (dataLoaded) {
                renderizarCategoriasLista(cats[abaAtiva]);
                switchView('grid-view');
            }
        }
    });
});

// Busca/Pesquisa UI
document.getElementById('search-box').addEventListener('input', (e) => {
    const termo = e.target.value.toLowerCase();
    const gridHeader = document.getElementById('grid-header');
    if (termo === '') {
        gridHeader.style.display = 'none';
        const activeLi = document.querySelector(`#category-list li.active`);
        if (activeLi) activeLi.click(); 
    } else {
        document.querySelectorAll('#category-list li').forEach(el => el.classList.remove('active'));
        gridHeader.style.display = 'block'; gridHeader.textContent = `Resultados para "${termo}"`;
        renderizarGrade(db[abaAtiva].filter(item => item.name.toLowerCase().includes(termo)), abaAtiva, false);
    }
});

function setupBanners() {
    const sliderContainer = document.getElementById('hero-slider');
    sliderContainer.innerHTML = '';
    
    let lancamentoCat = cats.vod.find(c => c.category_name.toLowerCase().includes('lançamento') || c.category_name.toLowerCase().includes('novo'));
    let bannerStreams = lancamentoCat ? db.vod.filter(s => s.category_id == lancamentoCat.category_id).slice(0, 5) : db.vod.slice(0, 5);
    
    if(bannerStreams.length === 0) return;

    const dotsContainer = document.createElement('div');
    dotsContainer.className = 'slider-controls';
    
    bannerStreams.forEach((item, index) => {
        const slideId = `hero-slide-${item.stream_id || index}`;
        const slide = document.createElement('div');
        slide.className = `hero-slide ${index === 0 ? 'active' : ''}`;
        slide.id = slideId;
        
        const cover = item.cover || item.stream_icon || getFallbackSvg('Mídia');
        
        // Removemos a sinopse para ficar super limpo e focamos no título gigante e metadados
        slide.innerHTML = `
            <div class="hero-bg" style="background-image: url('${cover}');"></div>
            <div class="hero-overlay-gradient"></div>
            <div class="hero-content">
                <div class="hero-title-container">
                    <h1 class="hero-title" style="color: #ff5500;">${item.name}</h1> </div>
                
                <div class="hero-meta-row">
                    <span class="hero-meta-badge tmdb-nota-badge" style="display:none; background: transparent; border: none;"><span class="tmdb-icon">★</span> <span class="tmdb-nota-valor"></span></span>
                    <span class="hero-meta-badge tmdb-year-badge" style="display:none; background: transparent; border: none;"></span>
                    <span class="hero-meta-badge" style="background: transparent; border: none;">${catMaps.vod[item.category_id] || "Filme"}</span>
                </div>
            </div>
        `;
        slide.onclick = () => abrirDetalhesMedia(item.stream_id, 'vod');
        sliderContainer.appendChild(slide);
        
        const dot = document.createElement('div');
        dot.className = `dot ${index === 0 ? 'active' : ''}`;
        dotsContainer.appendChild(dot);
        
        buscarTMDB(item.name, 'vod').then(tmdb => {
            if(tmdb) {
                const el = document.getElementById(slideId);
                if(!el) return;
                
                if(tmdb.backdrop) {
                    el.querySelector('.hero-bg').style.backgroundImage = `url('${tmdb.backdrop}')`;
                }
                
                if(tmdb.logo) {
                    el.querySelector('.hero-title-container').innerHTML = `<img src="${tmdb.logo}" class="hero-logo" alt="${tmdb.titulo}">`;
                } else {
                    el.querySelector('.hero-title').textContent = tmdb.titulo;
                }
                
                if(tmdb.nota) {
                    el.querySelector('.tmdb-nota-badge').style.display = 'flex';
                    el.querySelector('.tmdb-nota-valor').textContent = tmdb.nota;
                }
                if(tmdb.ano) {
                    el.querySelector('.tmdb-year-badge').style.display = 'flex';
                    el.querySelector('.tmdb-year-badge').textContent = tmdb.ano;
                }
            }
        });
    });
    sliderContainer.appendChild(dotsContainer);
    
    let currentIdx = 0;
    if(bannerInterval) clearInterval(bannerInterval);
    bannerInterval = setInterval(() => {
        const slides = sliderContainer.querySelectorAll('.hero-slide');
        const dots = sliderContainer.querySelectorAll('.dot');
        if(slides.length === 0) return;
        slides[currentIdx].classList.remove('active');
        dots[currentIdx].classList.remove('active');
        currentIdx = (currentIdx + 1) % slides.length;
        slides[currentIdx].classList.add('active');
        dots[currentIdx].classList.add('active');
    }, 8000);
}

function renderizarHome() {
    setupBanners();
    const homeContent = document.getElementById('home-content');
    homeContent.innerHTML = '<div class="home-content-wrapper"></div>';
    const wrapper = homeContent.querySelector('.home-content-wrapper');
    
    let lancamentoCat = cats.vod.find(c => c.category_name.toLowerCase().includes('lançamento') || c.category_name.toLowerCase().includes('novo'));
    let lancamentos = lancamentoCat ? db.vod.filter(s => s.category_id == lancamentoCat.category_id).slice(0, 10) : db.vod.slice(0, 10);
    if (lancamentos.length > 0) criarFileira(wrapper, 'Top Lançamentos da Semana', lancamentos, 'vod', false, false, true); 
    
    const favCanais = db.live.filter(s => favoritos.live.includes(s.stream_id));
    if (favCanais.length > 0) criarFileira(wrapper, 'Seus Canais Favoritos', favCanais, 'live', false, false, false); 
    
    const histFilmes = Object.values(historicoAssistidos).filter(i => i.aba === 'vod').sort((a,b) => b.timestamp - a.timestamp);
    if (histFilmes.length > 0) criarFileira(wrapper, 'Continuar Assistindo (Filmes)', histFilmes, 'vod', false, true, false); 
    
    const histSeries = Object.values(historicoAssistidos).filter(i => i.aba === 'series').sort((a,b) => b.timestamp - a.timestamp);
    if (histSeries.length > 0) criarFileira(wrapper, 'Continuar Assistindo (Séries)', histSeries, 'series', false, true, false); 
}

function criarFileira(container, titulo, itens, tipoAba, isEvent = false, isHistory = false, isNumbered = false) {
    const rowWrapper = document.createElement('div');
    rowWrapper.className = 'home-row';
    
    // Novo cabeçalho de fileira idêntico ao da imagem (com botão do lado direito)
    rowWrapper.innerHTML = `
        <div class="home-row-header">
            <h3>${titulo}</h3>
            <span class="see-all">Ver todos</span>
        </div>
        <div class="scroller-container">
            <button class="scroll-btn left-btn hidden-btn">
                <svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>
            </button>
            <div class="row-scroller ${isNumbered ? 'numbered-scroller' : ''}"></div>
            <button class="scroll-btn right-btn hidden-btn">
                <svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
            </button>
        </div>
    `;
    
    // ... O restante da função criarFileira permanece EXATAMENTE igual (scroller, btnLeft, btnRight, forEach...)
    const scroller = rowWrapper.querySelector('.row-scroller');
    const btnLeft = rowWrapper.querySelector('.left-btn');
    const btnRight = rowWrapper.querySelector('.right-btn');
    
    btnLeft.onclick = () => { scroller.scrollBy({ left: -600, behavior: 'smooth' }); };
    btnRight.onclick = () => { scroller.scrollBy({ left: 600, behavior: 'smooth' }); };
    
    itens.slice(0, 20).forEach((item, index) => {
        const card = gerarHTMLCard(item, tipoAba, isEvent, isHistory);
        card.addEventListener('click', () => {
            if (isHistory) abrirPlayer(item.url, item);
            else if (tipoAba === 'live') {
                document.querySelector('.nav-link[data-tab="live"]').click();
                setTimeout(() => {
                    const canalRow = document.querySelector(`.live-channel-row[data-id="${item.stream_id}"]`);
                    if(canalRow) canalRow.click();
                }, 300);
            } else {
                const id = tipoAba === 'series' ? item.series_id : item.stream_id;
                abrirDetalhesMedia(id, tipoAba);
            }
        });
        
        if (isNumbered) {
            const numberWrap = document.createElement('div');
            numberWrap.className = 'numbered-item';
            numberWrap.innerHTML = `<div class="huge-number">${index + 1}</div>`;
            numberWrap.appendChild(card);
            scroller.appendChild(numberWrap);
        } else scroller.appendChild(card);
    });
    container.appendChild(rowWrapper);

    const updateArrows = () => {
        if (scroller.scrollWidth <= scroller.clientWidth) {
            btnLeft.classList.add('hidden-btn');
            btnRight.classList.add('hidden-btn');
        } else {
            if (scroller.scrollLeft <= 10) btnLeft.classList.add('hidden-btn');
            else btnLeft.classList.remove('hidden-btn');
            
            if (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 10) btnRight.classList.add('hidden-btn');
            else btnRight.classList.remove('hidden-btn');
        }
    };

    setTimeout(updateArrows, 150);
    scroller.addEventListener('scroll', updateArrows);
    window.addEventListener('resize', updateArrows);
}

function updateFavBadge(tipoAbaAtualizado) {
    if (abaAtiva === tipoAbaAtualizado && abaAtiva !== 'home') {
        const favBadge = document.querySelector('.cat-fav .badge-count');
        if (favBadge) favBadge.textContent = favoritos[tipoAbaAtualizado].length;
    }
}

function renderizarCategoriasLista(categorias) {
    const listUI = document.getElementById('category-list');
    listUI.innerHTML = '';
    let htmlList = '';
    const historicoDaAba = abaAtiva !== 'live' ? Object.values(historicoAssistidos).filter(item => item.aba === abaAtiva) : [];
    
    if (abaAtiva !== 'live' && historicoDaAba.length > 0) {
        htmlList += `<li class="cat-history" data-id="history" style="color:var(--history-color)">Continuar Assistindo <span class="badge-count">${historicoDaAba.length}</span></li>`;
    }
    
    const contagemFavAtual = favoritos[abaAtiva] ? favoritos[abaAtiva].length : 0;
    htmlList += `<li class="cat-fav" data-id="fav" style="color:var(--star-active)">Favoritos <span class="badge-count">${contagemFavAtual}</span></li>`;
    
    categorias.forEach(cat => { 
        htmlList += `<li data-id="${cat.category_id}">${cat.category_name}</li>`; 
    });
    
    listUI.innerHTML = htmlList;
    
    const items = listUI.querySelectorAll('li');
    items.forEach(li => {
        li.addEventListener('click', () => {
            forcarFechamentoPlayer();
            items.forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            
            const id = li.getAttribute('data-id');
            document.getElementById('search-box').value = ''; 
            document.getElementById('grid-header').style.display = 'none';
            switchView('grid-view');
            
            if (id === 'history') { currentCatId = 'history'; renderizarGrade(historicoDaAba.sort((a, b) => b.timestamp - a.timestamp), abaAtiva, false, true); } 
            else if (id === 'fav') { currentCatId = 'fav'; renderizarGrade(db[abaAtiva].filter(item => favoritos[abaAtiva].includes(item.stream_id || item.series_id)), abaAtiva, false); } 
            else { currentCatId = id; renderizarGrade(db[abaAtiva].filter(item => String(item.category_id) === String(id)), abaAtiva, false); }
        });
    });
    
    const catParaRestaurar = listUI.querySelector(`li[data-id="${currentCatId}"]`) || listUI.querySelector(`li:nth-child(3)`);
    if (catParaRestaurar) catParaRestaurar.click();
}

function toggleFav(event, id, tipoAba) {
    event.stopPropagation();
    const btn = event.currentTarget;
    
    if (favoritos[tipoAba].includes(id)) {
        favoritos[tipoAba] = favoritos[tipoAba].filter(f => f !== id);
        btn.classList.remove('is-fav');
    } else {
        favoritos[tipoAba].push(id);
        btn.classList.add('is-fav');
    }
    localStorage.setItem('iptv_api_favs_v3', JSON.stringify(favoritos));
    
    updateFavBadge(tipoAba);

    if (abaAtiva === 'home') {
        renderizarHome(); 
    } else if (currentCatId === 'fav' && abaAtiva === tipoAba) {
        const element = document.querySelector(`[data-id="${id}"]`) || btn.closest('.media-card, .live-channel-row');
        if (element && !favoritos[tipoAba].includes(id)) {
            element.remove();
        }
    }
}

function toggleFavoritoMediaDetail() {
    if(!mediaAtivaObj) return;
    const id = mediaAtivaObj.id; 
    const tipoAba = mediaAtivaObj.tipo;
    
    if (favoritos[tipoAba].includes(id)) favoritos[tipoAba] = favoritos[tipoAba].filter(f => f !== id);
    else favoritos[tipoAba].push(id);
    
    localStorage.setItem('iptv_api_favs_v3', JSON.stringify(favoritos));
    atualizarBotaoFavDetail();
    
    updateFavBadge(tipoAba);

    if (abaAtiva !== 'home') {
        if (currentCatId === 'fav' && abaAtiva === tipoAba) {
            const favStreams = db[abaAtiva].filter(item => favoritos[abaAtiva].includes(item.stream_id || item.series_id));
            renderizarGrade(favStreams, abaAtiva, false);
        }
    }
}

function atualizarBotaoFavDetail() {
    const btn = document.getElementById('btn-fav-main');
    const isFav = favoritos[mediaAtivaObj.tipo].includes(mediaAtivaObj.id);
    
    if(isFav) {
        btn.classList.add('is-fav');
        btn.setAttribute('title', 'Remover dos Favoritos');
    } else {
        btn.classList.remove('is-fav');
        btn.setAttribute('title', 'Adicionar aos Favoritos');
    }
}

function gerarHTMLCard(item, tipoAba, isEventLayout, isHistoryView) {
    const id = item.stream_id || item.series_id || item.id; 
    const nome = item.name;
    const logo = item.stream_icon || item.cover || item.logo;
    const fallbackImg = tipoAba === 'live' ? getFallbackSvg('TV') : getFallbackSvg('Poster');
    const srcFinal = (logo && !imagensQuebradas.has(logo)) ? logo : fallbackImg;
    const isFav = favoritos[tipoAba] && favoritos[tipoAba].includes(id);
    
    const card = document.createElement('div');
    card.setAttribute('data-id', id);
    
    let extraClass = '';
    if (tipoAba === 'live') extraClass = 'is-live';
    else if (isHistoryView) extraClass = 'is-16x9';
    
    card.className = `media-card ${extraClass}`;
    
    let progressBar = '';
    if (isHistoryView && item.percent) {
        progressBar = `<div class="progress-bar-bg"><div class="progress-bar-fill" style="width: ${item.percent * 100}%"></div></div>`;
    }
    
    card.innerHTML = `
        <div class="img-container">
            <button class="btn-fav ${isFav ? 'is-fav' : ''}" onclick="toggleFav(event, ${id}, '${tipoAba}')">
                <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
            </button>
            <img src="${srcFinal}" data-original="${logo}" onerror="marcarImagemQuebrada(this, '${fallbackImg}')" loading="lazy">
            ${progressBar}
        </div>
        <div class="card-info">
            <span class="card-title" title="${nome}">${nome}</span>
        </div>
    `;
    return card;
}

function criarLinhaCanal(item) {
    const id = item.stream_id || item.id;
    const srcFinal = (item.stream_icon && !imagensQuebradas.has(item.stream_icon)) ? item.stream_icon : getFallbackSvg('TV');
    const isFav = favoritos.live && favoritos.live.includes(id);

    const row = document.createElement('div');
    row.className = 'live-channel-row';
    row.setAttribute('data-id', id);

    // Algumas APIs mandam o EPG já embutido. Se tiver, usamos logo, senão "Carregando..."
    const epgInicial = item.epg_title ? window.decodeBase64EPG(item.epg_title) : 'Carregando...';

    row.innerHTML = `
        <img src="${srcFinal}" onerror="marcarImagemQuebrada(this, '${getFallbackSvg('TV')}')" loading="lazy">
        <div class="live-channel-info">
            <div class="live-channel-name">${item.name}</div>
            <div class="live-channel-prog" id="prog-mini-${id}">${epgInicial}</div>
        </div>
        <button class="btn-fav-live ${isFav ? 'is-fav' : ''}" onclick="toggleFav(event, ${id}, 'live')">
            <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        </button>
    `;

    row.addEventListener('click', () => {
        document.querySelectorAll('.live-channel-row').forEach(el => el.classList.remove('selected'));
        row.classList.add('selected');
        const playUrl = `${credenciais.host}/live/${credenciais.user}/${credenciais.pass}/${id}.${item.container_extension || 'm3u8'}`;
        livePlayer.src({ src: playUrl.replace('.ts', '.m3u8'), type: 'application/x-mpegURL' });
        livePlayer.play().catch(e => console.error(e));

        if (typeof carregarEPGCanal === "function") carregarEPGCanal(id);
    });

    return row;
}

function renderizarGrade(dados, tipoAba, isEventLayout = false, isHistoryView = false) {
    const gridUI = document.getElementById('media-grid');
    const liveContainer = document.getElementById('live-layout-container');
    const liveListUI = document.getElementById('live-channels-list');
    
    gridUI.innerHTML = ''; liveListUI.innerHTML = '';

    // Cancela qualquer carregamento incremental de uma renderização anterior
    if (window.liveLoadMoreObserver) window.liveLoadMoreObserver.disconnect();
    
    if (tipoAba === 'live') {
        gridUI.style.display = 'none';
        liveContainer.style.display = 'flex';
        if(dados.length === 0) { liveListUI.innerHTML = '<div style="padding: 20px; color: var(--text-muted);">Nenhum canal encontrado.</div>'; return; }
        
        // OBSERVADOR INTELIGENTE: Só carrega o EPG dos canais que estão aparecendo na tela
        if (window.epgObserver) window.epgObserver.disconnect();
        window.epgObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('data-id');
                    const progMini = document.getElementById(`prog-mini-${id}`);
                    // Se estiver com o texto padrão, ele busca silenciosamente
                    if (progMini && progMini.textContent === 'Carregando...') {
                        if(typeof window.buscarEPGSilencioso === 'function') {
                            window.buscarEPGSilencioso(id);
                        }
                    }
                }
            });
        }, { root: liveListUI, rootMargin: '50px' });

        // RENDERIZAÇÃO EM LOTES: listas de canais ao vivo podem ter milhares de itens.
        // Criar todos os elementos de uma vez trava a tela por vários segundos. Em vez disso,
        // renderizamos só o primeiro lote e vamos completando conforme o usuário rola a lista.
        const LOTE = 80;
        let indice = 0;
        const sentinela = document.createElement('div');
        sentinela.style.cssText = 'height:1px;';

        function renderizarLote() {
            const fim = Math.min(indice + LOTE, dados.length);
            const frag = document.createDocumentFragment();
            for (let i = indice; i < fim; i++) {
                const row = criarLinhaCanal(dados[i]);
                frag.appendChild(row);
                window.epgObserver.observe(row);
            }
            liveListUI.appendChild(frag);
            indice = fim;

            if (indice < dados.length) {
                liveListUI.appendChild(sentinela);
                loadMoreObserver.observe(sentinela);
            }
        }

        const loadMoreObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                loadMoreObserver.unobserve(sentinela);
                renderizarLote();
            }
        }, { root: liveListUI, rootMargin: '400px' });
        window.liveLoadMoreObserver = loadMoreObserver;

        renderizarLote();
    } else {
        liveContainer.style.display = 'none';
        gridUI.style.display = 'grid';
        const frag = document.createDocumentFragment();
        dados.slice(0, 500).forEach(item => {
            const card = gerarHTMLCard(item, tipoAba, false, isHistoryView);
            card.addEventListener('click', () => {
                if (isHistoryView) abrirPlayer(item.url, item);
                else abrirDetalhesMedia(item.stream_id || item.series_id || item.id, tipoAba);
            });
            frag.appendChild(card);
        });
        gridUI.appendChild(frag);
    }
}

/* DETALHES DE MÍDIA COM INTEGRAÇÃO TMDB & NOVO LAYOUT DE SÉRIES */
async function abrirDetalhesMedia(id, tipo) {
    document.getElementById('global-loader').style.display = 'flex';
    
    try {
        const action = tipo === 'series' ? 'get_series_info' : 'get_vod_info';
        const data = await fetchAPI(action, tipo === 'series' ? `&series_id=${id}` : `&vod_id=${id}`);
        const info = data.info;
        mediaAtivaObj = { id: id, tipo: tipo, info: info };
        
        let imgPoster = info.movie_image || info.cover || getFallbackSvg('Mídia');
        document.getElementById('md-poster').src = imgPoster;
        document.getElementById('md-blur').style.backgroundImage = `url('${imgPoster}')`;
        
        document.getElementById('md-title-container').innerHTML = `<h1 class="md-title" id="md-title">${info.name}</h1>`;
        document.getElementById('md-summary').textContent = info.plot || 'Buscando sinopse...';
        document.getElementById('md-rating').textContent = info.rating ? `${info.rating}★` : '';
        document.getElementById('md-date').textContent = info.releaseDate ? `• ${info.releaseDate}` : '';
        document.getElementById('md-cast').textContent = info.cast ? `• Elenco: ${info.cast}` : '';
        
        atualizarBotaoFavDetail();
        
        const btnPlayMain = document.getElementById('btn-play-main');
        const epSection = document.getElementById('md-episodes-section');
        
        if (tipo === 'vod') {
            epSection.style.display = 'none';
            const playUrl = `${credenciais.host}/movie/${credenciais.user}/${credenciais.pass}/${id}.${data.movie_data.container_extension || 'mp4'}`;
            btnPlayMain.innerHTML = historicoAssistidos[id] ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right:5px;"><path d="M8 5v14l11-7z"/></svg> Continuar Assistindo` : `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right:5px;"><path d="M8 5v14l11-7z"/></svg> Assistir Agora`;
            btnPlayMain.onclick = () => abrirPlayer(playUrl, { id: id, name: info.name, url: playUrl, aba: 'vod' });
        } else if (tipo === 'series') {
            epSection.style.display = 'block';
            
            const seasonsSidebar = document.getElementById('seasons-sidebar');
            const listUI = document.getElementById('md-episodes');
            const temporadas = Object.keys(data.episodes);
            
            seasonsSidebar.innerHTML = '';
            listUI.innerHTML = '';

            if (temporadas.length === 0) {
                seasonsSidebar.style.display = 'none';
                listUI.innerHTML = '<div style="color:var(--text-muted);">Nenhum episódio encontrado.</div>';
            } else {
                seasonsSidebar.style.display = 'flex';
                
                function renderEpisodios(tNum) {
                    listUI.innerHTML = '';
                    data.episodes[tNum].forEach((ep, index) => {
                        const epPlayUrl = `${credenciais.host}/series/${credenciais.user}/${credenciais.pass}/${ep.id}.${ep.container_extension}`;
                        const epItem = document.createElement('div');
                        epItem.className = 'episode-row-card'; 
                        
                        const plot = ep.info && ep.info.plot ? ep.info.plot : (ep.info && ep.info.overview ? ep.info.overview : 'Sinopse não disponível para este episódio.');
                        const duration = ep.info && ep.info.duration ? ` • ${ep.info.duration}` : '';
                        
                        epItem.innerHTML = `
                            <div class="ep-row-img">
                                <img src="${ep.info.movie_image || imgPoster}" loading="lazy" onerror="this.src='${getFallbackSvg('Episódio')}';">
                                <div class="ep-play-overlay">
                                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                </div>
                            </div>
                            <div class="ep-row-info">
                                <div class="ep-row-title">${index + 1}. ${ep.title}</div>
                                <div style="color: var(--accent); font-size: 12px; font-weight: bold; margin-bottom: 8px;">T${tNum} : E${ep.episode_num}${duration}</div>
                                <div class="ep-row-desc">${plot}</div>
                            </div>
                        `;
                        epItem.onclick = () => abrirPlayer(epPlayUrl, { id: ep.id, name: ep.title, url: epPlayUrl, aba: 'series' });
                        listUI.appendChild(epItem);
                    });
                }

                temporadas.forEach(tNum => {
                    const btn = document.createElement('button');
                    btn.className = 'season-btn';
                    btn.textContent = `Temporada ${tNum}`;
                    btn.onclick = () => {
                        seasonsSidebar.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        renderEpisodios(tNum);
                    };
                    seasonsSidebar.appendChild(btn);
                });
                
                seasonsSidebar.firstChild.classList.add('active');
                renderEpisodios(temporadas[0]);
                
                btnPlayMain.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right:5px;"><path d="M8 5v14l11-7z"/></svg> Assistir Episódio 1`;
                btnPlayMain.onclick = () => abrirPlayer(`${credenciais.host}/series/${credenciais.user}/${credenciais.pass}/${data.episodes[temporadas[0]][0].id}.${data.episodes[temporadas[0]][0].container_extension}`, {id: data.episodes[temporadas[0]][0].id, aba: 'series'});
            }
        }
        
        document.getElementById('global-loader').style.display = 'none';
        lastViewBeforePlayer = document.querySelector('.view-section.active').id;
        switchView('media-detail');

        buscarTMDB(info.name, tipo).then(tmdb => {
            if(tmdb) {
                if(tmdb.poster) document.getElementById('md-poster').src = tmdb.poster;
                if(tmdb.backdrop) document.getElementById('md-blur').style.backgroundImage = `url('${tmdb.backdrop}')`;
                
                const titleContainer = document.getElementById('md-title-container');
                if(tmdb.logo) titleContainer.innerHTML = `<img src="${tmdb.logo}" class="md-logo" alt="${tmdb.titulo}">`;
                else titleContainer.innerHTML = `<h1 class="md-title">${tmdb.titulo}</h1>`;
                
                if(tmdb.sinopse) document.getElementById('md-summary').textContent = tmdb.sinopse;
                if(tmdb.nota) document.getElementById('md-rating').textContent = `${tmdb.nota}★ TMDB`;
                if(tmdb.ano) document.getElementById('md-date').textContent = `• ${tmdb.ano}`;
            }
        });
        
    } catch (err) { 
        document.getElementById('global-loader').style.display = 'none'; 
        alert("Erro ao carregar detalhes da mídia."); 
    }
}

window.fecharDetalhesMedia = function() {
    mediaAtivaObj = null;
    if (abaAtiva === 'home') switchView('home-view'); else switchView('grid-view');
}

// ================== LOGICA DO SIDEBAR DE TV AO VIVO ==================

// Botão que abre a sidebar de categorias
const btnToggleLiveCats = document.getElementById('btn-toggle-live-cats');
if(btnToggleLiveCats) {
    btnToggleLiveCats.addEventListener('click', () => {
        document.getElementById('live-category-sidebar').classList.add('open');
    });
}

// Fecha a sidebar se clicar fora dela
document.getElementById('live-layout-container').addEventListener('click', (e) => {
    const sidebar = document.getElementById('live-category-sidebar');
    const btn = document.getElementById('btn-toggle-live-cats');
    if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && !btn.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// Renderiza as categorias na nova Sidebar
function renderizarCategoriasLiveSidebar() {
    const listUI = document.getElementById('live-category-list');
    if(!listUI) return;
    
    listUI.innerHTML = '';
    let htmlList = `<li data-id="all" class="${!currentCatId || currentCatId === 'all' ? 'active' : ''}">
        <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg> Todos
    </li>`;
    htmlList += `<li data-id="fav" style="color:var(--star-active)" class="${currentCatId === 'fav' ? 'active' : ''}">
        <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg> Favoritos
    </li>`;

    cats.live.forEach(cat => {
        const isActive = String(cat.category_id) === String(currentCatId) ? 'active' : '';
        // Ícone genérico de pasta para as categorias
        htmlList += `<li data-id="${cat.category_id}" class="${isActive}">
            <svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            ${cat.category_name}
        </li>`;
    });
    
    listUI.innerHTML = htmlList;

    const items = listUI.querySelectorAll('li');
    items.forEach(li => {
        li.addEventListener('click', () => {
            items.forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            
            currentCatId = li.getAttribute('data-id');
            let filtrados = db.live;
            
            if (currentCatId === 'fav') filtrados = db.live.filter(item => favoritos.live.includes(item.stream_id));
            else if (currentCatId !== 'all') filtrados = db.live.filter(item => String(item.category_id) === String(currentCatId));
            
            renderizarGrade(filtrados, 'live');
            
            // Fecha a sidebar ao escolher a categoria
            document.getElementById('live-category-sidebar').classList.remove('open');
        });
    });
}

// Busca interna do Sidebar (Filtra canais)
const liveSearchBox = document.getElementById('live-search-box');
if(liveSearchBox) {
    liveSearchBox.addEventListener('input', (e) => {
        const termo = e.target.value.toLowerCase();
        let filtrados = db.live;
        if(currentCatId === 'fav') filtrados = filtrados.filter(item => favoritos.live.includes(item.stream_id));
        else if(currentCatId && currentCatId !== 'all') filtrados = filtrados.filter(item => String(item.category_id) === String(currentCatId));
        
        renderizarGrade(filtrados.filter(item => item.name.toLowerCase().includes(termo)), 'live');
    });
}