/* Partida das páginas do frontend (como o inicio.js do SAC).
   Busca no backend os dados que a página precisa, guarda em window.BOOT e só então carrega os scripts da tela.
   Uso: <script src="/assets/inicio.js" data-pagina="site|painel" data-scripts="/assets/a.js /assets/b.js" defer></script> */
(function () {
  "use strict";
  var eu = document.currentScript;
  var pagina = eu.getAttribute("data-pagina");
  var scripts = (eu.getAttribute("data-scripts") || "").split(/\s+/).filter(Boolean);

  // Dados fixos do site (apresentação: ficam no frontend)
  var SITE = {
    logoUrl: "/assets/logo.png",
    logoEscuroUrl: "/assets/logo-escuro.png",
    usvUrl: "https://lh3.googleusercontent.com/d/1oJqHdWGQzA3_eGaqyccbcSr31S_9H9OE",
    contato: { whatsapp: "https://wa.me/21966396480", email: "ainnomaker@gmail.com", site: "https://innomaker.com.br/" }
  };

  function carregarScripts(i) {
    if (i >= scripts.length) return;
    var s = document.createElement("script");
    s.src = scripts[i];
    s.onload = function () { carregarScripts(i + 1); };
    document.body.appendChild(s);
  }

  function esperar(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  // GET no backend; tenta de novo por alguns segundos se o sistema estiver reiniciando
  function buscar(url, tentativa) {
    tentativa = tentativa || 0;
    return fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(function (r) {
        var ehJson = (r.headers.get("content-type") || "").indexOf("application/json") >= 0;
        if (!ehJson || r.status === 503) {
          if (tentativa < 5) return esperar(2000).then(function () { return buscar(url, tentativa + 1); });
          return { status: r.status, dados: null };
        }
        return r.json().then(function (j) { return { status: r.status, dados: j }; });
      })
      .catch(function () {
        if (tentativa < 3) return esperar(2000).then(function () { return buscar(url, tentativa + 1); });
        return { status: 0, dados: null };
      });
  }

  function aviso(titulo, texto, botoes) {
    var caixa = document.createElement("section");
    caixa.className = "aviso-geral";
    var h = document.createElement("h1"); h.textContent = titulo;
    var p = document.createElement("p"); p.textContent = texto;
    var acoes = document.createElement("div"); acoes.className = "acoes";
    (botoes || []).forEach(function (b, i) {
      var a = document.createElement("a"); a.href = b[1]; a.textContent = b[0]; a.className = i ? "bt-sec" : "bt"; acoes.appendChild(a);
    });
    caixa.append(h, p, acoes);
    var alvo = document.getElementById("conteudo") || document.body;
    alvo.innerHTML = "";
    alvo.appendChild(caixa);
    var lateral = document.getElementById("lateral");
    if (lateral) lateral.hidden = true;
  }

  if (pagina === "site") {
    var q = new URLSearchParams(location.search);
    buscar("/api/site/inicio").then(function (r) {
      var d = r.dados && r.dados.ok ? r.dados : { vagas: [], candidato: null, staff: { temSessao: false }, erro: "Não foi possível carregar as vagas agora. Recarregue a página em instantes." };
      window.BOOT = Object.assign({}, SITE, d, {
        page: String(q.get("page") || "home").toLowerCase(),
        params: { vaga_id: q.get("vaga_id") || "" }
      });
      carregarScripts(0);
    });
  }

  if (pagina === "painel") {
    buscar("/api/painel/sessao").then(function (r) {
      var d = r.dados || {};
      if (r.status === 401 && d.loginUrl) { location.replace(d.loginUrl); return; }
      if (r.status === 403) {
        aviso("Acesso negado",
          (d.login ? "A conta \"" + d.login + "\"" : "Sua conta") + " entrou na conta Innomaker, mas não está em nenhum grupo com acesso ao painel (funcionário, gerente ou RH). Peça ao RH para incluir você no grupo correto.",
          [["Voltar ao site de vagas", "/"], ["Sair e entrar com outra conta", "/sair"]]);
        return;
      }
      if (!d.ok) {
        aviso("Não foi possível abrir o painel", d.erro || "O sistema não respondeu. Tente de novo em instantes.", [["Tentar de novo", location.href], ["Voltar ao site", "/"]]);
        return;
      }
      window.BOOT = Object.assign({ logoUrl: SITE.logoUrl }, d);
      carregarScripts(0);
    });
  }
})();
