self.addEventListener('install', (e) => {
    console.log('[Service Worker] Instalado com sucesso.');
});

self.addEventListener('fetch', (e) => {
    // Permite que as requisições fluam normalmente sem cache forçado
    e.respondWith(fetch(e.request));
});