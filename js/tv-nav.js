// ================== NAVEGAÇÃO POR CONTROLE REMOTO (SMART TV) ==================
//
// O app inteiro foi construído pensando em clique de mouse/toque: os "cards" de
// filme/série, as linhas de canal, os itens de categoria etc. são <div>/<li> sem
// tabindex, e não existia NENHUM tratamento de teclado fora do player de vídeo
// (ver player.js, que só ouve Espaço/Setas/M quando o player está aberto).
//
// Em vez de reescrever app.js/ui.js/player.js (arriscando quebrar toda a lógica
// de renderização já testada), este arquivo roda "por cima": observa o DOM,
// torna focável tudo que já é clicável, e implementa navegação espacial (o
// D-pad move o foco pro elemento visualmente mais próximo na direção
// pressionada) + ativação (OK/Enter) + Voltar (Escape/Backspace/tecla de
// voltar do controle da TV). Carregar por último (depois de app.js, player.js
// e ui.js) para poder usar as funções/variáveis globais delas.
(function () {
    'use strict';

    // ---------- 1. TORNAR FOCÁVEL O QUE JÁ É CLICÁVEL ----------
    // Estes seletores cobrem elementos criados dinamicamente pelo ui.js (cards de
    // filme/série, linhas de canal ao vivo, itens de categoria, episódios, banner)
    // que nunca tiveram tabindex porque só existiam para clique/toque.
    var SELETOR_PRECISA_TABINDEX =
        '.media-card, .live-channel-row, .episode-row-card, .hero-slide, ' +
        '#category-list li[data-id], #live-category-list li[data-id]';

    // Tudo que o D-pad pode alcançar: links, botões, campos de texto e qualquer
    // coisa com tabindex (inclui o que acabamos de tornar focável acima).
    var SELETOR_FOCAVEL = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function tornarFocaveis(raiz) {
        if (!raiz.querySelectorAll) return;
        var els = raiz.querySelectorAll(SELETOR_PRECISA_TABINDEX);
        for (var i = 0; i < els.length; i++) {
            if (!els[i].hasAttribute('tabindex')) els[i].setAttribute('tabindex', '0');
        }
    }

    // ui.js recria esses cards/listas toda vez que a grade, o sidebar ou os
    // episódios são renderizados de novo — por isso observamos o DOM inteiro em
    // vez de rodar isso uma única vez no carregamento da página.
    new MutationObserver(function (mutacoes) {
        for (var m = 0; m < mutacoes.length; m++) {
            var nos = mutacoes[m].addedNodes;
            for (var n = 0; n < nos.length; n++) {
                var no = nos[n];
                if (no.nodeType !== 1) continue;
                if (no.matches && no.matches(SELETOR_PRECISA_TABINDEX) && !no.hasAttribute('tabindex')) {
                    no.setAttribute('tabindex', '0');
                }
                tornarFocaveis(no);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
    tornarFocaveis(document.body);

    // ---------- 2. VISIBILIDADE "DE VERDADE" ----------
    // O app esconde coisas de formas diferentes dependendo da tela: display:none
    // (abas/telas), opacity:0 + pointer-events:none (gaveta de categorias no
    // mobile) ou simplesmente posicionando fora da tela com left negativo
    // (sidebar de canais ao vivo). Uma checagem só de "display" deixaria essas
    // gavetas fechadas navegáveis por engano.
    function estaVisivel(el) {
        if (!el || el.hasAttribute('disabled')) return false;
        if (el.getClientRects().length === 0) return false;
        var estilo = getComputedStyle(el);
        if (estilo.visibility === 'hidden' || estilo.display === 'none') return false;
        if (parseFloat(estilo.opacity) === 0) return false;
        if (estilo.pointerEvents === 'none') return false;
        var r = el.getBoundingClientRect();
        var largura = window.innerWidth || document.documentElement.clientWidth;
        var altura = window.innerHeight || document.documentElement.clientHeight;
        return r.right > 0 && r.bottom > 0 && r.left < largura && r.top < altura;
    }

    // ---------- 3. QUAL "ÁREA" ESTÁ ATIVA AGORA ----------
    // Modais, o player de vídeo e as gavetas (categorias/canais ao vivo) ficam
    // por CIMA do resto do app, mas o conteúdo de trás continua "visível" pelas
    // regras de CSS (só está atrás visualmente). Sem isso, o D-pad conseguiria
    // "vazar" o foco através do overlay para dentro da grade escondida atrás.
    function obterContainerAtivo() {
        var modalPerfil = document.getElementById('profile-modal');
        if (modalPerfil && getComputedStyle(modalPerfil).display !== 'none') return modalPerfil;

        var loginScreen = document.getElementById('login-screen');
        if (loginScreen && getComputedStyle(loginScreen).display !== 'none') return loginScreen;

        var playerWrapper = document.getElementById('player-wrapper');
        if (playerWrapper && getComputedStyle(playerWrapper).display !== 'none') return playerWrapper;

        var liveSidebar = document.getElementById('live-category-sidebar');
        if (liveSidebar && liveSidebar.classList.contains('open')) return liveSidebar;

        var catDrawer = document.getElementById('category-bar');
        if (catDrawer && catDrawer.classList.contains('drawer-open')) return catDrawer;

        // Sem overlay ativo: navegação livre pelo documento inteiro (topo + busca
        // + view ativa). Telas/abas inativas já ficam de fora por estarem com
        // display:none, então isso não deixa "vazar" foco pra lugar errado.
        return document;
    }

    function coletarFocaveis(container) {
        var raiz = container === document ? document : container;
        var lista = raiz.querySelectorAll(SELETOR_FOCAVEL);
        var visiveis = [];
        for (var i = 0; i < lista.length; i++) if (estaVisivel(lista[i])) visiveis.push(lista[i]);
        return visiveis;
    }

    // Alguns overlays têm uma ordem de tabulação natural que não é a ideal (ex:
    // o primeiro botão do modal de perfil é "Sair da Conta" — melhor abrir com o
    // foco em "Voltar", mais seguro).
    var FOCO_INICIAL_PREFERIDO = {
        'profile-modal': '#btn-close-modal',
        'player-wrapper': '#btn-fechar-player'
    };
    var PRIORIDADE_CONTEUDO = [
        '.media-card', '.live-channel-row', 'li[data-id]', '.hero-slide',
        '.episode-row-card', 'input', 'button', '[tabindex="0"]'
    ];

    function focarPrimeiroElemento(container) {
        if (!container) return false;
        var raiz = container === document ? document : container;

        var idPreferido = container.id && FOCO_INICIAL_PREFERIDO[container.id];
        if (idPreferido) {
            var preferido = document.querySelector(idPreferido);
            if (preferido && estaVisivel(preferido)) { preferido.focus({ preventScroll: true }); return true; }
        }

        for (var i = 0; i < PRIORIDADE_CONTEUDO.length; i++) {
            var candidatos = raiz.querySelectorAll(PRIORIDADE_CONTEUDO[i]);
            for (var j = 0; j < candidatos.length; j++) {
                if (estaVisivel(candidatos[j])) { candidatos[j].focus({ preventScroll: true }); return true; }
            }
        }
        return false;
    }

    // ---------- 4. NAVEGAÇÃO ESPACIAL (o "miolo" do D-pad) ----------
    // Pega o elemento focado, olha a posição de tela de cada candidato na
    // direção pressionada e escolhe o mais próximo — dando bastante peso ao
    // desalinhamento perpendicular, pra não pular de coluna sem querer ao
    // descer/subir numa grade.
    function moverFoco(direcao) {
        var container = obterContainerAtivo();
        var atual = document.activeElement;
        var focoValido = atual && atual !== document.body && estaVisivel(atual) &&
            (container === document || container.contains(atual));

        if (!focoValido) { focarPrimeiroElemento(container); return; }

        var candidatos = coletarFocaveis(container).filter(function (el) { return el !== atual; });
        if (candidatos.length === 0) return;

        var rAtual = atual.getBoundingClientRect();
        var cxAtual = (rAtual.left + rAtual.right) / 2;
        var cyAtual = (rAtual.top + rAtual.bottom) / 2;
        var melhor = null, melhorScore = Infinity;

        candidatos.forEach(function (cand) {
            var r = cand.getBoundingClientRect();
            var cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
            var aceito = false, primario = 0, perpendicular = 0;

            if (direcao === 'right') { aceito = r.left >= rAtual.right - 1; primario = r.left - rAtual.right; perpendicular = cy - cyAtual; }
            else if (direcao === 'left') { aceito = r.right <= rAtual.left + 1; primario = rAtual.left - r.right; perpendicular = cy - cyAtual; }
            else if (direcao === 'down') { aceito = r.top >= rAtual.bottom - 1; primario = r.top - rAtual.bottom; perpendicular = cx - cxAtual; }
            else if (direcao === 'up') { aceito = r.bottom <= rAtual.top + 1; primario = rAtual.top - r.bottom; perpendicular = cx - cxAtual; }

            if (!aceito) return;
            var score = Math.max(primario, 0) + Math.abs(perpendicular) * 2.2;
            if (score < melhorScore) { melhorScore = score; melhor = cand; }
        });

        if (melhor) {
            melhor.focus({ preventScroll: true });
            melhor.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
    }

    // ---------- 5. ATIVAR (OK/Enter) ----------
    // <button>/<a>/<input> já respondem ao Enter sozinhos no navegador — chamar
    // .click() de novo neles disparava o clique DUAS vezes (ex: favoritava e
    // desfavoritava na sequência). Só simulamos o clique manualmente nos
    // elementos que NÓS tornamos focáveis (divs/li de cards, canais, categorias).
    var TAGS_NATIVAMENTE_ATIVAVEIS = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1 };
    function ativarElementoFocado() {
        var el = document.activeElement;
        if (!el || el === document.body || TAGS_NATIVAMENTE_ATIVAVEIS[el.tagName]) return;
        el.click();
    }

    // ---------- 6. VOLTAR (Escape/Backspace/tecla dedicada do controle) ----------
    // Segue a mesma ordem de prioridade "de cima pra baixo" que um usuário
    // esperaria: primeiro fecha o que está por cima (modal > player > gavetas >
    // busca), só depois volta telas (detalhes > aba Início).
    function tratarBotaoVoltar() {
        var modalPerfil = document.getElementById('profile-modal');
        if (modalPerfil && getComputedStyle(modalPerfil).display !== 'none') {
            var btnFecharModal = document.getElementById('btn-close-modal');
            if (btnFecharModal) btnFecharModal.click();
            return;
        }
        var playerWrapper = document.getElementById('player-wrapper');
        if (playerWrapper && getComputedStyle(playerWrapper).display !== 'none') {
            var btnFecharPlayer = document.getElementById('btn-fechar-player');
            if (btnFecharPlayer) btnFecharPlayer.click();
            return;
        }
        var liveSidebar = document.getElementById('live-category-sidebar');
        if (liveSidebar && liveSidebar.classList.contains('open')) {
            if (typeof definirGavetaCategoriasAoVivo === 'function') definirGavetaCategoriasAoVivo(false);
            return;
        }
        var catDrawer = document.getElementById('category-bar');
        if (catDrawer && catDrawer.classList.contains('drawer-open')) {
            if (typeof definirGavetaCategorias === 'function') definirGavetaCategorias(false);
            return;
        }
        var searchWrapper = document.getElementById('search-wrapper');
        if (searchWrapper && searchWrapper.classList.contains('active')) {
            var btnBusca = document.getElementById('btn-search');
            if (btnBusca) btnBusca.click();
            return;
        }
        var mediaDetail = document.getElementById('media-detail');
        if (mediaDetail && mediaDetail.classList.contains('active')) {
            if (typeof fecharDetalhesMedia === 'function') fecharDetalhesMedia();
            return;
        }
        if (typeof abaAtiva !== 'undefined' && abaAtiva !== 'home') {
            var linkHome = document.querySelector('.nav-link[data-tab="home"]');
            if (linkHome) linkHome.click();
        }
    }

    // ---------- 7. LISTENER PRINCIPAL DE TECLADO ----------
    var MAPA_DIRECOES = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    // 461 = tecla "Voltar" do controle da LG (webOS) / 10009 = Samsung (Tizen).
    // Ambas chegam como keyCode numérico, não como e.key.
    var CODIGOS_VOLTAR_TV = { 461: 1, 10009: 1 };

    document.addEventListener('keydown', function (e) {
        var emCampoDeTexto = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
        var playerAberto = document.getElementById('player-wrapper').style.display === 'flex';

        if (MAPA_DIRECOES[e.key]) {
            // Num campo de texto, só Esquerda/Direita devem mover o cursor dentro
            // do texto — Cima/Baixo não fazem nada num campo de uma linha só, então
            // continuam livres para tirar o foco de lá. Antes o "return" cobria
            // as 4 direções, e quem entrava no campo de busca ficava "trancado"
            // sem conseguir descer pra lista de canais/categorias com o controle.
            if (emCampoDeTexto && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
            // Com o player aberto, Esquerda/Direita já avançam/voltam 10s (ver
            // player.js) — não competir com esse atalho já existente.
            if (playerAberto && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
            e.preventDefault();
            moverFoco(MAPA_DIRECOES[e.key]);
            return;
        }

        if (e.key === 'Enter') {
            if (emCampoDeTexto) return;
            ativarElementoFocado();
            return;
        }

        var ehVoltar = e.key === 'Escape' || e.key === 'GoBack' ||
            (e.key === 'Backspace' && !emCampoDeTexto) || CODIGOS_VOLTAR_TV[e.keyCode];
        if (ehVoltar) {
            e.preventDefault();
            tratarBotaoVoltar();
        }
    });

    // ---------- 8. MANTER O FOCO SEMPRE EM ALGO VISÍVEL E VÁLIDO ----------
    // Regra única e simples: sempre que o DOM mudar (troca de aba, abrir/fechar
    // modal ou player, gaveta abrindo/fechando...), se o elemento focado atual
    // sumiu/ficou invisível ou não faz mais parte da área ativa, foca a próxima
    // coisa sensata. Isso cobre TODAS as transições de tela de uma vez só, sem
    // precisar de um observador dedicado pra cada modal/gaveta/aba do app.
    var debounceId = null;
    function reavaliarFoco() {
        clearTimeout(debounceId);
        debounceId = setTimeout(function () {
            var atual = document.activeElement;
            var container = obterContainerAtivo();
            var focoValido = atual && atual !== document.body && estaVisivel(atual) &&
                (container === document || container.contains(atual));
            if (!focoValido) focarPrimeiroElemento(container);
        }, 80);
    }
    new MutationObserver(reavaliarFoco).observe(document.body, {
        attributes: true, attributeFilter: ['class', 'style'], subtree: true, childList: true
    });
    reavaliarFoco(); // estado inicial: tela de login ou catálogo já em cache
})();