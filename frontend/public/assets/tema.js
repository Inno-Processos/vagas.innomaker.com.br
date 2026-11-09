/* Tema claro / escuro — site e painel.
   Segue sempre o tema do dispositivo: o inicial é definido no <head> (antes da página aparecer)
   e este arquivo troca na hora se a pessoa mudar o tema do sistema com a página aberta. */
(function () {
  "use strict";
  try { localStorage.removeItem("tema"); } catch (e) { /* escolha antiga do botão, que não existe mais */ }
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (!mq) return;
  function aplicar() { document.documentElement.dataset.tema = mq.matches ? "escuro" : "claro"; }
  if (mq.addEventListener) mq.addEventListener("change", aplicar); else if (mq.addListener) mq.addListener(aplicar);
})();
