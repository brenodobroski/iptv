if ('serviceWorker' in navigator) { 
    navigator.serviceWorker.register('./sw.js'); 
}

// Variáveis Globais de Estado
let credenciais = { host: '', user: '', pass: '' };
let abaAtiva = 'home';
let currentCatId = null;
let lastViewBeforePlayer = 'home';

let db = { live: [], vod: [], series: [] };
let cats = { live: [], vod: [], series: [] };
let catMaps = { live: {}, vod: {}, series: {} };
let dataLoaded = false;
let bannerInterval = null;
let mediaAtivaObj = null;

// Loaders do LocalStorage
let savedFavs = JSON.parse(localStorage.getItem('iptv_api_favs_v3'));
if (!savedFavs || Array.isArray(savedFavs) || !savedFavs.live) {
    savedFavs = { live: [], vod: [], series: [] };
}
let favoritos = savedFavs;

let historicoAssistidos = JSON.parse(localStorage.getItem('iptv_api_history')) || {};
let videoEmReproducao = null;

// Fallbacks de Imagem
const getFallbackSvg = (tipo) => `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='300'%3E%3Crect width='100%25' height='100%25' fill='%23121214'/%3E%3Ctext x='50%25' y='50%25' fill='%233f3f46' font-family='sans-serif' font-size='20' font-weight='bold' text-anchor='middle' dy='.3em'%3E${tipo}%3C/text%3E%3C/svg%3E`;
const imagensQuebradas = new Set();

window.marcarImagemQuebrada = function(imgElement, fallbackSvg) {
    const originalUrl = imgElement.getAttribute('data-original');
    if (originalUrl) imagensQuebradas.add(originalUrl);
    imgElement.onerror = null;
    imgElement.src = fallbackSvg;
};

// --- CACHE DO TMDB (evita refazer as mesmas 2 requisições toda vez que a Home/detalhes renderizam) ---
const TMDB_CACHE_KEY = 'iptv_tmdb_cache_v1';
const TMDB_CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 dias, dados do TMDB raramente mudam
let tmdbCache = {};
try { tmdbCache = JSON.parse(localStorage.getItem(TMDB_CACHE_KEY)) || {}; } catch (e) { tmdbCache = {}; }

function salvarTmdbCache() {
    try { localStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(tmdbCache)); } catch (e) { /* storage cheio, ignora */ }
}

// --- TMDB API INTEGRAÇÃO ---
async function buscarTMDB(nomeOriginal, tipo) {
    const apiKey = 'c5ec5dbd66ea50ce62b096dca322543c';
    const endpoint = tipo === 'series' ? 'tv' : 'movie';
    
    let nomeLimpo = nomeOriginal
        .replace(/\[.*?\]|\(.*?\)/g, '') 
        .split('-')[0] 
        .replace(/4K|FHD|HD|UHD|VOD|Dublado|Legendado|Dual|Audio/gi, '') 
        .trim();
        
    if(!nomeLimpo) return null;

    const cacheKey = `${endpoint}:${nomeLimpo.toLowerCase()}`;
    const cached = tmdbCache[cacheKey];
    if (cached && (Date.now() - cached.t) < TMDB_CACHE_TTL) {
        return cached.v; // pode ser null (já sabemos que não achou) — evita bater na API de novo
    }
        
    let searchUrl = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(nomeLimpo)}&language=pt-BR`;
    
    let resultado = null;
    try {
        const res = await fetch(searchUrl);
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            const result = data.results[0];
            let logoUrl = null;
            const imagesUrl = `https://api.themoviedb.org/3/${endpoint}/${result.id}/images?api_key=${apiKey}&include_image_language=pt,en,null`;
            const imgRes = await fetch(imagesUrl);
            const imgData = await imgRes.json();
            
            if (imgData.logos && imgData.logos.length > 0) {
                logoUrl = `https://image.tmdb.org/t/p/w500${imgData.logos[0].file_path}`;
            }
            
            resultado = {
                id: result.id,
                titulo: result.title || result.name,
                sinopse: result.overview,
                nota: result.vote_average ? result.vote_average.toFixed(1) : null,
                backdrop: result.backdrop_path ? `https://image.tmdb.org/t/p/original${result.backdrop_path}` : null,
                poster: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : null,
                logo: logoUrl,
                ano: result.release_date ? result.release_date.substring(0, 4) : (result.first_air_date ? result.first_air_date.substring(0, 4) : '')
            };
        }
    } catch (e) { console.error("Erro TMDB:", e); return null; /* erro de rede não vira cache */ }

    tmdbCache[cacheKey] = { v: resultado, t: Date.now() };
    salvarTmdbCache();
    return resultado;
}

// LÓGICA DE API DO SEU SERVIDOR / VERCEL
async function fetchAPI(action, params = '') {
    const targetUrl = `${credenciais.host}/player_api.php?username=${credenciais.user}&password=${credenciais.pass}&action=${action}${params}`;
    
    const VERCEL_PROD_URL = "https://breno-iptv.vercel.app"; 
    
    let proxyUrl = "";
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        proxyUrl = `http://localhost:8000/api/proxy?url=${encodeURIComponent(targetUrl)}`;
    } else {
        proxyUrl = `${VERCEL_PROD_URL}/api/proxy?url=${encodeURIComponent(targetUrl)}`;
    }
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error('Erro na rede');
    return await response.json();
}

// --- CACHE DO CATÁLOGO (stale-while-revalidate) ---
// Ideia: se já temos um catálogo salvo, mostramos ele NA HORA (0ms de espera) e
// atualizamos os dados em segundo plano. Só mostramos o loader gigante quando
// não existe nenhum cache ainda (primeiro login no aparelho).
const CATALOG_CACHE_KEY = 'iptv_catalog_cache_v1';
const CATALOG_CACHE_MAX_AGE = 1000 * 60 * 60 * 12; // depois de 12h o cache é descartado (não só atualizado)

function lerCacheCatalogo() {
    try {
        const raw = localStorage.getItem(CATALOG_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.timestamp || !parsed.db || !parsed.cats) return null;
        if (Date.now() - parsed.timestamp > CATALOG_CACHE_MAX_AGE) return null;
        // O cache é por usuário/host, pra não misturar contas diferentes no mesmo navegador
        if (parsed.host !== credenciais.host || parsed.user !== credenciais.user) return null;
        return parsed;
    } catch (e) { return null; }
}

function salvarCacheCatalogo() {
    try {
        localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            host: credenciais.host,
            user: credenciais.user,
            db, cats
        }));
    } catch (e) { /* catálogo muito grande pro localStorage, sem problema, só não cacheia */ }
}

function aplicarCatalogo(novoDb, novosCats) {
    db.live = novoDb.live; db.vod = novoDb.vod; db.series = novoDb.series;
    cats.live = novosCats.live; cats.vod = novosCats.vod; cats.series = novosCats.series;

    catMaps.live = {}; catMaps.vod = {}; catMaps.series = {};
    cats.live.forEach(c => catMaps.live[c.category_id] = c.category_name);
    cats.vod.forEach(c => catMaps.vod[c.category_id] = c.category_name);
    cats.series.forEach(c => catMaps.series[c.category_id] = c.category_name);

    dataLoaded = true;
}

function renderizarViewAtual() {
    if (abaAtiva === 'home') {
        renderizarHome();
    } else if (abaAtiva === 'live') {
        renderizarCategoriasLiveSidebar();
        renderizarGrade(db.live, 'live');
    } else {
        document.getElementById('category-bar').classList.remove('hidden');
        renderizarCategoriasLista(cats[abaAtiva]);
    }
}

async function baixarCatalogoDaRede() {
    const [cLive, sLive, cVod, sVod, cSeries, sSeries] = await Promise.all([
        fetchAPI('get_live_categories'), fetchAPI('get_live_streams'),
        fetchAPI('get_vod_categories'), fetchAPI('get_vod_streams'),
        fetchAPI('get_series_categories'), fetchAPI('get_series')
    ]);
    return {
        db: { live: sLive, vod: sVod, series: sSeries },
        cats: { live: cLive, vod: cVod, series: cSeries }
    };
}

async function carregarCatalogoCompleto() {
    const cache = lerCacheCatalogo();

    if (cache) {
        // 1) Mostra o cache imediatamente — usuário não espera nada
        aplicarCatalogo(cache.db, cache.cats);
        document.getElementById('global-loader').style.display = 'none';
        switchView(abaAtiva === 'home' ? 'home-view' : 'grid-view');
        renderizarViewAtual();

        // 2) Atualiza em segundo plano, sem travar a tela
        try {
            const fresh = await baixarCatalogoDaRede();
            aplicarCatalogo(fresh.db, fresh.cats);
            salvarCacheCatalogo();
            renderizarViewAtual(); // re-renderiza silenciosamente com dados atualizados
        } catch (err) {
            console.warn('Falha ao atualizar catálogo em segundo plano, mantendo cache:', err);
        }
        return;
    }

    // Sem cache (primeira vez no aparelho) — precisa mostrar o loader mesmo
    document.getElementById('global-loader').style.display = 'flex';
    try {
        const fresh = await baixarCatalogoDaRede();
        aplicarCatalogo(fresh.db, fresh.cats);
        salvarCacheCatalogo();

        document.getElementById('global-loader').style.display = 'none';
        if (abaAtiva === 'home') renderizarHome();
        else {
            document.getElementById('category-bar').classList.remove('hidden');
            renderizarCategoriasLista(cats[abaAtiva]);
            switchView('grid-view');
        }
    } catch (err) {
        document.getElementById('global-loader').style.display = 'none';
        alert("Falha ao baixar o catálogo. Verifique suas credenciais ou seu Proxy Vercel.");
        document.getElementById('login-screen').style.display = 'flex';
    }
}

// INICIALIZAÇÃO E LÓGICA DE LOGIN (DOM Event Listeners Base)
window.onload = () => {
    const loginScreen = document.getElementById('login-screen');
    const savedUser = localStorage.getItem('iptv_user');
    const savedDns = localStorage.getItem('iptv_dns');
    const savedPass = localStorage.getItem('iptv_pass');
    
    if (savedUser && savedDns && savedPass) {
        credenciais.host = savedDns;
        credenciais.user = savedUser;
        credenciais.pass = savedPass;
        loginScreen.style.display = 'none';
        carregarCatalogoCompleto();
    } else {
        loginScreen.style.display = 'flex';
    }
};

document.getElementById('btn-profile').addEventListener('click', () => {
    const profileModal = document.getElementById('profile-modal');
    document.getElementById('modal-profile-name').textContent = localStorage.getItem('iptv_profile') || 'Meu Perfil';
    document.getElementById('modal-profile-user').textContent = localStorage.getItem('iptv_user');
    profileModal.style.display = 'flex';
});

document.getElementById('btn-close-modal').addEventListener('click', () => { 
    document.getElementById('profile-modal').style.display = 'none'; 
});

document.getElementById('profile-modal').addEventListener('click', (e) => { 
    const profileModal = document.getElementById('profile-modal');
    if(e.target === profileModal) profileModal.style.display = 'none'; 
});

document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('iptv_user');
    localStorage.removeItem('iptv_pass');
    localStorage.removeItem('iptv_dns');
    localStorage.removeItem('iptv_profile');
    window.location.reload();
});

document.getElementById('btn-login').addEventListener('click', () => {
    const loginScreen = document.getElementById('login-screen');
    let dns = document.getElementById('login-dns').value.trim();
    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value.trim();
    const profile = document.getElementById('login-profile').value.trim() || 'Minha TV';

    if (!dns || !user || !pass) {
        alert("Por favor, preencha todos os campos obrigatórios (DNS, Usuário e Senha).");
        return;
    }

    if (!dns.startsWith('http')) dns = 'http://' + dns;
    if (dns.endsWith('/')) dns = dns.slice(0, -1);

    localStorage.setItem('iptv_profile', profile);
    localStorage.setItem('iptv_dns', dns);
    localStorage.setItem('iptv_user', user);
    localStorage.setItem('iptv_pass', pass);
    
    credenciais.host = dns;
    credenciais.user = user;
    credenciais.pass = pass;

    loginScreen.style.display = 'none';
    carregarCatalogoCompleto();
});