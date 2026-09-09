// Este Service Worker foi desativado (ver app.js — agora ele se auto-remove do navegador).
// O código abaixo existe só como uma rede de segurança: se, por qualquer motivo, esta versão
// do arquivo ainda estiver ativa numa aba de alguém por um instante antes do desregistro
// automático acontecer, ele NÃO intercepta nada — sem chamar `respondWith`, o navegador trata
// cada requisição normalmente, exatamente como se não houvesse Service Worker no caminho.
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    self.clients.claim();
    // Também se autodestrói, pra sumir de vez do navegador de quem ainda estiver com ele.
    self.registration.unregister();
});