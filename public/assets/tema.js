/* Tema claro / escuro — site e painel.
   O tema inicial é definido antes da página aparecer (script no <head>): a escolha salva da pessoa ou,
   sem escolha, o tema do sistema. Este arquivo cuida do botão ☀/☾ e acompanha o sistema quando não há escolha salva. */
(function () {
  "use strict";
  var raiz = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var SOL = SVG + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var LUA = SVG + '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function salvo() { try { return localStorage.getItem("tema"); } catch (e) { return null; } }

  function pintar() {
    var escuro = raiz.dataset.tema === "escuro";
    var botoes = document.querySelectorAll("[data-tema-botao]");
    for (var i = 0; i < botoes.length; i++) {
      var b = botoes[i];
      b.innerHTML = escuro ? SOL : LUA;
      b.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
      b.title = b.getAttribute("aria-label");
    }
  }

  function aplicar(t) { raiz.dataset.tema = t; pintar(); }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-tema-botao]");
    if (!b) return;
    var t = raiz.dataset.tema === "escuro" ? "claro" : "escuro";
    try { localStorage.setItem("tema", t); } catch (x) { /* navegador sem armazenamento: vale só nesta página */ }
    aplicar(t);
  });

  if (mq) {
    var mudou = function (ev) { if (!salvo()) aplicar(ev.matches ? "escuro" : "claro"); };
    if (mq.addEventListener) mq.addEventListener("change", mudou); else if (mq.addListener) mq.addListener(mudou);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pintar); else pintar();
})();
