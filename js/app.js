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
        
    let searchUrl = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(nomeLimpo)}&language=pt-BR`;
    
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
            
            return {
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
    } catch (e) { console.error("Erro TMDB:", e); }
    return null;
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

async function carregarCatalogoCompleto() {
    document.getElementById('global-loader').style.display = 'flex';
    try {
        const [cLive, sLive, cVod, sVod, cSeries, sSeries] = await Promise.all([
            fetchAPI('get_live_categories'), fetchAPI('get_live_streams'),
            fetchAPI('get_vod_categories'), fetchAPI('get_vod_streams'),
            fetchAPI('get_series_categories'), fetchAPI('get_series')
        ]);
        
        cats.live = cLive; db.live = sLive;
        cats.vod = cVod; db.vod = sVod;
        cats.series = cSeries; db.series = sSeries;
        
        cLive.forEach(c => catMaps.live[c.category_id] = c.category_name);
        cVod.forEach(c => catMaps.vod[c.category_id] = c.category_name);
        cSeries.forEach(c => catMaps.series[c.category_id] = c.category_name);
        
        dataLoaded = true;
        document.getElementById('global-loader').style.display = 'none';
        
        // Chamadas para ui.js
        if(abaAtiva === 'home') renderizarHome();
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