self.addEventListener('install', (e) => {
    console.log('[Service Worker] Instalado com sucesso.');
});

self.addEventListener('fetch', (e) => {
    // Passthrough puro, sem cache — mas agora com tratamento de erro. Antes, qualquer
    // requisição que falhasse (uma imagem do TMDB fora do ar, extensão do navegador
    // bloqueando, rede instável) virava um "Uncaught TypeError: Failed to fetch" no
    // console PRA CADA falha, dando a falsa impressão de que era um bug do app — era
    // só o repasse sem rede de segurança nenhuma. O site continuava funcionando do
    // mesmo jeito (o erro nem afetava nada), só a poluição no console.
    e.respondWith(
        fetch(e.request).catch(() => new Response('', { status: 504, statusText: 'Falha de rede' }))
    );
});