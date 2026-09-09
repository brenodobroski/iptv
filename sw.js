self.addEventListener('install', (e) => {
    console.log('[Service Worker] Instalado com sucesso.'); //[cite: 8]
});

self.addEventListener('fetch', (e) => {
    // Se a requisição for para um domínio externo (como o TMDB), ignora o Service Worker
    if (!e.request.url.startsWith(self.location.origin)) {
        return; 
    }

    // Permite que as requisições locais fluam normalmente[cite: 8]
    e.respondWith(fetch(e.request));
});