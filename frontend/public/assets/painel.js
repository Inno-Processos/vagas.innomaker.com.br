/* Painel interno — Innomaker (vagas.innomaker.com.br/painel) */
/* global BOOT */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const U = BOOT.usuario;
  const PODE = new Set(BOOT.acoes || []);
  const pode = acao => PODE.has(acao);
  const main = $("conteudo");
  let estadoPrefill = null; // dados para pré-preencher "Solicitar vaga"

  // =================================================================
  //  Utilitários
  // =================================================================
  function el(tag, attrs) {
    const e = document.createElement(tag);
    const filhos = Array.prototype.slice.call(arguments, 2);
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(e.dataset, v);
      else if (v === true) e.setAttribute(k, "");
      else e.setAttribute(k, v);
    });
    filhos.flat().forEach(f => {
      if (f == null || f === false) return;
      e.append(f.nodeType ? f : document.createTextNode(String(f)));
    });
    return e;
  }

  function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  let toastTimer = null;
  function toast(msg, erro) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (erro ? " erro" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, erro ? 7000 : 4000);
  }

  async function api(acao, dados, tentativa) {
    tentativa = tentativa || 0;
    let r;
    try {
      r = await fetch("/api/staff/" + acao, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dados || {})
      });
    } catch (e) {
      return { ok: false, erro: "Sem conexão. Verifique sua internet e tente novamente." };
    }
    if (r.status === 401) {
      toast("Sua sessão expirou. Redirecionando para o login…", true);
      setTimeout(() => { location.href = BOOT.loginUrl; }, 1200);
      return { ok: false, erro: "Sessão expirada." };
    }
    const tipo = r.headers.get("content-type") || "";
    let j = null;
    if (tipo.indexOf("application/json") >= 0) {
      try { j = await r.json(); } catch (e) { /* segue para a mensagem abaixo */ }
    }
    if (j && !j.reiniciando) return j;
    // Resposta que não veio do backend: o frontend avisa "reiniciando" (503) ou o Traefik responde 404/502/503
    // durante uma atualização. O pedido não chegou ao backend, então é seguro tentar de novo sozinho.
    if ([404, 502, 503, 504].indexOf(r.status) >= 0 && tentativa < 4) {
      if (tentativa === 0) toast("O sistema está reiniciando. Tentando de novo…");
      await new Promise(ok => setTimeout(ok, 3000));
      return api(acao, dados, tentativa + 1);
    }
    return { ok: false, erro: [404, 502, 503, 504].indexOf(r.status) >= 0
      ? "O sistema está sendo atualizado. Aguarde alguns segundos e recarregue a página."
      : "Resposta inesperada do servidor (HTTP " + r.status + "). Recarregue a página; se continuar, avise o suporte." };
  }

  function carregando(texto) {
    return el("div", { class: "carregando" }, el("div", { class: "spin" }), texto || "Carregando…");
  }

  function msg(tipo, texto) { return el("div", { class: "msg " + tipo, role: tipo === "erro" ? "alert" : null }, texto); }

  function fmtData(v, comHora) {
    if (!v) return "";
    const s = String(v);
    if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return comHora ? s : s.slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[3] + "/" + m[2] + "/" + m[1];
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const p = n => String(n).padStart(2, "0");
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + (comHora ? " " + p(d.getHours()) + ":" + p(d.getMinutes()) : "");
  }

  function primeiroNome(n) { return String(n || "").trim().split(/\s+/)[0] || ""; }

  function norm(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(() => toast("Link copiado."), () => prompt("Copie o link:", texto));
    } else {
      prompt("Copie o link:", texto);
    }
  }

  // ---------- Status ----------
  const STATUS = {
    // Solicitações
    "PENDENTE": ["Aguardando RH", "ambar"], "REAJUSTE": ["Recusada com alteração", "verm"], "APROVADA": ["Aprovada", "verde"],
    "RECUSADA": ["Recusada", "cinza"], "VAGA_CRIADA": ["Vaga criada", "azul"],
    // Vagas
    "Aberta": ["Aberta", "verde"], "Pausada": ["Pausada", "ambar"], "Fechada": ["Fechada", "cinza"], "Concluída": ["Concluída", "azul"],
    // Candidaturas
    "Em processo": ["Em processo", "azul"], "Aprovado": ["Aprovado no processo", "verde"], "Encerrado": ["Encerrado", "cinza"],
    "Proposta": ["Proposta", "ambar"], "Contratado": ["Contratado", "verde"], "Desistiu": ["Desistiu", "cinza"],
    "Pendente": ["Pendente", "cinza"], "Reprovado": ["Reprovado", "verm"],
    // Admissões
    "PROPOSTA_ENVIADA": ["Proposta enviada", "cinza"], "PROPOSTA_RECUSADA": ["Proposta recusada", "verm"],
    "COMPLETANDO_CADASTRO": ["Preenchendo cadastro", "azul"], "AGUARDANDO_APROVACAO": ["Aguardando aprovação", "ambar"],
    "CORRECAO_SOLICITADA": ["Correção solicitada", "ambar"], "RECUSADA_ADM": ["Recusada pelo RH", "verm"],
    // Documentos
    "AGUARDANDO_ASSINATURA": ["Aguardando assinatura", "ambar"], "ASSINADO": ["Assinado", "verde"], "CANCELADO": ["Cancelado", "cinza"]
  };
  function pill(status) {
    const s = STATUS[status] || [status || "—", "cinza"];
    return el("span", { class: "pill " + s[1] }, s[0]);
  }

  function chips(opcoes, ativo, aoMudar) {
    const box = el("div", { class: "chips", role: "group", "aria-label": "Filtrar por situação" });
    opcoes.forEach(o => {
      box.append(el("button", {
        type: "button", class: "chip", "aria-pressed": String(o.id === ativo),
        onclick: () => {
          box.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", "false"));
          box.querySelector('[data-id="' + o.id + '"]').setAttribute("aria-pressed", "true");
          aoMudar(o.id);
        },
        dataset: { id: o.id }
      }, o.nome, o.qtd != null ? el("span", null, o.qtd) : null));
    });
    return box;
  }

  function dados(pares) {
    const dl = el("dl", { class: "dados" });
    pares.forEach(p => { if (p[1] !== "" && p[1] != null) dl.append(el("dt", null, p[0]), el("dd", null, String(p[1]))); });
    return dl;
  }

  // ---------- Diálogo ----------
  // opts: { titulo, corpo: Node, okTexto, okClasse, largo, semCancelar, aoConfirmar: async () => true | "mensagem de erro" }
  function dialogo(opts) {
    const dlg = $("dlg");
    $("dlgTitulo").textContent = opts.titulo || "";
    limpar($("dlgCorpo"));
    if (opts.corpo) $("dlgCorpo").append(opts.corpo);
    limpar($("dlgMsg"));
    dlg.classList.toggle("largo", !!opts.largo);

    const ok = $("dlgOk");
    const cancelar = $("dlgCancelar");
    ok.textContent = opts.okTexto || "Confirmar";
    ok.className = opts.okClasse || "bt";
    ok.hidden = !!opts.semOk;
    ok.disabled = false;
    cancelar.textContent = opts.semOk ? "Fechar" : "Cancelar";

    return new Promise(resolve => {
      function fechar(v) {
        ok.onclick = null; cancelar.onclick = null; dlg.onclose = null;
        if (dlg.open) dlg.close();
        resolve(v);
      }
      cancelar.onclick = () => fechar(false);
      dlg.onclose = () => fechar(false);
      ok.onclick = async () => {
        limpar($("dlgMsg"));
        if (!opts.aoConfirmar) return fechar(true);
        ok.disabled = true;
        const textoOk = ok.textContent;
        ok.textContent = "Aguarde…";
        let r;
        try { r = await opts.aoConfirmar(); } catch (e) { r = e && e.message ? e.message : "Erro inesperado."; }
        ok.disabled = false;
        ok.textContent = textoOk;
        if (r === true) return fechar(true);
        $("dlgMsg").append(msg("erro", typeof r === "string" ? r : "Não foi possível concluir."));
      };
      dlg.showModal();
    });
  }

  function campo(rotulo, controle, opts) {
    opts = opts || {};
    const id = controle.id || ("c_" + Math.random().toString(36).slice(2));
    controle.id = id;
    if (opts.dica) controle.setAttribute("aria-describedby", id + "_dica");
    return el("div", { class: "campo" + (opts.largo ? " largo" : ""), dataset: { campo: opts.nome || "" } },
      el("label", { for: id }, rotulo, opts.obrigatorio ? el("span", { class: "req", "aria-hidden": "true" }, " *") : null),
      controle,
      opts.dica ? el("small", { id: id + "_dica" }, opts.dica) : null);
  }

  const pillAdm = s => pill(s === "RECUSADA" ? "RECUSADA_ADM" : s);
  let OPCOES = null;
  async function opcoes() {
    if (OPCOES) return OPCOES;
    const r = await api("opcoes");
    OPCOES = r.ok ? r : { listas: {}, departamentos: [] };
    return OPCOES;
  }
  const lista = (op, tipo) => (op.listas && op.listas[tipo]) || [];

  function entrada(nome, valor, attrs) {
    return el("input", Object.assign({ type: "text", name: nome, value: valor == null ? "" : String(valor) }, attrs || {}));
  }
  function areaTexto(nome, valor, attrs) {
    const t = el("textarea", Object.assign({ name: nome }, attrs || {}));
    t.value = valor == null ? "" : String(valor);
    return t;
  }
  function seletor(nome, opcoesLista, valor, vazio) {
    const s = el("select", { name: nome });
    if (vazio !== false) s.append(el("option", { value: "" }, vazio || "Selecione"));
    const vals = opcoesLista.slice();
    if (valor && vals.indexOf(valor) < 0) vals.push(valor);
    vals.forEach(o => s.append(el("option", { value: o, selected: o === valor }, o)));
    return s;
  }
  function comLista(input, valores) {
    const id = "dl_" + Math.random().toString(36).slice(2);
    input.setAttribute("list", id);
    return [input, el("datalist", { id }, valores.map(v => el("option", { value: v })))];
  }
  function lerForm(form) {
    const d = {};
    form.querySelectorAll("[name]").forEach(i => {
      if (i.type === "checkbox") d[i.name] = i.checked;
      else d[i.name] = i.value;
    });
    return d;
  }
  function marcarFaltando(form, nomes) {
    form.querySelectorAll(".erro").forEach(x => x.classList.remove("erro"));
    nomes.forEach(n => { const c = form.querySelector('[data-campo="' + n + '"]'); if (c) c.classList.add("erro"); });
    const p = form.querySelector(".erro");
    if (p) p.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // =================================================================
  //  Navegação
  // =================================================================
  const VIEWS = [
    { id: "inicio", nome: "Início", acao: "me", render: viewInicio },
    { id: "vagas-abertas", nome: "Vagas abertas", acao: "vagas_abertas", render: viewVagasAbertas,
      desc: "Veja as oportunidades publicadas e copie o link para indicar alguém." },
    { grupo: "Gestão" },
    { id: "solicitar", nome: "Solicitar vaga", acao: "solic_criar", render: viewSolicitar,
      desc: "Peça ao RH a abertura de uma vaga para a sua área." },
    { id: "minhas", nome: "Minhas solicitações", acao: "solic_minhas", render: viewMinhas,
      desc: "Acompanhe a análise do RH e corrija as recusadas com alteração." },
    { id: "minhas-vagas", nome: "Vagas da minha área", acao: "minhas_vagas", render: viewMinhasVagas, soSe: () => !pode("vagas_todas"),
      desc: "Veja os candidatos das vagas que você pediu." },
    { grupo: "RH" },
    { id: "solicitacoes", nome: "Solicitações", acao: "solic_listar", render: viewSolicitacoes,
      desc: "Analise os pedidos dos gestores: aprove, recuse ou recuse com alteração." },
    { id: "vagas", nome: "Vagas", acao: "vagas_todas", render: viewVagas,
      desc: "Crie e edite vagas, controle prazos e conduza as etapas dos candidatos." },
    { id: "admissoes", nome: "Admissões", acao: "adm_listar", render: viewAdmissoes,
      desc: "Propostas, cadastros para conferir e aprovação da admissão." },
    { id: "funcionarios", nome: "Funcionários", acao: "func_listar", render: viewFuncionarios,
      desc: "Registros, documentos assinados, ponto, onboarding e renovações." },
    { id: "configuracoes", nome: "Configurações", acao: "cfg_obter", render: viewConfig,
      desc: "Departamentos e gestores, listas, modelos de documento e links." },
    { id: "log", nome: "Histórico", acao: "log_listar", render: viewLog,
      desc: "Ações registradas e e-mails enviados." }
  ];
  // Rotas internas (não aparecem no menu)
  const ROTAS = {
    "solicitacao": { acao: "solic_listar", render: (b, id) => viewSolicitacoes(b, id), menu: "solicitacoes" },
    "editar-solicitacao": { acao: "solic_editar", render: (b, id) => viewSolicitar(b, id), menu: "minhas" },
    "vaga": { acao: "vaga_detalhe", render: (b, id) => viewVagaDetalhe(b, id), menu: () => pode("vagas_todas") ? "vagas" : "minhas-vagas" },
    "vaga-form": { acao: "vaga_salvar", render: (b, id) => viewVagaForm(b, id), menu: "vagas" },
    "vaga-de-solicitacao": { acao: "vaga_salvar", render: (b, id) => viewVagaForm(b, null, id), menu: "vagas" },
    "admissao": { acao: "adm_detalhe", render: (b, id) => viewAdmissaoDetalhe(b, id), menu: "admissoes" },
    "funcionario": { acao: "func_detalhe", render: (b, id) => viewFuncionarioDetalhe(b, id), menu: "funcionarios" }
  };
  const visiveis = () => VIEWS.filter(v => v.id && pode(v.acao) && (!v.soSe || v.soSe()));

  // Ícones do menu (traço 2px, 24×24)
  const ICONES = {
    "inicio": "M3 10.5 12 3l9 7.5M5 9v12h5v-6h4v6h5V9",
    "vagas-abertas": "M3 8h18v12H3zM8 8V5h8v3M3 13h18",
    "solicitar": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 8v8M8 12h8",
    "minhas": "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
    "minhas-vagas": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    "solicitacoes": "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
    "vagas": "M3 8h18v12H3zM8 8V5h8v3M3 13h18",
    "admissoes": "M9 4h6v3H9zM15 5h3v16H6V5h3M9 13l2 2 4-4",
    "funcionarios": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    "configuracoes": "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    "log": "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2"
  };
  function icone(id) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    [["viewBox", "0 0 24 24"], ["width", "19"], ["height", "19"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"],
      ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]].forEach(a => s.setAttribute(a[0], a[1]));
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", ICONES[id] || ICONES.inicio);
    s.append(p);
    return s;
  }

  const GRUPO_DA_VIEW = {};
  function montarMenu() {
    const nav = $("lateral");
    limpar(nav);
    let grupo = null, grupoAtual = "Painel";
    VIEWS.forEach(v => {
      if (v.grupo) { grupo = v.grupo; grupoAtual = v.grupo; return; }
      GRUPO_DA_VIEW[v.id] = grupoAtual;
      if (!pode(v.acao) || (v.soSe && !v.soSe())) return;
      if (grupo) { nav.append(el("h3", null, grupo)); grupo = null; }
      nav.append(el("a", { href: "#" + v.id, dataset: { view: v.id } }, icone(v.id), el("span", null, v.nome)));
    });
    atualizarContadores();
  }

  // Número de pendências ao lado do item do menu (ex.: solicitações aguardando aprovação)
  async function atualizarContadores() {
    if (!pode("solic_listar")) return;
    const r = await api("solic_listar");
    const a = document.querySelector('.lateral a[data-view="solicitacoes"]');
    if (!a || !r.ok) return;
    const n = r.itens.filter(i => i.status === "PENDENTE").length;
    let b = a.querySelector(".badge");
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = el("span", { class: "badge", title: "Aguardando aprovação" }); a.append(b); }
    b.textContent = String(n);
  }

  function abrirMenu(abrir) {
    $("lateral").classList.toggle("aberta", abrir);
    $("veu").classList.toggle("ativo", abrir);
    $("veu").hidden = !abrir;
    $("menuBtn").setAttribute("aria-expanded", String(abrir));
  }

  function irPara() {
    const h = decodeURIComponent((location.hash || "#inicio").slice(1));
    const [nome, ...resto] = h.split("/");
    const param = resto.join("/");
    let menuAtivo, render, titulo;
    const rota = ROTAS[nome];
    if (rota && pode(rota.acao) && param) {
      menuAtivo = typeof rota.menu === "function" ? rota.menu() : rota.menu;
      render = b => rota.render(b, param);
      titulo = param;
    } else {
      const v = visiveis().find(x => x.id === nome) || visiveis()[0];
      menuAtivo = v.id; render = v.render; titulo = v.nome;
    }
    document.querySelectorAll(".lateral a").forEach(a => {
      if (a.dataset.view === menuAtivo) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    abrirMenu(false);
    olhoAtual = GRUPO_DA_VIEW[menuAtivo] || "Painel";
    manualAtual = (rota && pode(rota.acao) && param) ? nome : menuAtivo;
    document.title = titulo + " — Painel Vagas.Innomaker";
    const dlg = $("dlg");
    if (dlg.open) dlg.close();
    limpar(main);
    window.scrollTo(0, 0);
    render(main);
    main.focus({ preventScroll: true });
  }
  const recarregar = () => { irPara(); atualizarContadores(); };
  let olhoAtual = "Painel";
  let manualAtual = "inicio";

  function cabecalho(titulo, textoLivre, acoes, voltar) {
    const cab = el("div", { class: "cab" },
      el("div", null,
        voltar ? el("a", { href: voltar[0], class: "voltar" }, "← " + voltar[1]) : el("div", { class: "olho" }, olhoAtual),
        el("h1", null, titulo), textoLivre ? el("p", null, textoLivre) : null),
      acoes ? el("div", { class: "acoes" }, acoes) : null);
    return el("div", null, cab, caixaManual(manualAtual));
  }

  // "Como usar esta tela": abre sozinho na primeira visita a cada aba; depois fica fechado (um clique abre)
  const APELIDOS_MANUAL = { "solicitacao": "solicitacoes", "vaga-de-solicitacao": "vaga-form" };
  function caixaManual(chave) {
    const todos = window.MANUAL_PAINEL || {};
    let m = todos[chave];
    if (m === null || m === undefined) m = todos[APELIDOS_MANUAL[chave]];
    if (m && !m.passos) m = m[U.papel] || m.rh || m.gerente || m.funcionario;
    if (!m) return null;
    const marca = "manual-visto:" + U.papel + ":" + chave;
    let visto = true;
    try { visto = localStorage.getItem(marca) === "1"; localStorage.setItem(marca, "1"); } catch (e) { /* sem armazenamento: fica fechado */ }
    const html = s => { const sp = el("span"); sp.innerHTML = s; return sp; }; // textos fixos do manual.js (não vêm do usuário)
    return el("details", { class: "manual", open: !visto },
      el("summary", null, el("span", { class: "manual-icone", "aria-hidden": "true" }, "?"),
        el("span", null, el("b", null, "Como usar esta tela"), m.resumo ? el("span", { class: "manual-resumo" }, m.resumo) : null)),
      el("div", { class: "manual-corpo" },
        el("ol", null, m.passos.map(p => el("li", null, html(p)))),
        m.dicas && m.dicas.length ? el("ul", { class: "manual-dicas" }, m.dicas.map(d => el("li", null, html(d)))) : null));
  }

  async function carregarEm(box, acao, dados, desenhar) {
    const area = el("div", null, carregando());
    box.append(area);
    const r = await api(acao, dados);
    limpar(area);
    if (!r.ok) { area.append(msg("erro", r.erro || "Não foi possível carregar.")); return null; }
    desenhar(area, r);
    return r;
  }

  // Lista com busca e filtros por chips
  function listaFiltrada(area, itens, cfg) {
    let filtro = cfg.inicial || "todas";
    let busca = "";
    const conta = f => itens.filter(i => f === "todas" || cfg.grupo(i) === f).length;
    const input = el("input", { type: "search", placeholder: cfg.placeholder || "Buscar", "aria-label": cfg.placeholder || "Buscar" });
    const alvo = el("div", { class: "lista" });
    area.append(el("div", { class: "filtros" }, input,
      chips(cfg.filtros.map(([id, nome]) => ({ id, nome, qtd: id === "todas" ? itens.length : conta(id) })), filtro, id => { filtro = id; desenhar(); })), alvo);
    input.addEventListener("input", () => { busca = norm(input.value); desenhar(); });
    function desenhar() {
      limpar(alvo);
      const vis = itens.filter(i => (filtro === "todas" || cfg.grupo(i) === filtro) && (!busca || norm(cfg.texto(i)).indexOf(busca) >= 0));
      if (!vis.length) return alvo.append(el("div", { class: "vazio" }, cfg.vazio || "Nada neste filtro."));
      cfg.desenhar(alvo, vis);
    }
    desenhar();
  }

  // =================================================================
  //  Início
  // =================================================================
  function viewInicio(box) {
    const textos = {
      funcionario: "Área do colaborador: vagas abertas para indicar pessoas e links úteis.",
      gerente: "Solicite vagas para a sua área e acompanhe os candidatos.",
      rh: "Solicitações, vagas, admissões e funcionários em um só lugar."
    };
    const nome = primeiroNome(U.nome) || U.login;
    box.append(el("section", { class: "boas-vindas" },
      el("div", null,
        el("div", { class: "olho" }, "Painel " + U.papelNome),
        el("h1", null, "Olá, ", el("span", null, nome + ".")),
        el("p", null, textos[U.papel])),
      el("div", { class: "acoes" },
        pode("solic_criar") ? el("a", { class: "bt", href: "#solicitar" }, "+ Solicitar vaga") : null,
        el("a", { class: "bt-sec", href: "/?page=central", target: "_blank", rel: "noopener" }, "Ver vagas no site"))),
      caixaManual("inicio"));

    if (U.papel === "rh") inicioRH(box);
    else if (U.papel === "gerente") inicioGerente(box);
    else inicioFuncionario(box);
  }

  function linksUteis(box) {
    if (!(BOOT.links || []).length) return;
    box.append(el("h2", { class: "sec" }, "Links úteis"));
    box.append(el("div", { class: "grade" }, BOOT.links.map(l =>
      el("a", { class: "card atalho", href: l.url, target: "_blank", rel: "noopener" }, el("h3", null, (l.titulo || l.url) + " ↗"), l.descricao ? el("p", null, l.descricao) : null))));
  }

  // Cartão compacto com os botões de decisão (o mesmo fluxo da tela Solicitações)
  function cartaoAprovar(i) {
    return el("article", { class: "card aprovar" },
      el("div", null,
        el("h3", null, i.titulo),
        el("div", { class: "meta" },
          el("span", null, el("b", null, i.departamento)), el("span", null, i.quantidade + " vaga(s)"),
          el("span", null, "Por ", el("b", null, i.solicitante_nome)), el("span", null, fmtData(i.criado_em)),
          i.urgencia ? el("span", { class: /alta/i.test(i.urgencia) ? "urg-alta" : null }, "Urgência ", el("b", null, i.urgencia)) : null,
          (i.historico || []).some(h => h.acao === "Corrigida e reenviada") ? el("span", null, el("b", null, "Corrigida e reenviada")) : null)),
      el("div", { class: "acoes" },
        el("a", { class: "bt-sec", href: "#solicitacao/" + i.id }, "Ver dados"),
        el("button", { type: "button", class: "bt-perigo", onclick: () => decidirSolic(i, "recusar") }, "Recusar"),
        el("button", { type: "button", class: "bt-alerta", onclick: () => decidirSolic(i, "reajuste") }, "Recusar com alteração"),
        el("button", { type: "button", class: "bt", onclick: () => decidirSolic(i, "aprovar") }, "Aprovar")));
  }

  async function inicioRH(box) {
    const nums = el("div", { class: "numeros" }, carregando("Buscando os números…"));
    const fila = el("div", null);
    box.append(nums, fila);
    const [s, v, a, f] = await Promise.all([api("solic_listar"), api("vagas_todas"), api("adm_listar"), api("func_listar")]);
    limpar(nums);
    const n = (rot, val, href) => el("a", { class: "numero" + (val ? " destaque" : ""), href }, el("span", null, rot), el("b", null, val == null ? "—" : String(val)));
    const limite = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
    const pendentes = s.ok ? s.itens.filter(i => i.status === "PENDENTE") : [];
    nums.append(
      n("Solicitações aguardando aprovação", s.ok ? pendentes.length : null, "#solicitacoes"),
      n("Aprovadas sem vaga criada", s.ok ? s.itens.filter(i => i.status === "APROVADA").length : null, "#solicitacoes"),
      n("Vagas abertas no site", v.ok ? v.vagas.filter(x => x.aberta_site).length : null, "#vagas"),
      n("Cadastros para conferir", a.ok ? a.itens.filter(i => i.status === "AGUARDANDO_APROVACAO").length : null, "#admissoes"),
      n("Documentos sem assinatura", f.ok ? f.itens.reduce((t, x) => t + (x.docs_pendentes || 0), 0) : null, "#funcionarios"),
      n("Contratos vencendo em 45 dias", f.ok ? f.itens.filter(x => x.ativo && x.data_final_contrato && x.data_final_contrato <= limite).length : null, "#funcionarios"));

    fila.append(el("h2", { class: "sec" }, el("span", null, "Aguardando sua aprovação"),
      pendentes.length ? el("span", { class: "contador" }, String(pendentes.length)) : null));
    if (!s.ok) fila.append(msg("erro", s.erro || "Não foi possível carregar as solicitações."));
    else if (!pendentes.length) fila.append(el("div", { class: "vazio" }, "Nenhuma solicitação aguardando aprovação. Quando um gestor pedir uma vaga, ela aparece aqui."));
    else fila.append(el("div", { class: "lista" }, pendentes.map(cartaoAprovar)));

    const aprovadas = s.ok ? s.itens.filter(i => i.status === "APROVADA") : [];
    if (aprovadas.length) {
      fila.append(el("h2", { class: "sec" }, "Aprovadas — falta criar a vaga"),
        el("div", { class: "card", style: "padding:0" }, el("div", { class: "lista-curta" }, aprovadas.map(i =>
          el("a", { class: "linha", href: "#vaga-de-solicitacao/" + i.id },
            el("span", null, el("b", null, i.titulo), el("span", { class: "pequeno suave" }, i.departamento + " · " + i.solicitante_nome)),
            el("span", { class: "bt" }, "Criar vaga"))))));
    }
    linksUteis(box);
  }

  async function inicioGerente(box) {
    const area = el("div", null, carregando());
    box.append(area);
    const [m, mv] = await Promise.all([api("solic_minhas"), pode("minhas_vagas") ? api("minhas_vagas") : Promise.resolve({ ok: true, vagas: [] })]);
    limpar(area);
    const itens = m.ok ? m.itens : [];
    const reajuste = itens.filter(i => i.status === "REAJUSTE");
    if (reajuste.length) area.append(el("div", { class: "nota ambar", style: "margin:0 0 18px" }, el("strong", null, "O RH recusou com alteração " + reajuste.length + " solicitação(ões). Corrija para ela ser analisada de novo."),
      el("a", { href: "#editar-solicitacao/" + reajuste[0].id }, "Corrigir agora →")));

    const colunas = el("div", { class: "duas" });
    const minhas = el("div", null, el("h2", { class: "sec", style: "margin-top:8px" }, el("span", null, "Minhas solicitações"), el("a", { class: "pequeno", href: "#minhas" }, "Ver todas")));
    if (!itens.length) minhas.append(el("div", { class: "vazio" }, "Você ainda não pediu nenhuma vaga. ", el("a", { href: "#solicitar" }, "Solicitar a primeira")));
    else minhas.append(el("div", { class: "card", style: "padding:0" }, el("div", { class: "lista-curta" }, itens.slice(0, 6).map(i =>
      el("a", { class: "linha", href: i.status === "REAJUSTE" ? "#editar-solicitacao/" + i.id : "#minhas" },
        el("span", null, el("b", null, i.titulo), el("span", { class: "pequeno suave" }, i.id + " · " + fmtData(i.criado_em))), pill(i.status))))));
    const vagas = (mv.ok ? (mv.vagas || mv.itens || []) : []);
    const lado = el("div", null, el("h2", { class: "sec", style: "margin-top:8px" }, el("span", null, "Vagas da minha área"), pode("minhas_vagas") ? el("a", { class: "pequeno", href: "#minhas-vagas" }, "Abrir") : null));
    if (!vagas.length) lado.append(el("div", { class: "vazio" }, "Quando o RH abrir uma vaga pedida por você, os candidatos aparecem aqui."));
    else lado.append(el("div", { class: "card", style: "padding:0" }, el("div", { class: "lista-curta" }, vagas.slice(0, 6).map(v =>
      el("a", { class: "linha", href: "#vaga/" + v.id }, el("span", null, el("b", null, v.titulo), el("span", { class: "pequeno suave" }, (v.inscritos || 0) + " inscrito(s)")), pill(v.status))))));
    colunas.append(minhas, lado);
    area.append(colunas);
    linksUteis(box);
  }

  function inicioFuncionario(box) {
    const area = el("div", null);
    box.append(area);
    viewVagasAbertasResumo(area);
    linksUteis(box);
  }

  function viewVagasAbertasResumo(box) {
    box.append(el("h2", { class: "sec", style: "margin-top:8px" }, el("span", null, "Vagas abertas para indicar"), el("a", { class: "pequeno", href: "#vagas-abertas" }, "Ver todas")));
    carregarEm(box, "vagas_abertas", {}, (area, r) => {
      if (!r.vagas.length) return area.append(el("div", { class: "vazio" }, "Não há vagas abertas no momento."));
      area.append(el("div", { class: "card", style: "padding:0" }, el("div", { class: "lista-curta" }, r.vagas.slice(0, 6).map(v =>
        el("div", { class: "linha" }, el("span", null, el("b", null, v.titulo), el("span", { class: "pequeno suave" }, [v.localidade, v.tipo_contratacao].filter(Boolean).join(" · "))),
          el("button", { type: "button", class: "bt-sec", onclick: () => copiar(v.link) }, "Copiar link"))))));
    });
  }

  // =================================================================
  //  Vagas abertas (todos)
  // =================================================================
  function viewVagasAbertas(box) {
    box.append(cabecalho("Vagas abertas", "Oportunidades publicadas no site. Copie o link para indicar alguém.",
      el("a", { class: "bt-sec", href: "/?page=central", target: "_blank", rel: "noopener" }, "Abrir site de vagas")));
    carregarEm(box, "vagas_abertas", {}, (area, r) => {
      if (!r.vagas.length) return area.append(el("div", { class: "vazio" }, "Não há vagas abertas no momento."));
      area.append(el("div", { class: "lista" }, r.vagas.map(v => el("article", { class: "card" },
        el("div", { class: "item-topo" },
          el("div", null, el("h3", null, v.titulo),
            el("div", { class: "meta" }, v.localidade ? el("span", null, v.localidade) : null, v.tipo_contratacao ? el("span", null, v.tipo_contratacao) : null,
              v.carga_horaria ? el("span", null, v.carga_horaria) : null, v.prazo ? el("span", null, "Inscrições até ", el("b", null, v.prazo)) : null)),
          el("div", { class: "acoes" },
            el("button", { type: "button", class: "bt-sec", onclick: () => copiar(v.link) }, "Copiar link"),
            el("a", { class: "bt", href: v.link, target: "_blank", rel: "noopener" }, "Abrir")))))));
    });
  }

  // =================================================================
  //  Solicitar vaga / editar solicitação (gerente e RH) — RHC-PROC-2026-002
  // =================================================================
  async function viewSolicitar(box, idEdicao) {
    const area = el("div", null, carregando());
    box.append(cabecalho(idEdicao ? "Corrigir solicitação " + idEdicao : "Solicitar vaga",
      idEdicao ? "Ajuste o que o RH pediu e reenvie." :
        "Preencha com clareza. O RH analisa, pode chamar você para uma reunião de alinhamento e, depois do acordo com Financeiro e Engenharia, abre a vaga.",
      null, idEdicao ? ["#minhas", "Minhas solicitações"] : null), area);

    const op = await opcoes();
    let pre = estadoPrefill || {};
    estadoPrefill = null;
    if (idEdicao) {
      const r = await api(pode("solic_listar") ? "solic_listar" : "solic_minhas");
      pre = (r.ok ? r.itens : []).find(i => i.id === idEdicao);
      if (!pre) { limpar(area); return area.append(msg("erro", "Solicitação não encontrada.")); }
      if (pre.status !== "REAJUSTE") {
        limpar(area);
        return area.append(msg("info", pre.status === "PENDENTE"
          ? "Esta solicitação já foi enviada ao RH e não pode ser alterada. Ela só volta para correção se o RH recusar com alteração."
          : "Esta solicitação não pode mais ser alterada."));
      }
    }
    limpar(area);

    const v = k => pre[k] == null ? "" : pre[k];
    const c = (rot, ctrl, o) => campo(rot, ctrl, Object.assign({ nome: ctrl.name || (ctrl[0] && ctrl[0].name) }, o || {}));
    const depNomes = op.departamentos.map(d => d.nome);

    const form = el("form", { novalidate: true },
      el("section", { class: "card bloco" },
        el("h2", null, "1. A vaga"),
        el("p", null, "Use um título claro, que represente a função. Ex.: Estágio em Engenharia Mecânica, Analista Financeiro Pleno."),
        el("div", { class: "campos" },
          c("Departamento", seletor("departamento", depNomes, v("departamento")), { obrigatorio: true }),
          c("Título do cargo", entrada("titulo", v("titulo"), { placeholder: "Ex.: Estágio em Engenharia de Software" }), { obrigatorio: true }),
          c("Quantidade de vagas", entrada("quantidade", v("quantidade") || 1, { type: "number", min: "1" }), { obrigatorio: true }),
          c("Data limite de inscrição", entrada("data_limite", v("data_limite"), { type: "date" }), { obrigatorio: true }),
          c("Localidade", entrada("localidade", v("localidade"), { placeholder: "Cidade/UF" }), { obrigatorio: true }),
          c("Tipo da vaga", seletor("tipo_vaga", lista(op, "tipo_vaga"), v("tipo_vaga"))),
          c("Tipo de contratação", seletor("tipo_contratacao", lista(op, "tipo_contratacao"), v("tipo_contratacao")), { obrigatorio: true,
            dica: "Estágio: acompanhamento constante. CLT: autonomia moderada. PJ: lidera soluções e decisões." }),
          campo("Carga horária", el("div", null, comLista(entrada("carga_horaria", v("carga_horaria"), { placeholder: "Ex.: 20 horas semanais" }), lista(op, "horario"))), { obrigatorio: true, nome: "carga_horaria" }),
          c("Remuneração / Bolsa", entrada("remuneracao", v("remuneracao"), { placeholder: "Ex.: Bolsa de R$ 700,00" }), { obrigatorio: true, largo: true,
            dica: "Considere a complexidade da função, a experiência esperada, o mercado e o budget. O valor final é alinhado entre RH, Financeiro e Engenharia." }))),
      el("section", { class: "card bloco" },
        el("h2", null, "2. Perfil e atividades"),
        el("p", null, "Separe o que é obrigatório do que é diferencial. Isso deixa a triagem mais justa e rápida."),
        el("div", { class: "campos" },
          c("Descrição geral da oportunidade", areaTexto("descricao", v("descricao"), { placeholder: "Atividades, problemas que a pessoa vai ajudar a resolver, com quem vai trabalhar, ferramentas e impacto." }), { obrigatorio: true, largo: true }),
          c("Habilidades técnicas obrigatórias", areaTexto("habilidades_obrigatorias", v("habilidades_obrigatorias"), { placeholder: "Uma por linha" }), { obrigatorio: true }),
          c("Habilidades técnicas diferenciais", areaTexto("habilidades_diferenciais", v("habilidades_diferenciais"), { placeholder: "Uma por linha" })),
          c("Principais funções e atividades", areaTexto("principais_funcoes", v("principais_funcoes"), { placeholder: "Uma por linha" }), { obrigatorio: true, largo: true }),
          c("Competências comportamentais desejadas", areaTexto("competencias", v("competencias"), { placeholder: "Pense na rotina da equipe. Ex.: organização, comunicação, autonomia." }), { largo: true }))),
      el("section", { class: "card bloco" },
        el("h2", null, "3. Contexto"),
        el("div", { class: "campos" },
          c("Motivo da solicitação", seletor("motivo", ["Aumento de demanda", "Substituição de profissional", "Criação de cargo", "Novo projeto", "Outro"], v("motivo")), { obrigatorio: true }),
          c("Urgência", seletor("urgencia", ["Baixa", "Média", "Alta"], v("urgencia"))),
          c("Gestor responsável", entrada("gestor_responsavel", v("gestor_responsavel") || U.nome), { obrigatorio: true }),
          c("Observações gerais", areaTexto("observacoes", v("observacoes"), { placeholder: "Prazo previsto para contratação, informações para o RH etc." }), { largo: true })),
        idEdicao ? null : el("label", { class: "check", style: "margin-top:16px", dataset: { campo: "concordancia" } },
          el("input", { type: "checkbox", name: "concordancia" }),
          el("span", null, "Declaro que as informações são verdadeiras e que a necessidade desta contratação foi alinhada com a minha área."))),
      el("div", { id: "solMsg" }),
      el("div", { class: "acoes", style: "margin-top:16px" }, el("button", { type: "submit", class: "bt", id: "solEnviar" }, idEdicao ? "Reenviar ao RH" : "Enviar solicitação ao RH")));

    const dicas = el("aside", { class: "card dicas" },
      el("h3", null, "Antes de enviar"),
      el("ul", null, ["Informe as prioridades reais e a urgência da contratação.", "Diferencie requisitos obrigatórios de desejáveis.",
        "Evite exigir tecnologias desnecessárias ou incompatíveis com o nível da vaga.", "Não misture cargos diferentes em uma mesma solicitação.",
        "Informe a faixa salarial e o motivo da vaga."].map(t => el("li", null, t))),
      el("p", { class: "pequeno suave", style: "margin:12px 0 0" }, "Você recebe por e-mail a decisão do RH."));
    area.append(el("div", { class: "form-grade" }, form, dicas));

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const d = lerForm(form);
      const obrig = ["departamento", "titulo", "quantidade", "data_limite", "localidade", "tipo_contratacao", "carga_horaria", "remuneracao",
        "descricao", "habilidades_obrigatorias", "principais_funcoes", "motivo", "gestor_responsavel"];
      const falta = obrig.filter(k => !String(d[k] || "").trim());
      if (!idEdicao && !d.concordancia) falta.push("concordancia");
      const solMsg = $("solMsg");
      limpar(solMsg);
      if (falta.length) { marcarFaltando(form, falta); return solMsg.append(msg("erro", "Preencha os campos obrigatórios marcados.")); }
      const bt = $("solEnviar");
      bt.disabled = true;
      const r = await api(idEdicao ? "solic_editar" : "solic_criar", Object.assign(d, idEdicao ? { id: idEdicao } : {}));
      bt.disabled = false;
      if (!r.ok) return solMsg.append(msg("erro", r.erro || "Não foi possível enviar."));
      limpar(box);
      box.append(cabecalho(idEdicao ? "Solicitação reenviada" : "Solicitação enviada"), el("div", { class: "card" },
        el("p", { style: "margin-top:0" }, "Solicitação ", el("b", null, r.id), idEdicao ? " reenviada para análise do RH." : " registrada e enviada para análise."),
        el("div", { class: "nota verde" }, el("strong", null, "Próximos passos"),
          "1. O RH analisa descrição, requisitos, salário, prazo e tipo de contrato.\n2. Se houver dúvidas, o RH agenda uma reunião de alinhamento com você.\n" +
          "3. RH, Financeiro e Engenharia alinham faixa salarial, budget e prioridade.\n4. Com tudo aprovado, a vaga é aberta e publicada."),
        el("div", { class: "acoes", style: "margin-top:16px" }, el("a", { class: "bt", href: "#minhas" }, "Ver minhas solicitações"))));
    });
  }

  function cartaoSolicitacao(i, rh) {
    const hist = i.historico || [];
    const ultimaNota = hist.filter(h => h.texto).pop();
    const reqs = [i.habilidades_obrigatorias ? "Obrigatórias:\n" + i.habilidades_obrigatorias : "", i.habilidades_diferenciais ? "Diferenciais:\n" + i.habilidades_diferenciais : ""].filter(Boolean).join("\n\n");
    return el("article", { class: "card", id: "sol-" + i.id },
      el("div", { class: "item-topo" },
        el("div", null, el("h3", null, i.titulo),
          el("div", { class: "meta" }, el("span", null, el("b", null, i.id)), el("span", null, i.departamento), el("span", null, i.quantidade + " vaga(s)"),
            rh ? el("span", null, "Por ", el("b", null, i.solicitante_nome)) : null, el("span", null, fmtData(i.criado_em)),
            i.urgencia ? el("span", null, "Urgência ", el("b", null, i.urgencia)) : null)),
        pill(i.status)),
      i.status === "REAJUSTE" && ultimaNota ? el("div", { class: "nota ambar" }, el("strong", null, "Recusada com alteração — o que o RH pediu"), ultimaNota.texto) : null,
      i.status === "RECUSADA" && ultimaNota ? el("div", { class: "nota verm" }, el("strong", null, "Motivo da recusa"), ultimaNota.texto) : null,
      i.vaga_id ? el("div", { class: "nota azul" }, "Vaga criada: ", el("a", { href: "#vaga/" + i.vaga_id }, i.vaga_id)) : null,
      el("details", { class: "mais", open: rh && location.hash === "#solicitacao/" + i.id }, el("summary", null, "Ver todos os dados"),
        dados([["Gestor responsável", i.gestor_responsavel], ["Solicitante", i.solicitante_nome + " — " + i.solicitante_email],
          ["Localidade", i.localidade], ["Tipo da vaga", i.tipo_vaga], ["Tipo de contratação", i.tipo_contratacao], ["Carga horária", i.carga_horaria],
          ["Remuneração / bolsa", i.remuneracao], ["Inscrições até", fmtData(i.data_limite)], ["Descrição", i.descricao], ["Habilidades", reqs],
          ["Principais funções", i.principais_funcoes], ["Competências", i.competencias], ["Motivo", i.motivo], ["Observações", i.observacoes]]),
        hist.length ? el("div", { style: "margin-top:12px" }, el("b", { class: "pequeno" }, "Histórico"),
          el("ul", { class: "pequeno suave", style: "margin:6px 0 0" }, hist.map(h => el("li", null, fmtData(h.quando, true) + " — " + h.acao + " (" + h.quem.replace(/ <.*>$/, "") + ")" + (h.texto ? ": " + h.texto : ""))))) : null),
      el("div", { class: "item-acoes acoes" },
        rh && i.status === "PENDENTE" ? [
          el("button", { type: "button", class: "bt", onclick: () => decidirSolic(i, "aprovar") }, "Aprovar"),
          el("button", { type: "button", class: "bt-alerta", onclick: () => decidirSolic(i, "reajuste") }, "Recusar com alteração"),
          el("button", { type: "button", class: "bt-perigo", onclick: () => decidirSolic(i, "recusar") }, "Recusar")] : null,
        rh && i.status === "APROVADA" ? el("a", { class: "bt", href: "#vaga-de-solicitacao/" + i.id }, "Criar vaga") : null,
        // Depois de enviada, só volta para alteração se o RH recusar com alteração
        !rh && i.status === "REAJUSTE" ? el("a", { class: "bt", href: "#editar-solicitacao/" + i.id }, "Corrigir e reenviar") : null,
        !rh && i.status === "PENDENTE" ? el("span", { class: "pequeno suave" }, "Enviada ao RH. Não pode ser alterada enquanto aguarda a análise.") : null,
        !rh ? el("button", { type: "button", class: "bt-sec", onclick: () => { estadoPrefill = i; location.hash = "#solicitar"; } }, "Usar como base") : null));
  }

  async function decidirSolic(i, tipo) {
    const t = { aprovar: ["Aprovar", "bt", "Observação para o gestor (opcional)", "Confirme que o alinhamento com o gestor e com Financeiro/Engenharia (faixa salarial, budget, modelo de contratação e prioridade) foi feito."],
      reajuste: ["Recusar com alteração", "bt-alerta", "O que o gestor precisa alterar? Ele recebe este texto por e-mail.", "A solicitação volta para o gestor, que corrige e reenvia. Só assim ela pode ser alterada."],
      recusar: ["Recusar", "bt-perigo", "Motivo da recusa", "A solicitação será encerrada."] }[tipo];
    const txt = el("textarea", { placeholder: t[2] });
    const ok = await dialogo({
      titulo: t[0] + ": " + i.titulo, okTexto: t[0], okClasse: t[1],
      corpo: el("div", null, el("p", { class: "suave", style: "margin:0 0 10px" }, t[3]), txt),
      aoConfirmar: async () => {
        if (tipo !== "aprovar" && txt.value.trim().length < 5) return "Escreva o motivo para o gestor.";
        const r = await api("solic_decidir", { id: i.id, decisao: tipo, comentario: txt.value.trim() });
        if (!r.ok) return r.erro;
        toast("Solicitação " + i.id + ": " + t[0].toLowerCase() + ".");
        return true;
      }
    });
    if (ok && tipo === "aprovar") {
      const criar = await dialogo({ titulo: "Criar a vaga agora?", corpo: el("p", { style: "margin:0" }, "O formulário da vaga abre já preenchido com os dados da solicitação."), okTexto: "Criar vaga" });
      if (criar) { location.hash = "#vaga-de-solicitacao/" + i.id; return; }
    }
    if (ok) recarregar();
  }

  function viewMinhas(box) {
    box.append(cabecalho("Minhas solicitações", "Pedidos feitos com o seu e-mail (" + U.email + ").", el("a", { class: "bt", href: "#solicitar" }, "Nova solicitação")));
    carregarEm(box, "solic_minhas", {}, (area, r) => {
      if (!r.itens.length) return area.append(el("div", { class: "vazio" }, "Você ainda não fez nenhuma solicitação."));
      area.append(el("div", { class: "lista" }, r.itens.map(i => cartaoSolicitacao(i, false))));
    });
  }

  function viewSolicitacoes(box, abrirId) {
    box.append(cabecalho("Solicitações de contratação", "Confira descrição, requisitos, salário, prazo e tipo de contrato antes de aprovar."));
    carregarEm(box, "solic_listar", {}, (area, r) => {
      const grupo = i => ({ PENDENTE: "aguardando", REAJUSTE: "reajuste", APROVADA: "aprovada", VAGA_CRIADA: "criada", RECUSADA: "recusada" })[i.status];
      listaFiltrada(area, r.itens, {
        inicial: abrirId ? "todas" : (r.itens.some(i => i.status === "PENDENTE") ? "aguardando" : "todas"),
        filtros: [["aguardando", "Aguardando"], ["reajuste", "Com o gestor (alteração)"], ["aprovada", "Aprovadas"], ["criada", "Vaga criada"], ["recusada", "Recusadas"], ["todas", "Todas"]],
        grupo, placeholder: "Buscar por cargo, departamento, solicitante ou ID",
        texto: i => [i.id, i.titulo, i.departamento, i.solicitante_nome, i.solicitante_email].join(" "),
        desenhar: (alvo, vis) => vis.forEach(i => alvo.append(cartaoSolicitacao(i, true)))
      });
      if (abrirId) setTimeout(() => { const c = $("sol-" + abrirId); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
    });
  }

  // =================================================================
  //  Vagas
  // =================================================================
  function tabelaVagas(area, vagas, rh) {
    listaFiltrada(area, vagas, {
      filtros: [["todas", "Todas"], ["Aberta", "Abertas"], ["Pausada", "Pausadas"], ["Fechada", "Fechadas"], ["Concluída", "Concluídas"]],
      grupo: v => v.status, placeholder: "Buscar por título, ID, departamento ou localidade",
      texto: v => [v.id, v.titulo, v.departamento, v.localidade].join(" "),
      desenhar: (alvo, vis) => alvo.append(el("div", { class: "rolagem" }, el("table", { class: "tabela" },
        el("thead", null, el("tr", null, ["Vaga", "Status", "Inscrições até", "Inscritos", "Em processo", ""].map(t => el("th", null, t)))),
        el("tbody", null, vis.map(v => el("tr", null,
          el("td", { class: "titulo", "data-rotulo": "Vaga" }, el("a", { href: "#vaga/" + v.id, style: "text-decoration:none" }, el("b", null, v.titulo)),
            el("span", { class: "mini" }, v.id + (v.departamento ? " · " + v.departamento : ""))),
          el("td", { "data-rotulo": "Status" }, pill(v.status), v.status === "Aberta" && !v.aberta_site ? el("div", { class: "mini" }, "Prazo vencido") : null),
          el("td", { "data-rotulo": "Inscrições até" }, fmtData(v.data_limite) || "—"),
          el("td", { "data-rotulo": "Inscritos" }, String(v.inscritos)),
          el("td", { "data-rotulo": "Em processo" }, String(v.em_processo) + (v.contratados ? " · " + v.contratados + " contratado(s)" : "")),
          el("td", { "data-rotulo": "" }, el("div", { class: "acoes" },
            el("a", { class: "bt-sec", href: "#vaga/" + v.id }, "Candidatos"),
            rh ? el("a", { class: "bt-sec", href: "#vaga-form/" + v.id }, "Editar") : null,
            v.aberta_site ? el("button", { type: "button", class: "bt-sec", onclick: () => copiar(v.link_publico) }, "Copiar link") : null)))))))),
      vazio: "Nenhuma vaga neste filtro."
    });
  }

  function viewVagas(box) {
    box.append(cabecalho("Vagas", "Somente vagas Abertas e com prazo em dia aparecem no site. Vagas vencidas são fechadas automaticamente toda madrugada.",
      el("a", { class: "bt", href: "#vaga-form/nova" }, "Nova vaga")));
    carregarEm(box, "vagas_todas", {}, (area, r) => {
      if (!r.vagas.length) return area.append(el("div", { class: "vazio" }, "Nenhuma vaga ainda. Crie a partir de uma solicitação aprovada ou em \"Nova vaga\"."));
      tabelaVagas(area, r.vagas, true);
    });
  }

  function viewMinhasVagas(box) {
    box.append(cabecalho("Vagas da minha área", "Vagas abertas a partir das suas solicitações ou em que você é o gestor responsável."));
    carregarEm(box, "minhas_vagas", {}, (area, r) => {
      if (!r.vagas.length) return area.append(el("div", { class: "vazio" }, "Nenhuma vaga da sua área ainda."));
      tabelaVagas(area, r.vagas, false);
    });
  }

  async function viewVagaForm(box, idEdicao, solicitacaoId) {
    const novo = !idEdicao || idEdicao === "nova";
    const area = el("div", null, carregando());
    box.append(cabecalho(novo ? "Nova vaga" : "Editar vaga " + idEdicao,
      solicitacaoId ? "Dados trazidos da solicitação " + solicitacaoId + ". Revise antes de publicar." : "A vaga aparece no site assim que for salva com status Aberta.",
      null, ["#vagas", "Vagas"]), area);

    const op = await opcoes();
    let v = { status: "Aberta", quantidade: 1, etapas: lista(op, "etapa").length ? lista(op, "etapa") : ["Triagem"] };
    if (!novo) {
      const r = await api("vaga_detalhe", { id: idEdicao });
      if (!r.ok) { limpar(area); return area.append(msg("erro", r.erro)); }
      v = r.vaga;
    } else if (solicitacaoId) {
      const r = await api("solic_listar");
      const s = (r.ok ? r.itens : []).find(x => x.id === solicitacaoId);
      if (!s) { limpar(area); return area.append(msg("erro", "Solicitação não encontrada.")); }
      const dep = op.departamentos.find(d => d.nome === s.departamento) || {};
      v = Object.assign(v, {
        titulo: s.titulo, departamento: s.departamento, gestor_nome: dep.gestor_nome || s.gestor_responsavel, gestor_email: dep.gestor_email || s.solicitante_email,
        quantidade: s.quantidade, data_limite: s.data_limite, localidade: s.localidade, tipo_vaga: s.tipo_vaga, tipo_contratacao: s.tipo_contratacao,
        carga_horaria: s.carga_horaria, remuneracao: s.remuneracao, descricao: s.descricao,
        requisitos: [s.habilidades_obrigatorias, s.habilidades_diferenciais ? "Diferenciais:\n" + s.habilidades_diferenciais : ""].filter(Boolean).join("\n\n"),
        principais_funcoes: s.principais_funcoes
      });
    }
    limpar(area);

    const g = k => v[k] == null ? "" : v[k];
    const c = (rot, ctrl, o) => campo(rot, ctrl, Object.assign({ nome: ctrl.name }, o || {}));
    const depSel = seletor("departamento", op.departamentos.map(d => d.nome), g("departamento"));
    const form = el("form", { novalidate: true },
      el("section", { class: "card bloco" },
        el("h2", null, "Dados da vaga"),
        el("div", { class: "campos" },
          c("Título", entrada("titulo", g("titulo")), { obrigatorio: true, largo: true }),
          c("Status", seletor("status", ["Aberta", "Pausada", "Fechada", "Concluída"], g("status"), false)),
          c("Inscrições até", entrada("data_limite", g("data_limite"), { type: "date" }), { obrigatorio: true }),
          c("Departamento", depSel),
          c("Quantidade de vagas", entrada("quantidade", g("quantidade"), { type: "number", min: "1" })),
          c("Gestor responsável", entrada("gestor_nome", g("gestor_nome"))),
          c("E-mail do gestor", entrada("gestor_email", g("gestor_email"), { type: "email" }), { dica: "Recebe avisos e vê os candidatos no painel." }),
          c("Localidade", entrada("localidade", g("localidade")), { obrigatorio: true }),
          c("Tipo da vaga", seletor("tipo_vaga", lista(op, "tipo_vaga"), g("tipo_vaga"))),
          c("Tipo de contratação", seletor("tipo_contratacao", lista(op, "tipo_contratacao"), g("tipo_contratacao")), { obrigatorio: true }),
          campo("Carga horária", el("div", null, comLista(entrada("carga_horaria", g("carga_horaria")), lista(op, "horario"))), { obrigatorio: true, nome: "carga_horaria" }),
          c("Remuneração / bolsa", entrada("remuneracao", g("remuneracao")), { largo: true }))),
      el("section", { class: "card bloco" },
        el("h2", null, "Texto publicado no site"),
        el("div", { class: "campos" },
          c("Sobre a oportunidade", areaTexto("descricao", g("descricao")), { obrigatorio: true, largo: true }),
          c("Requisitos", areaTexto("requisitos", g("requisitos"), { placeholder: "Um por linha" }), { obrigatorio: true, largo: true }),
          c("Principais funções e atividades", areaTexto("principais_funcoes", g("principais_funcoes"), { placeholder: "Uma por linha" }), { obrigatorio: true, largo: true }))),
      el("section", { class: "card bloco" },
        el("h2", null, "Etapas do processo seletivo"),
        el("p", null, "Uma por linha, na ordem. A primeira é sempre Triagem. Mudanças valem para as próximas inscrições."),
        campo("Etapas", areaTexto("etapas", (v.etapas || []).join("\n"), { style: "min-height:150px" }), { largo: true, dica: "Sugestões: " + lista(op, "etapa").join(", ") })),
      el("div", { id: "vagaMsg" }),
      el("div", { class: "acoes", style: "margin-top:16px" }, el("button", { type: "submit", class: "bt", id: "vagaSalvar" }, novo ? "Publicar vaga" : "Salvar alterações")));
    area.append(form);

    depSel.addEventListener("change", () => {
      const d = op.departamentos.find(x => x.nome === depSel.value);
      if (!d) return;
      const gn = form.querySelector("[name=gestor_nome]"), ge = form.querySelector("[name=gestor_email]");
      if (!gn.value) gn.value = d.gestor_nome;
      if (!ge.value) ge.value = d.gestor_email;
    });

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const d = lerForm(form);
      const falta = ["titulo", "data_limite", "localidade", "tipo_contratacao", "carga_horaria", "descricao", "requisitos", "principais_funcoes"].filter(k => !String(d[k] || "").trim());
      limpar($("vagaMsg"));
      if (falta.length) { marcarFaltando(form, falta); return $("vagaMsg").append(msg("erro", "Preencha os campos obrigatórios marcados.")); }
      d.etapas = String(d.etapas || "").split("\n").map(x => x.trim()).filter(Boolean);
      if (!novo) d.id = idEdicao;
      if (solicitacaoId) d.solicitacao_id = solicitacaoId;
      const bt = $("vagaSalvar");
      bt.disabled = true;
      const r = await api("vaga_salvar", d);
      bt.disabled = false;
      if (!r.ok) return $("vagaMsg").append(msg("erro", r.erro));
      toast(novo ? "Vaga " + r.id + " publicada." : "Vaga atualizada.");
      location.hash = "#vaga/" + r.id;
    });
  }

  async function viewVagaDetalhe(box, id) {
    const r = await (async () => { const a = el("div", null, carregando()); box.append(a); const x = await api("vaga_detalhe", { id }); a.remove(); return x; })();
    if (!r.ok) return box.append(msg("erro", r.erro || "Não foi possível carregar a vaga."));
    const v = r.vaga;
    const rh = r.podeEditar;
    box.append(cabecalho(v.titulo, null, rh ? [
      el("a", { class: "bt-sec", href: "#vaga-form/" + v.id }, "Editar vaga"),
      v.aberta_site ? el("button", { type: "button", class: "bt-sec", onclick: () => copiar(v.link_publico) }, "Copiar link") : null,
      el("a", { class: "bt-sec", href: v.link_publico, target: "_blank", rel: "noopener" }, "Ver no site")] : null,
      pode("vagas_todas") ? ["#vagas", "Vagas"] : ["#minhas-vagas", "Vagas da minha área"]));
    box.append(el("div", { class: "card" },
      el("div", { class: "meta" }, el("span", null, el("b", null, v.id)), pill(v.status), el("span", null, "Inscrições até ", el("b", null, fmtData(v.data_limite) || "—")),
        el("span", null, v.departamento), v.gestor_nome ? el("span", null, "Gestor: " + v.gestor_nome) : null,
        el("span", null, v.inscritos + " inscrito(s)"), el("span", null, v.quantidade + " vaga(s)")),
      el("p", { class: "pequeno suave", style: "margin:10px 0 0" }, "Etapas: " + v.etapas.join(" → "))));

    box.append(el("h2", { class: "sec" }, "Candidatos"));
    if (!r.candidatos.length) return box.append(el("div", { class: "vazio" }, "Nenhum candidato inscrito ainda."));
    const area = el("div");
    box.append(area);
    const grupo = c => c.status === "Em processo" ? "processo" : c.status === "Aprovado" || c.status === "Proposta" || c.status === "Contratado" ? "aprovados" : "encerrados";
    listaFiltrada(area, r.candidatos, {
      inicial: "processo",
      filtros: [["processo", "Em processo"], ["aprovados", "Aprovados e propostas"], ["encerrados", "Encerrados"], ["todas", "Todos"]],
      grupo, placeholder: "Buscar candidato", texto: c => [c.nome, c.email, c.id].join(" "),
      desenhar: (alvo, vis) => alvo.append(el("div", { class: "rolagem" }, el("table", { class: "tabela" },
        el("thead", null, el("tr", null, ["Candidato", "Inscrição", "Etapa atual", "Situação", ""].map(t => el("th", null, t)))),
        el("tbody", null, vis.map(c => el("tr", null,
          el("td", { class: "titulo", "data-rotulo": "Candidato" }, el("b", null, c.nome), el("span", { class: "mini" }, c.email)),
          el("td", { "data-rotulo": "Inscrição" }, fmtData(c.criado_em)),
          el("td", { "data-rotulo": "Etapa atual" }, c.status === "Em processo" ? c.etapa_atual : "—"),
          el("td", { "data-rotulo": "Situação" }, pill(c.status), c.admissao_status ? el("div", { class: "mini" }, (STATUS[c.admissao_status] || [c.admissao_status])[0]) : null),
          el("td", { "data-rotulo": "" }, el("button", { type: "button", class: "bt-sec", onclick: () => abrirCandidato(c, v, rh) }, "Abrir")))))))),
      vazio: "Nenhum candidato neste filtro."
    });
  }

  function abrirCandidato(c, vaga, rh) {
    const corpo = el("div", null,
      dados([["E-mail", c.email], ["Telefone", c.telefone], ["Período", c.periodo_curso], ["Previsão de formatura", c.previsao_formatura],
        ["Inscrição", fmtData(c.criado_em, true)], ["Mensagem", c.mensagem], ["Observação do RH", c.obs]]),
      el("div", { class: "acoes", style: "margin:14px 0" },
        c.curriculo_id ? el("a", { class: "bt-sec", href: "/arquivo/" + c.curriculo_id, target: "_blank", rel: "noopener" }, "Abrir currículo (PDF)") : null,
        rh && c.admissao_id ? el("a", { class: "bt-sec", href: "#admissao/" + c.admissao_id }, "Ver admissão") : null,
        rh && !c.admissao_id && ["Em processo", "Aprovado"].indexOf(c.status) >= 0 ? el("button", { type: "button", class: "bt", onclick: () => abrirProposta(c, vaga) }, "Enviar proposta") : null,
        rh && ["Em processo", "Aprovado"].indexOf(c.status) >= 0 ? el("button", { type: "button", class: "bt-sec", onclick: () => marcarDesistencia(c) }, "Registrar desistência") : null),
      el("h3", { style: "margin:6px 0 8px;font-size:15px" }, "Etapas"),
      el("div", { class: "rolagem" }, el("table", { class: "tabela" },
        el("thead", null, el("tr", null, ["Etapa", "Resultado", "Detalhes", ""].map(t => el("th", null, t)))),
        el("tbody", null, c.etapas.map(e => el("tr", null,
          el("td", { "data-rotulo": "Etapa" }, el("b", null, e.ordem + ". " + e.nome)),
          el("td", { "data-rotulo": "Resultado" }, pill(e.resultado)),
          el("td", { "data-rotulo": "Detalhes", class: "pequeno" },
            [e.data_prevista ? "Prevista " + fmtData(e.data_prevista) : "", e.data_realizada ? "Realizada " + fmtData(e.data_realizada) : "",
              e.responsavel ? "Resp.: " + e.responsavel : "", e.motivo ? "Motivo: " + e.motivo : "", e.notificado_em ? "E-mail enviado em " + fmtData(e.notificado_em, true) : ""]
              .filter(Boolean).join(" · ") || "—"),
          el("td", { "data-rotulo": "" }, rh ? el("button", { type: "button", class: "bt-sec", onclick: () => editarEtapa(e, c) }, "Registrar") : null)))))));
    dialogo({ titulo: c.nome + " — " + vaga.titulo, corpo, semOk: true, largo: true });
  }

  async function editarEtapa(e, c) {
    const f = el("form", { novalidate: true },
      el("div", { class: "campos" },
        campo("Resultado", seletor("resultado", ["Pendente", "Aprovado", "Reprovado"], e.resultado, false)),
        campo("Responsável", entrada("responsavel", e.responsavel || U.nome)),
        campo("Data prevista", entrada("data_prevista", e.data_prevista, { type: "date" })),
        campo("Data realizada", entrada("data_realizada", e.data_realizada, { type: "date" })),
        campo("Motivo (obrigatório para reprovar — vai como retorno ao candidato)", areaTexto("motivo", e.motivo), { largo: true }),
        campo("Mensagem de aprovação (opcional — substitui o texto padrão do e-mail)", areaTexto("mensagem", e.mensagem), { largo: true }),
        campo("Observações internas", areaTexto("obs", e.obs), { largo: true })),
      el("label", { class: "check", style: "margin-top:12px" }, el("input", { type: "checkbox", name: "enviar_email", checked: !e.notificado_em }),
        el("span", null, "Enviar e-mail ao candidato com o resultado" + (e.notificado_em ? " (já enviado em " + fmtData(e.notificado_em, true) + ")" : ""))));
    await dialogo({
      titulo: e.nome + " — " + c.nome, corpo: f, okTexto: "Salvar etapa", largo: true,
      aoConfirmar: async () => {
        const d = lerForm(f);
        if (d.resultado === "Reprovado" && d.motivo.trim().length < 5) return "Para reprovar, escreva o motivo (feedback obrigatório).";
        const r = await api("etapa_atualizar", Object.assign(d, { etapa_id: e.id }));
        if (!r.ok) return r.erro;
        toast("Etapa registrada" + (d.enviar_email && d.resultado !== "Pendente" ? " e e-mail enviado." : "."));
        return true;
      }
    }) && recarregar();
  }

  async function marcarDesistencia(c) {
    const obs = el("textarea", { placeholder: "Observação (opcional)" });
    await dialogo({
      titulo: "Registrar desistência de " + c.nome, corpo: obs, okTexto: "Registrar", okClasse: "bt-perigo",
      aoConfirmar: async () => {
        const r = await api("candidatura_status", { id: c.id, status: "Desistiu", obs: obs.value });
        if (!r.ok) return r.erro;
        toast("Desistência registrada.");
        return true;
      }
    }) && recarregar();
  }

  async function abrirProposta(c, vaga) {
    const op = await opcoes();
    const deps = op.departamentos.map(d => d.nome);
    const f = el("form", { novalidate: true },
      el("p", { class: "suave", style: "margin:0 0 12px" }, "Revisão obrigatória: confira se tudo pertence ao candidato correto e à contratação autorizada. A data de início é a mesma do onboarding."),
      el("div", { class: "campos" },
        campo("E-mail pessoal do candidato (não pode ser IdUFF)", entrada("email_contato", c.email, { type: "email" }), { obrigatorio: true, largo: true, nome: "email_contato" }),
        campo("Tipo de contratação", seletor("tipo_contratacao", lista(op, "tipo_contratacao"), vaga.tipo_contratacao), { obrigatorio: true, nome: "tipo_contratacao" }),
        campo("Situação", seletor("situacao", lista(op, "situacao"), "")),
        campo("Cargo", el("div", null, comLista(entrada("cargo", ""), lista(op, "cargo"))), { obrigatorio: true, nome: "cargo" }),
        campo("Função", el("div", null, comLista(entrada("funcao", vaga.titulo), lista(op, "funcao"))), { obrigatorio: true, nome: "funcao" }),
        campo("Departamento", el("div", null, comLista(entrada("departamento", vaga.departamento), deps)), { obrigatorio: true, nome: "departamento" }),
        campo("Setor", el("div", null, comLista(entrada("setor", ""), lista(op, "setor")))),
        campo("Horário de trabalho", el("div", null, comLista(entrada("horario_trabalho", vaga.carga_horaria), lista(op, "horario"))), { obrigatorio: true, nome: "horario_trabalho" }),
        campo("Data de início (onboarding)", entrada("data_inicio", "", { type: "date" }), { obrigatorio: true, nome: "data_inicio" }),
        campo("Bolsa / remuneração", entrada("bolsa_valor", vaga.remuneracao), { obrigatorio: true, nome: "bolsa_valor" }),
        campo("Auxílio", seletor("auxilio", lista(op, "auxilio"), "")),
        campo("Responsável", entrada("responsavel", vaga.gestor_nome)),
        campo("Entidade vinculada", entrada("entidade_vinculada", "")),
        campo("Início da bolsa", entrada("data_inicial_bolsa", "", { type: "date" })),
        campo("Fim da bolsa / contrato", entrada("data_final_bolsa", "", { type: "date" }), { dica: "Se vazio, o contrato vale 1 ano a partir do início." }),
        campo("Gestor", entrada("gestor_nome", vaga.gestor_nome)),
        campo("E-mail do gestor", entrada("gestor_email", vaga.gestor_email, { type: "email" })),
        campo("Observação interna", areaTexto("observacao", ""), { largo: true })),
      el("label", { class: "check", style: "margin-top:12px", dataset: { campo: "conferido" } }, el("input", { type: "checkbox", name: "conferido" }),
        el("span", null, "Conferi todas as informações antes de enviar.")));
    await dialogo({
      titulo: "Proposta para " + c.nome, corpo: f, okTexto: "Enviar proposta", largo: true,
      aoConfirmar: async () => {
        const d = lerForm(f);
        const falta = ["email_contato", "tipo_contratacao", "cargo", "funcao", "departamento", "horario_trabalho", "data_inicio", "bolsa_valor"].filter(k => !String(d[k] || "").trim());
        if (!d.conferido) falta.push("conferido");
        if (falta.length) { marcarFaltando(f, falta); return "Preencha os campos obrigatórios e confirme a conferência."; }
        if (/@id\.uff\.br$/i.test(d.email_contato)) return "Não é permitido enviar proposta para e-mail @id.uff.br.";
        const email = d.email_contato;
        delete d.email_contato; delete d.conferido;
        const r = await api("proposta_criar", { candidatura_id: c.id, email_contato: email, proposta: d });
        if (!r.ok) return r.erro;
        toast("Proposta " + r.id + " enviada.");
        return true;
      }
    }) && recarregar();
  }

  // =================================================================
  //  Admissões (RHC-PROC-2026-003)
  // =================================================================
  function viewAdmissoes(box) {
    box.append(cabecalho("Admissões", "Envie propostas pela vaga (Candidatos → Enviar proposta). Toda ação automática deve ser conferida pelo RH."));
    carregarEm(box, "adm_listar", {}, (area, r) => {
      const grupo = i => ({ AGUARDANDO_APROVACAO: "conferir", PROPOSTA_ENVIADA: "andamento", COMPLETANDO_CADASTRO: "andamento", CORRECAO_SOLICITADA: "andamento",
        APROVADA: "aprovadas", PROPOSTA_RECUSADA: "encerradas", RECUSADA: "encerradas" })[i.status];
      if (!r.itens.length) return area.append(el("div", { class: "vazio" }, "Nenhuma admissão ainda. Envie uma proposta a partir dos candidatos de uma vaga."));
      listaFiltrada(area, r.itens, {
        inicial: r.itens.some(i => i.status === "AGUARDANDO_APROVACAO") ? "conferir" : "todas",
        filtros: [["conferir", "Para conferir"], ["andamento", "Em andamento"], ["aprovadas", "Aprovadas"], ["encerradas", "Encerradas"], ["todas", "Todas"]],
        grupo, placeholder: "Buscar por candidato, vaga ou ID", texto: i => [i.id, i.candidato_nome, i.email_contato, i.titulo_vaga].join(" "),
        desenhar: (alvo, vis) => vis.forEach(i => alvo.append(el("a", { class: "card atalho", href: "#admissao/" + i.id },
          el("div", { class: "item-topo" },
            el("div", null, el("h3", null, i.candidato_nome),
              el("div", { class: "meta" }, el("span", null, el("b", null, i.titulo_vaga)), el("span", null, i.id), i.data_inicio ? el("span", null, "Início " + fmtData(i.data_inicio)) : null,
                el("span", null, "Atualizado " + fmtData(i.atualizado_em, true)))),
            pillAdm(i.status)))))
      });
    });
  }

  const ROTULOS_CADASTRO = [["nome", "Nome"], ["cpf", "CPF"], ["rg", "RG"], ["cnh", "CNH"], ["ctps", "CTPS"], ["sexo", "Sexo"], ["data_nascimento", "Nascimento"],
    ["telefone", "Telefone"], ["email_pessoal", "E-mail pessoal"], ["curriculo_lattes", "Lattes"], ["cep", "CEP"], ["endereco", "Endereço"], ["bairro", "Bairro"],
    ["cidade", "Cidade"], ["estado", "UF"], ["grau_instrucao", "Grau de instrução"], ["area_formacao", "Curso"], ["instituicao_ensino", "Instituição"],
    ["matricula_uff", "Matrícula UFF"], ["cr", "CR"], ["email_innomaker", "E-mail Innomaker"], ["banco", "Banco"], ["agencia", "Agência"], ["conta", "Conta"],
    ["tipo_conta", "Tipo de conta"], ["pix_numero", "PIX"], ["pix_banco", "Banco do PIX"], ["nome_emergencia", "Contato de emergência"], ["telefone_emergencia", "Telefone de emergência"]];
  const ROTULOS_ARQUIVO = { doc_pessoais: "Documentos pessoais", doc_curriculo: "Currículo", doc_matricula: "Matrícula", doc_cr: "Declaração de CR", doc_plano: "Plano de estudos" };

  async function viewAdmissaoDetalhe(box, id) {
    const a0 = el("div", null, carregando());
    box.append(a0);
    const r = await api("adm_detalhe", { id });
    a0.remove();
    if (!r.ok) return box.append(msg("erro", r.erro));
    const a = r.admissao, p = a.proposta, c = a.cadastro;
    const st = a.status;
    box.append(cabecalho(a.candidato_nome, a.titulo_vaga + " · " + a.id, [
      st === "AGUARDANDO_APROVACAO" ? el("button", { type: "button", class: "bt", onclick: () => aprovarAdm(a, r.modelos) }, "Aprovar cadastro") : null,
      st === "AGUARDANDO_APROVACAO" ? el("button", { type: "button", class: "bt-alerta", onclick: () => decidirAdm(a, "correcao") }, "Pedir correção") : null,
      st === "AGUARDANDO_APROVACAO" ? el("button", { type: "button", class: "bt-perigo", onclick: () => decidirAdm(a, "recusar") }, "Recusar") : null,
      ["PROPOSTA_ENVIADA", "COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA"].indexOf(st) >= 0 ? el("button", { type: "button", class: "bt-sec", onclick: () => reenviarAdm(a) }, "Reenviar proposta") : null,
      a.funcionario_id ? el("a", { class: "bt", href: "#funcionario/" + a.funcionario_id }, "Ver funcionário") : null
    ], ["#admissoes", "Admissões"]));

    box.append(el("div", { class: "card" }, el("div", { class: "meta" }, pillAdm(st), el("span", null, "E-mail: " + a.email_contato))));
    if (st === "AGUARDANDO_APROVACAO") box.append(el("div", { class: "nota ambar" }, el("strong", null, "Conferência obrigatória (item 4.5)"),
      "Verifique se todos os campos estão preenchidos, se os documentos obrigatórios foram enviados, se os dados conferem com os documentos e se os arquivos estão legíveis. " +
      "Se faltar algo, use \"Pedir correção\" com a lista exata do que ajustar."));
    if (st === "APROVADA") box.append(el("div", { class: "nota verde" }, el("strong", null, "Depois da aprovação (manual)"),
      "• Confira se o funcionário recebeu e assinou os documentos (Funcionários).\n• Registre a conferência dos documentos assinados.\n• Cadastre no aplicativo de ponto.\n• Prepare o onboarding para o primeiro dia."));

    box.append(el("h2", { class: "sec" }, "Proposta"), el("div", { class: "card" }, dados([
      ["Contratação", p.tipo_contratacao], ["Situação", p.situacao], ["Cargo", p.cargo], ["Função", p.funcao], ["Departamento", p.departamento], ["Setor", p.setor],
      ["Horário", p.horario_trabalho], ["Início", fmtData(p.data_inicio)], ["Bolsa / remuneração", p.bolsa_valor], ["Auxílio", p.auxilio], ["Responsável", p.responsavel],
      ["Entidade vinculada", p.entidade_vinculada], ["Bolsa de/até", [fmtData(p.data_inicial_bolsa), fmtData(p.data_final_bolsa)].filter(Boolean).join(" até ")],
      ["Gestor", [p.gestor_nome, p.gestor_email].filter(Boolean).join(" — ")], ["Observação interna", p.observacao]])));

    if (Object.keys(c).length) {
      box.append(el("h2", { class: "sec" }, "Cadastro enviado"), el("div", { class: "card" }, dados(ROTULOS_CADASTRO.map(([k, rot]) => [rot, k === "data_nascimento" ? fmtData(c[k]) : c[k]]))));
    }
    box.append(el("h2", { class: "sec" }, "Documentos enviados"), r.arquivos.length
      ? el("div", { class: "card" }, el("ul", { style: "margin:0;padding-left:18px" }, r.arquivos.map(x =>
        el("li", null, el("b", null, (ROTULOS_ARQUIVO[x.categoria] || x.categoria) + ": "), el("a", { href: "/arquivo/" + x.id, target: "_blank", rel: "noopener" }, x.nome)))))
      : el("div", { class: "vazio" }, "Nenhum arquivo enviado ainda."));
    if (r.documentos.length) {
      box.append(el("h2", { class: "sec" }, "Documentos para assinatura"), el("div", { class: "lista" }, r.documentos.map(d =>
        el("div", { class: "card item-topo" }, el("a", { href: "/documento/" + d.id, target: "_blank", rel: "noopener" }, el("b", null, d.titulo)), pill(d.status)))));
    }
    box.append(el("h2", { class: "sec" }, "Histórico"), el("div", { class: "card" }, el("ul", { class: "pequeno", style: "margin:0;padding-left:18px" },
      a.historico.map(h => el("li", null, fmtData(h.quando, true) + " — ", el("b", null, h.acao), " (" + String(h.quem).replace(/ <.*>$/, "") + ")" + (h.texto ? ": " + h.texto : ""))))));
  }

  async function aprovarAdm(a, modelos) {
    const itens = ["Todos os campos obrigatórios estão preenchidos", "Todos os documentos obrigatórios foram recebidos", "Os dados conferem com os documentos anexados",
      "Os arquivos estão completos e legíveis", "Não há informações divergentes ou incorretas"];
    const checks = itens.map(() => el("input", { type: "checkbox" }));
    const mods = modelos.map(m => el("input", { type: "checkbox", value: String(m.id), checked: !!m.gerar_na_admissao }));
    const corpo = el("div", null,
      el("p", { class: "suave", style: "margin:0 0 12px" }, "Ao aprovar, o sistema registra o funcionário (nova matrícula), gera os documentos escolhidos e envia para assinatura na Área do candidato."),
      el("div", { style: "display:grid;gap:10px" }, itens.map((t, k) => el("label", { class: "check" }, checks[k], el("span", null, t)))),
      el("h3", { style: "margin:18px 0 8px;font-size:15px" }, "Documentos para gerar"),
      modelos.length ? el("div", { style: "display:grid;gap:8px" }, modelos.map((m, k) => el("label", { class: "check" }, mods[k], el("span", null, m.nome))))
        : el("p", { class: "suave" }, "Nenhum modelo ativo. Cadastre em Configurações."));
    await dialogo({
      titulo: "Aprovar cadastro de " + a.candidato_nome, corpo, okTexto: "Aprovar e registrar funcionário",
      aoConfirmar: async () => {
        if (checks.some(x => !x.checked)) return "Confirme todos os itens da conferência antes de aprovar.";
        const r = await api("adm_decidir", { id: a.id, decisao: "aprovar", modelos: mods.filter(x => x.checked).map(x => x.value) });
        if (!r.ok) return r.erro;
        toast("Aprovado. Matrícula " + r.matricula + ", " + r.documentos + " documento(s) para assinatura." +
          (r.planilha === "enviando" ? " A linha está sendo preenchida na planilha de Registros." : ""));
        return true;
      }
    }) && recarregar();
  }

  async function decidirAdm(a, tipo) {
    const correcao = tipo === "correcao";
    const t = el("textarea", { placeholder: correcao ? "Liste exatamente o que falta ou está incorreto." : "Justificativa enviada ao candidato." });
    await dialogo({
      titulo: (correcao ? "Pedir correção a " : "Recusar admissão de ") + a.candidato_nome,
      corpo: el("div", null, correcao ? null : el("div", { class: "nota ambar", style: "margin:0 0 12px" }, "Para pendências de dados ou documentos, prefira \"Pedir correção\". A recusa encerra a admissão."), t),
      okTexto: correcao ? "Enviar pedido de correção" : "Recusar e avisar", okClasse: correcao ? "bt-alerta" : "bt-perigo",
      aoConfirmar: async () => {
        if (t.value.trim().length < 5) return "Escreva o texto para o candidato.";
        const r = await api("adm_decidir", { id: a.id, decisao: tipo, texto: t.value.trim() });
        if (!r.ok) return r.erro;
        toast(correcao ? "Pedido de correção enviado." : "Recusa registrada.");
        return true;
      }
    }) && recarregar();
  }

  async function reenviarAdm(a) {
    await dialogo({ titulo: "Reenviar proposta", corpo: el("p", { style: "margin:0" }, "O e-mail da proposta será enviado de novo para " + a.email_contato + "."), okTexto: "Reenviar",
      aoConfirmar: async () => { const r = await api("adm_reenviar", { id: a.id }); if (!r.ok) return r.erro; toast("Proposta reenviada."); return true; } }) && recarregar();
  }

  // =================================================================
  //  Funcionários
  // =================================================================
  function viewFuncionarios(box) {
    box.append(cabecalho("Funcionários", "Registros criados na aprovação das admissões. Contratos têm duração mínima de 1 ano; o RH recebe aviso 45 dias antes do fim."));
    carregarEm(box, "func_listar", {}, (area, r) => {
      if (!r.itens.length) return area.append(el("div", { class: "vazio" }, "Nenhum funcionário registrado ainda."));
      const limite = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
      const pend = f => f.docs_pendentes || !f.documentos_conferidos || !f.ponto_cadastrado || !f.onboarding_ok;
      const grupo = f => !f.ativo ? "inativos" : (f.data_final_contrato && f.data_final_contrato <= limite) ? "vencendo" : pend(f) ? "pendentes" : "ok";
      const chk = (v, rot) => el("span", { class: "pill " + (v ? "verde" : "cinza"), title: rot }, (v ? "✓ " : "○ ") + rot);
      listaFiltrada(area, r.itens, {
        filtros: [["todas", "Todos"], ["pendentes", "Com pendências"], ["vencendo", "Contrato vencendo"], ["ok", "Em dia"], ["inativos", "Inativos"]],
        grupo, placeholder: "Buscar por nome, matrícula, função ou departamento", texto: f => [f.matricula, f.nome, f.funcao, f.departamento, f.email].join(" "),
        desenhar: (alvo, vis) => alvo.append(el("div", { class: "rolagem" }, el("table", { class: "tabela" },
          el("thead", null, el("tr", null, ["Funcionário", "Início", "Fim do contrato", "Documentos", "Checklist", ""].map(t => el("th", null, t)))),
          el("tbody", null, vis.map(f => el("tr", null,
            el("td", { class: "titulo", "data-rotulo": "Funcionário" }, el("b", null, f.nome), el("span", { class: "mini" }, "Matrícula " + f.matricula + " · " + [f.funcao, f.departamento].filter(Boolean).join(" · "))),
            el("td", { "data-rotulo": "Início" }, fmtData(f.data_efetivacao)),
            el("td", { "data-rotulo": "Fim do contrato" }, fmtData(f.data_final_contrato) || "—", f.data_final_contrato && f.data_final_contrato <= limite ? el("div", null, el("span", { class: "pill verm" }, "Renovar")) : null),
            el("td", { "data-rotulo": "Documentos" }, f.docs_assinados + " assinado(s)" + (f.docs_pendentes ? " · " + f.docs_pendentes + " pendente(s)" : "")),
            el("td", { "data-rotulo": "Checklist" }, el("div", { class: "acoes" }, chk(f.documentos_conferidos, "Docs"), chk(f.ponto_cadastrado, "Ponto"), chk(f.onboarding_ok, "Onboarding"))),
            el("td", { "data-rotulo": "" }, el("a", { class: "bt-sec", href: "#funcionario/" + f.matricula }, "Abrir")))))))),
        vazio: "Ninguém neste filtro."
      });
    });
  }

  async function viewFuncionarioDetalhe(box, mat) {
    const a0 = el("div", null, carregando());
    box.append(a0);
    const r = await api("func_detalhe", { matricula: mat });
    a0.remove();
    if (!r.ok) return box.append(msg("erro", r.erro));
    const f = r.funcionario;
    box.append(cabecalho(f.nome, "Matrícula " + f.matricula + (f.admissao_id ? " · " + f.admissao_id : ""), [
      el("button", { type: "button", class: "bt", onclick: () => gerarDocs(f, r.modelos) }, "Gerar documentos"),
      f.admissao_id ? el("a", { class: "bt-sec", href: "#admissao/" + f.admissao_id }, "Ver admissão") : null
    ], ["#funcionarios", "Funcionários"]));

    // Checklist (salva na hora)
    const flag = (k, rot, desc) => {
      const cb = el("input", { type: "checkbox", checked: !!f[k] });
      cb.addEventListener("change", async () => {
        const res = await api("func_atualizar", { matricula: f.matricula, [k]: cb.checked });
        if (!res.ok) { cb.checked = !cb.checked; return toast(res.erro, true); }
        toast(rot + (cb.checked ? " marcado." : " desmarcado."));
      });
      return el("label", { class: "check" }, cb, el("span", null, el("b", null, rot), el("br"), el("span", { class: "pequeno suave" }, desc)));
    };
    box.append(el("h2", { class: "sec" }, "Checklist da admissão"), el("div", { class: "card", style: "display:grid;gap:14px" },
      flag("documentos_conferidos", "Documentos assinados conferidos", "Todos devolvidos, assinados, completos e legíveis (item 4.9)."),
      flag("ponto_cadastrado", "Cadastrado no aplicativo de ponto", "Depois da conferência dos documentos (item 4.10)."),
      flag("onboarding_ok", "Onboarding realizado", "Sala, slides, camisa e crachá preparados; reunião feita no primeiro dia (item 6)."),
      flag("ativo", "Funcionário ativo", "Desmarque no desligamento.")));

    // Planilha "Registros" (Google Sheets): preenchida na aprovação da admissão
    const ST_PLANILHA = {
      ENVIADO: ["Na planilha" + (f.planilha_linha ? " (linha " + f.planilha_linha + ")" : ""), "verde"],
      ENVIANDO: ["Enviando…", "ambar"], FALHOU: ["Falhou", "verm"], NAO_CONFIGURADA: ["Planilha não configurada", "cinza"]
    }[f.planilha_status] || ["Não enviado", "cinza"];
    const btPlanilha = el("button", { type: "button", class: f.planilha_status === "ENVIADO" ? "bt-sec" : "bt", onclick: async () => {
      btPlanilha.disabled = true; btPlanilha.textContent = "Enviando… (pode levar alguns minutos)";
      const res = await api("func_planilha", { matricula: f.matricula });
      btPlanilha.disabled = false; btPlanilha.textContent = "Enviar para a planilha";
      if (!res.ok) return toast(res.erro, true);
      toast("Planilha de Registros: linha " + res.linha + (res.criada ? " criada." : " completada.") + (res.avisos && res.avisos.length ? " Aviso: " + res.avisos.join(" | ") : ""));
      recarregar();
    } }, "Enviar para a planilha");
    box.append(el("h2", { class: "sec" }, "Planilha de Registros"), el("div", { class: "card item-topo" },
      el("div", null,
        el("div", { class: "acoes", style: "margin-bottom:6px" }, el("span", { class: "pill " + ST_PLANILHA[1] }, ST_PLANILHA[0]),
          f.planilha_em ? el("span", { class: "pequeno suave" }, fmtData(f.planilha_em, true)) : null),
        f.planilha_erro ? el("div", { class: "pequeno " + (f.planilha_status === "FALHOU" ? "" : "suave"), style: f.planilha_status === "FALHOU" ? "color:var(--verm)" : "" }, f.planilha_erro) : null,
        el("div", { class: "pequeno suave" }, "Na aprovação, o sistema preenche a linha do funcionário na aba Registros e a planilha cria a pasta no Drive e as planilhas dele. Reenviar só completa células vazias: nada já preenchido é apagado.")),
      btPlanilha));

    box.append(el("h2", { class: "sec" }, "Documentos"), r.documentos.length ? el("div", { class: "lista" }, r.documentos.map(d =>
      el("div", { class: "card item-topo" },
        el("div", null, el("a", { href: "/documento/" + d.id, target: "_blank", rel: "noopener" }, el("b", null, d.titulo)),
          el("div", { class: "mini" }, "Gerado em " + fmtData(d.criado_em, true) + (d.assinado_em ? " · assinado em " + fmtData(d.assinado_em, true) : ""))),
        el("div", { class: "acoes" }, pill(d.status),
          d.status === "AGUARDANDO_ASSINATURA" ? el("button", { type: "button", class: "bt-sec", onclick: () => cancelarDoc(d) }, "Cancelar") : null)))) :
      el("div", { class: "vazio" }, "Nenhum documento gerado."));

    if (r.arquivos.length) {
      box.append(el("h2", { class: "sec" }, "Arquivos da admissão"), el("div", { class: "card" }, el("ul", { style: "margin:0;padding-left:18px" }, r.arquivos.map(x =>
        el("li", null, (ROTULOS_ARQUIVO[x.categoria] || x.categoria) + ": ", el("a", { href: "/arquivo/" + x.id, target: "_blank", rel: "noopener" }, x.nome))))));
    }

    // Dados editáveis
    const d = f.dados || {};
    const form = el("form", { novalidate: true },
      el("div", { class: "campos" },
        ...[["nome", "Nome"], ["email", "E-mail pessoal"], ["email_innomaker", "E-mail Innomaker"], ["telefone", "Telefone"], ["situacao", "Situação"], ["cargo", "Cargo"],
          ["funcao", "Função"], ["departamento", "Departamento"], ["setor", "Setor"], ["horario_trabalho", "Horário de trabalho"], ["tipo_contratacao", "Tipo de contratação"],
          ["bolsa_valor", "Bolsa / remuneração"], ["auxilio", "Auxílio"], ["responsavel", "Responsável"], ["entidade_vinculada", "Entidade vinculada"]]
          .map(([k, rot]) => campo(rot, entrada(k, f[k]))),
        campo("Data de efetivação", entrada("data_efetivacao", f.data_efetivacao, { type: "date" })),
        campo("Data final do contrato", entrada("data_final_contrato", f.data_final_contrato, { type: "date" }), { dica: "Confirme sempre manualmente (item 5)." }),
        campo("Principais funções", areaTexto("principais_funcoes", f.principais_funcoes), { largo: true })),
      el("h3", { style: "margin:22px 0 10px" }, "Dados pessoais"),
      el("div", { class: "campos" }, ROTULOS_CADASTRO.filter(([k]) => ["nome", "telefone", "email_pessoal", "email_innomaker"].indexOf(k) < 0)
        .map(([k, rot]) => campo(rot, entrada("dados." + k, d[k], k === "data_nascimento" ? { type: "date" } : {})))),
      el("div", { id: "funcMsg" }),
      el("div", { class: "acoes", style: "margin-top:16px" }, el("button", { type: "submit", class: "bt", id: "funcSalvar" }, "Salvar dados")));
    box.append(el("h2", { class: "sec" }, "Dados do registro"), el("div", { class: "card" }, form));

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const v = lerForm(form);
      const payload = { matricula: f.matricula, dados: {} };
      Object.keys(v).forEach(k => { if (k.indexOf("dados.") === 0) payload.dados[k.slice(6)] = v[k]; else payload[k] = v[k]; });
      $("funcSalvar").disabled = true;
      const res = await api("func_atualizar", payload);
      $("funcSalvar").disabled = false;
      limpar($("funcMsg"));
      if (!res.ok) return $("funcMsg").append(msg("erro", res.erro));
      toast("Dados salvos.");
    });
  }

  async function gerarDocs(f, modelos) {
    const mods = modelos.map(m => el("input", { type: "checkbox", value: String(m.id) }));
    await dialogo({
      titulo: "Gerar ou renovar documentos — " + f.nome,
      corpo: el("div", null, el("p", { class: "suave", style: "margin:0 0 12px" },
        "Os documentos são preenchidos com os dados do registro. Se algum campo usado pelo modelo estiver vazio, a geração é cancelada e o painel mostra qual campo preencher."),
        el("div", { style: "display:grid;gap:8px" }, modelos.map((m, k) => el("label", { class: "check" }, mods[k], el("span", null, m.nome))))),
      okTexto: "Gerar e enviar para assinatura",
      aoConfirmar: async () => {
        const ids = mods.filter(x => x.checked).map(x => x.value);
        if (!ids.length) return "Escolha pelo menos um documento.";
        const r = await api("doc_gerar", { matricula: f.matricula, modelos: ids });
        if (!r.ok) return r.erro;
        toast(r.gerados + " documento(s) gerado(s) e enviado(s).");
        return true;
      }
    }) && recarregar();
  }

  async function cancelarDoc(d) {
    await dialogo({ titulo: "Cancelar documento", corpo: el("p", { style: "margin:0" }, "\"" + d.titulo + "\" deixa de poder ser assinado."), okTexto: "Cancelar documento", okClasse: "bt-perigo",
      aoConfirmar: async () => { const r = await api("doc_cancelar", { id: d.id }); if (!r.ok) return r.erro; toast("Documento cancelado."); return true; } }) && recarregar();
  }

  // =================================================================
  //  Configurações
  // =================================================================
  const NOMES_LISTA = { etapa: "Etapas do processo seletivo", tipo_contratacao: "Tipos de contratação", tipo_vaga: "Tipos de vaga", horario: "Horários de trabalho",
    situacao: "Situações", auxilio: "Auxílios", cargo: "Cargos", funcao: "Funções", setor: "Setores", grau_instrucao: "Graus de instrução" };

  function viewConfig(box) {
    box.append(cabecalho("Configurações", "Tudo o que antes ficava nas abas EMAIL, Informações e CONFG das planilhas."));
    carregarEm(box, "cfg_obter", {}, (area, r) => {
      OPCOES = null;
      // Geral
      const links = (r.config.links_colaborador || []).map(l => [l.titulo, l.url, l.descricao || ""].join(" | ")).join("\n");
      const geral = el("form", { novalidate: true }, el("div", { class: "campos" },
        campo("E-mail do RH (recebe os avisos)", entrada("email_rh", r.config.email_rh, { type: "email" })),
        campo("Link da Cartilha do Colaborador", entrada("link_cartilha", r.config.link_cartilha)),
        campo("Link de agendamento do onboarding", entrada("link_onboarding", r.config.link_onboarding), { dica: "Enviado ao candidato quando ele termina o cadastro." }),
        campo("Links úteis da área do colaborador", areaTexto("links", links, { placeholder: "Título | https://… | descrição (opcional)" }), { largo: true, dica: "Um por linha: Título | URL | descrição" })),
        el("div", { class: "acoes", style: "margin-top:14px" }, el("button", { type: "submit", class: "bt" }, "Salvar"),
          el("button", { type: "button", class: "bt-sec", onclick: async ev => {
            const bt = ev.currentTarget;
            bt.disabled = true; bt.textContent = "Enviando…";
            const res = await api("email_teste", { para: U.email || geral.querySelector("[name=email_rh]").value });
            bt.disabled = false; bt.textContent = "Enviar e-mail de teste";
            res.ok ? toast("E-mail de teste enviado para " + res.para + ". Confira a caixa de entrada.") : toast(res.erro, true);
          } }, "Enviar e-mail de teste")));
      geral.addEventListener("submit", async ev => {
        ev.preventDefault();
        const d = lerForm(geral);
        d.links_colaborador = d.links.split("\n").map(l => l.split("|").map(x => x.trim())).filter(p => p[0] && p[1]).map(p => ({ titulo: p[0], url: p[1], descricao: p[2] || "" }));
        const res = await api("cfg_salvar_geral", d);
        res.ok ? toast("Configurações salvas.") : toast(res.erro, true);
      });
      area.append(el("h2", { class: "sec" }, "Geral"), el("div", { class: "card" }, geral));

      // Planilha Registros (Google Sheets)
      const resPlanilha = el("div", { class: "pequeno", style: "margin-top:10px" });
      const btTestar = el("button", { type: "button", class: "bt-sec", onclick: async () => {
        btTestar.disabled = true; btTestar.textContent = "Testando…";
        const res = await api("planilha_testar");
        btTestar.disabled = false; btTestar.textContent = "Testar planilha";
        limpar(resPlanilha);
        const t = res.ok ? res.resultado : res;
        if (!t.ok) return resPlanilha.append(msg("erro", t.erro));
        resPlanilha.append(msg("ok", "Conectado à aba " + t.aba + ": " + Math.max(0, (t.linhas || 1) - 1) + " registro(s). Próxima matrícula: " + t.proximaMatricula + "." +
          (t.colunas && t.colunas < t.esperadas ? " Atenção: a aba tem " + t.colunas + " colunas e o sistema envia " + t.esperadas + "." : "")));
      } }, "Testar planilha");
      area.append(el("h2", { class: "sec" }, "Planilha de Registros"), el("div", { class: "card" },
        el("div", { class: "item-topo" },
          el("div", null,
            el("span", { class: "pill " + (r.planilhaConfigurada ? "verde" : "cinza") }, r.planilhaConfigurada ? "Configurada" : "Não configurada"),
            el("p", { class: "pequeno suave", style: "margin:8px 0 0;max-width:720px" },
              "Quando o RH aprova uma admissão, o sistema pega a próxima matrícula na aba Registros e preenche a linha do funcionário. " +
              "A configuração fica no backend/.env (PLANILHA_REGISTROS_URL e PLANILHA_REGISTROS_TOKEN); o passo a passo está em docs/planilha-registros.md.")),
          btTestar),
        resPlanilha));

      // Departamentos
      const linhaDep = dep => {
        const nome = entrada("nome", dep.nome), gn = entrada("gestor_nome", dep.gestor_nome), ge = entrada("gestor_email", dep.gestor_email, { type: "email" });
        const ativo = el("input", { type: "checkbox", checked: dep.id ? !!dep.ativo : true });
        const salvar = el("button", { type: "button", class: "bt-sec" }, dep.id ? "Salvar" : "Adicionar");
        salvar.onclick = async () => {
          const res = await api("dep_salvar", { id: dep.id, nome: nome.value, gestor_nome: gn.value, gestor_email: ge.value, ativo: ativo.checked });
          if (!res.ok) return toast(res.erro, true);
          toast("Departamento salvo.");
          OPCOES = null;
          if (!dep.id) recarregar();
        };
        return el("tr", null, el("td", { "data-rotulo": "Departamento" }, nome), el("td", { "data-rotulo": "Gestor" }, gn), el("td", { "data-rotulo": "E-mail do gestor" }, ge),
          el("td", { "data-rotulo": "Ativo" }, ativo), el("td", null, salvar));
      };
      area.append(el("h2", { class: "sec" }, "Departamentos e gestores"),
        el("p", { class: "suave pequeno", style: "margin:-6px 0 10px" }, "O gestor de cada departamento recebe os avisos da vaga e vê os candidatos no painel."),
        el("div", { class: "rolagem" }, el("table", { class: "tabela" },
          el("thead", null, el("tr", null, ["Departamento", "Gestor", "E-mail do gestor", "Ativo", ""].map(t => el("th", null, t)))),
          el("tbody", null, r.departamentos.map(linhaDep), linhaDep({})))));

      // Listas
      const tipo = seletor("tipo", r.tiposLista, r.tiposLista[0], false);
      tipo.querySelectorAll("option").forEach(o => { o.textContent = NOMES_LISTA[o.value] || o.value; });
      const valores = areaTexto("valores", "", { style: "min-height:180px" });
      const mostrarLista = () => { valores.value = (r.listas[tipo.value] || []).join("\n"); };
      tipo.addEventListener("change", mostrarLista);
      mostrarLista();
      const salvarLista = el("button", { type: "button", class: "bt" }, "Salvar lista");
      salvarLista.onclick = async () => {
        const vals = valores.value.split("\n").map(x => x.trim()).filter(Boolean);
        const res = await api("lista_salvar", { tipo: tipo.value, valores: vals });
        if (!res.ok) return toast(res.erro, true);
        r.listas[tipo.value] = vals;
        OPCOES = null;
        toast("Lista salva.");
      };
      area.append(el("h2", { class: "sec" }, "Listas de opções"), el("div", { class: "card" },
        el("div", { class: "campos" }, campo("Lista", tipo), el("div"), campo("Itens (um por linha)", valores, { largo: true })),
        el("div", { class: "acoes", style: "margin-top:12px" }, salvarLista)));

      // Modelos de documento
      area.append(el("h2", { class: "sec" }, "Modelos de documento"),
        el("p", { class: "suave pequeno", style: "margin:-6px 0 10px" }, "Cole o texto oficial (Termo de Compromisso, Direito de Imagem, Apêndice de Bolsa) e use os campos entre chaves duplas."),
        el("div", { class: "lista" }, r.modelos.map(m => el("div", { class: "card item-topo" },
          el("div", null, el("b", null, m.nome), el("div", { class: "mini" }, [m.codigo, m.gerar_na_admissao ? "gerado na admissão" : "sob demanda", m.ativo ? "" : "inativo"].filter(Boolean).join(" · "))),
          el("button", { type: "button", class: "bt-sec", onclick: () => editarModelo(m, r.camposDocumento) }, "Editar")))),
        el("div", { class: "acoes", style: "margin-top:12px" }, el("button", { type: "button", class: "bt-sec", onclick: () => editarModelo({ ativo: 1, gerar_na_admissao: 0 }, r.camposDocumento) }, "Novo modelo")));
    });
  }

  async function editarModelo(m, campos) {
    const f = el("form", { novalidate: true },
      el("div", { class: "campos" },
        campo("Nome", entrada("nome", m.nome)), campo("Código (ex.: ADM-TEMP-2026-001)", entrada("codigo", m.codigo)),
        campo("Texto", areaTexto("conteudo", m.conteudo, { style: "min-height:340px;font-family:ui-monospace,Consolas,monospace;font-size:13px" }), { largo: true,
          dica: "Use # para título e ## para subtítulo. Deixe uma linha em branco entre parágrafos." })),
      el("label", { class: "check", style: "margin-top:10px" }, el("input", { type: "checkbox", name: "gerar_na_admissao", checked: !!m.gerar_na_admissao }), el("span", null, "Marcar por padrão na aprovação da admissão")),
      el("label", { class: "check", style: "margin-top:8px" }, el("input", { type: "checkbox", name: "ativo", checked: m.ativo !== 0 }), el("span", null, "Ativo")),
      el("details", { class: "mais" }, el("summary", null, "Campos disponíveis"),
        el("div", { class: "pequeno", style: "columns:2;margin-top:8px" }, Object.keys(campos).map(k => el("div", null, el("code", null, "{{" + k + "}}"), " " + campos[k])))));
    await dialogo({
      titulo: m.id ? "Editar modelo" : "Novo modelo", corpo: f, okTexto: "Salvar modelo", largo: true,
      aoConfirmar: async () => {
        const res = await api("modelo_salvar", Object.assign(lerForm(f), { id: m.id }));
        if (!res.ok) return res.erro;
        toast("Modelo salvo.");
        return true;
      }
    }) && recarregar();
  }

  // =================================================================
  //  Histórico
  // =================================================================
  function viewLog(box) {
    box.append(cabecalho("Histórico", "Últimas ações registradas e e-mails enviados pelo sistema."));
    carregarEm(box, "log_listar", {}, (area, r) => {
      const semProvedor = r.emails.some(e => e.status === "SEM_PROVEDOR");
      if (semProvedor) area.append(el("div", { class: "nota ambar", style: "margin-bottom:12px" }, el("strong", null, "E-mails não estão saindo"),
        "Configure SMTP_USER e SMTP_PASS (rh.innomaker@gmail.com e a senha de app) no .env do servidor para o sistema enviar e-mails."));
      area.append(el("h2", { class: "sec", style: "margin-top:0" }, "E-mails"), el("div", { class: "rolagem" }, el("table", { class: "tabela" },
        el("thead", null, el("tr", null, ["Quando", "Para", "Assunto", "Status"].map(t => el("th", null, t)))),
        el("tbody", null, r.emails.map(e => el("tr", null, el("td", { "data-rotulo": "Quando" }, fmtData(e.quando, true)), el("td", { "data-rotulo": "Para" }, e.para),
          el("td", { "data-rotulo": "Assunto" }, e.assunto), el("td", { "data-rotulo": "Status", title: e.erro || "" },
            el("span", { class: "pill " + ({ ENVIADO: "verde", FALHOU: "verm" }[e.status] || "ambar") }, { ENVIADO: "Enviado", FALHOU: "Falhou", SEM_PROVEDOR: "Sem provedor" }[e.status] || e.status))))))));
      area.append(el("h2", { class: "sec" }, "Ações"), el("div", { class: "rolagem" }, el("table", { class: "tabela" },
        el("thead", null, el("tr", null, ["Quando", "Quem", "Ação", "Registro", "Detalhe"].map(t => el("th", null, t)))),
        el("tbody", null, r.log.map(l => el("tr", null, el("td", { "data-rotulo": "Quando" }, fmtData(l.quando, true)), el("td", { "data-rotulo": "Quem" }, String(l.quem).replace(/ <.*>$/, "")),
          el("td", { "data-rotulo": "Ação" }, l.acao), el("td", { "data-rotulo": "Registro" }, l.entidade_id), el("td", { "data-rotulo": "Detalhe", class: "pequeno" }, l.detalhe)))))));
    });
  }

  // =================================================================
  //  Início do painel
  // =================================================================
  $("uNome").textContent = U.nome || U.login;
  $("uPapel").textContent = U.papelNome;
  $("uAvatar").textContent = String(U.nome || U.login || "?").trim().split(/\s+/).filter(Boolean)
    .map((p, i, a) => (i === 0 || i === a.length - 1) ? p[0] : "").join("").slice(0, 2).toUpperCase();
  $("menuBtn").addEventListener("click", () => abrirMenu(!$("lateral").classList.contains("aberta")));
  $("veu").addEventListener("click", () => abrirMenu(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("lateral").classList.contains("aberta")) abrirMenu(false); });
  montarMenu();
  window.addEventListener("hashchange", irPara);
  irPara();
})();
