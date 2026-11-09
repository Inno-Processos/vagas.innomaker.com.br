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
    "PROPOSTA_EXPIRADA": ["Proposta vencida", "verm"], "CANCELADA": ["Cancelada", "cinza"],
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
    { id: "adm-area", nome: "Admissões da área", acao: "adm_area", render: viewAdmArea, soSe: () => !pode("adm_listar"),
      desc: "Acompanhe as contratações da sua área até o primeiro dia." },
    { grupo: "RH" },
    { id: "solicitacoes", nome: "Solicitações", acao: "solic_listar", render: viewSolicitacoes,
      desc: "Analise os pedidos dos gestores: aprove, recuse ou recuse com alteração." },
    { id: "vagas", nome: "Vagas", acao: "vagas_todas", render: viewVagas,
      desc: "Crie e edite vagas, controle prazos e conduza as etapas dos candidatos." },
    { id: "admissoes", nome: "Admissões", acao: "adm_listar", render: viewAdmissoes,
      desc: "Propostas, cadastros para conferir e aprovação da admissão." },
    { id: "funcionarios", nome: "Funcionários", acao: "func_listar", render: viewFuncionarios,
      desc: "Registros, documentos assinados, ponto, onboarding e renovações." },
    { id: "talentos", nome: "Banco de talentos", acao: "talentos_listar", render: viewTalentos,
      desc: "Candidatos para lembrar em novas vagas, com convite por e-mail." },
    { id: "indicadores", nome: "Indicadores", acao: "indicadores", render: viewIndicadores,
      desc: "Tempo até contratar, funil por etapa e origem dos candidatos." },
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
    "adm-area": "M9 4h6v3H9zM15 5h3v16H6V5h3M9 13l2 2 4-4",
    "funcionarios": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    "talentos": "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
    "indicadores": "M3 3v18h18M8 17v-5M13 17V8M18 17v-8",
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
    return el("div", null, cab);
  }



  // =================================================================
  //  Manual: ícone de livro no topo abre o manual da tela atual
  // =================================================================
  const APELIDOS_MANUAL = { "solicitacao": "solicitacoes", "vaga-de-solicitacao": "vaga-form" };
  const NOMES_MANUAL = { "vaga": "Vaga (candidatos e agenda)", "vaga-form": "Criar / editar vaga", "admissao": "Admissão (detalhe)",
    "funcionario": "Funcionário (detalhe)", "editar-solicitacao": "Corrigir solicitação" };
  function manualDe(chave) {
    const todos = window.MANUAL_PAINEL || {};
    let m = todos[chave];
    if (m === null || m === undefined) m = todos[APELIDOS_MANUAL[chave]];
    if (m && !m.passos) m = m[U.papel] || m.rh || m.gerente || m.funcionario;
    return m || null;
  }
  function telasComManual() {
    const lista = visiveis().map(v => [v.id, v.nome]);
    Object.keys(ROTAS).forEach(k => { if (pode(ROTAS[k].acao) && NOMES_MANUAL[k] && manualDe(k)) lista.push([k, NOMES_MANUAL[k]]); });
    return lista.filter(([k]) => manualDe(k));
  }
  function abrirManual(chave) {
    const telas = telasComManual();
    if (!manualDe(chave)) chave = APELIDOS_MANUAL[chave] && manualDe(APELIDOS_MANUAL[chave]) ? APELIDOS_MANUAL[chave] : (telas[0] || ["inicio"])[0];
    const corpo = el("div", { class: "manual-dlg" });
    const sel = el("select", { "aria-label": "Ver o manual de outra tela" }, telas.map(([k, n]) => el("option", { value: k, selected: k === chave }, n)));
    const alvo = el("div");
    const html = s => { const sp = el("span"); sp.innerHTML = s; return sp; }; // textos fixos do manual.js (não vêm do usuário)
    function desenhar(k) {
      limpar(alvo);
      const m = manualDe(k);
      if (!m) return alvo.append(msg("info", "Esta tela não tem manual."));
      alvo.append(
        m.resumo ? el("p", { class: "manual-resumo" }, m.resumo) : null,
        el("ol", { class: "manual-passos" }, m.passos.map(p => el("li", null, html(p)))),
        m.dicas && m.dicas.length ? el("ul", { class: "manual-dicas" }, m.dicas.map(d => el("li", null, html(d)))) : null);
    }
    sel.addEventListener("change", () => desenhar(sel.value));
    corpo.append(el("label", { class: "manual-escolha" }, el("span", null, "Tela"), sel), alvo);
    desenhar(chave);
    dialogo({ titulo: "Manual — como usar", corpo, semOk: true, largo: true });
  }
  $("btManual").addEventListener("click", () => abrirManual(manualAtual));

  // =================================================================
  //  Agenda de entrevistas da vaga (horários com reserva pelo candidato)
  // =================================================================
  const DIAS_SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const diaCurto = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return DIAS_SEM[d.getUTCDay()] + " " + m[3] + "/" + m[2]; };
  const horaDe = s => String(s || "").slice(11, 16);
  const minutos = hhmm => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
  const hhmm = n => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  const fmtParticipantes = l => (l || []).map(p => p.nome ? p.nome + " <" + p.email + ">" : p.email).join("\n");

  function secaoAgenda(box, v) {
    const area = el("div", null, carregando("Buscando a agenda…"));
    box.append(el("h2", { class: "sec" }, "Agenda de entrevistas"), area);
    carregarAgenda(area, v);
  }

  async function carregarAgenda(area, v) {
    const r = await api("agenda_listar", { vaga_id: v.id });
    limpar(area);
    if (!r.ok) return area.append(msg("erro", r.erro || "Não foi possível carregar a agenda."));
    const rh = r.podeEditar;
    const recarregarAgenda = () => carregarAgenda(area, v);
    if (rh && r.etapasAgendaveis.length) {
      area.append(el("div", { class: "acoes", style: "margin-bottom:12px" },
        el("button", { type: "button", class: "bt", onclick: () => editarAgenda(null, v, r, recarregarAgenda) }, "+ Nova agenda")));
    }
    if (!r.etapasAgendaveis.length) return area.append(el("div", { class: "vazio" }, "Esta vaga só tem a Triagem. Para agendar entrevistas, inclua outras etapas em Editar vaga."));
    if (!r.agendas.length) {
      return area.append(el("div", { class: "vazio" }, rh
        ? "Nenhuma agenda ainda. Crie uma agenda com os horários em que você pode entrevistar e envie o link: cada candidato escolhe um horário livre."
        : "O RH ainda não abriu horários de entrevista para esta vaga."));
    }
    area.append(el("div", { class: "lista" }, r.agendas.map(a => cartaoAgenda(a, v, r, rh, recarregarAgenda))));
  }

  function cartaoAgenda(a, v, r, rh, recarregarAgenda) {
    const reservados = a.horarios.filter(h => h.reservado);
    const semConvite = a.elegiveis.filter(e => !e.convidado_em && !e.reservado);
    const aguardando = a.elegiveis.filter(e => e.convidado_em && !e.reservado);
    const porDia = new Map();
    a.horarios.filter(h => !h.passado || h.reservado).forEach(h => { const k = h.inicio.slice(0, 10); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(h); });

    const grade = porDia.size ? el("div", { class: "agenda-grade" }, [...porDia.entries()].map(([dia, hs]) => el("div", { class: "agenda-dia" },
      el("b", null, diaCurto(dia)),
      el("div", { class: "agenda-horas" }, hs.map(h => h.reservado
        ? el("button", { type: "button", class: "slot ocupado" + (h.passado ? " passado" : ""), title: h.candidato_nome + " — " + h.candidato_email,
            onclick: () => abrirReserva(h, a, rh, recarregarAgenda) }, horaDe(h.inicio), el("span", null, primeiroNome(h.candidato_nome)))
        : el("span", { class: "slot livre", title: "Livre" }, horaDe(h.inicio))))))) : el("p", { class: "pequeno suave" }, "Nenhum horário futuro. " + (rh ? "Use Editar para adicionar." : ""));

    return el("article", { class: "card" + (a.ativo ? "" : " apagado") },
      el("div", { class: "item-topo" },
        el("div", null,
          el("h3", null, a.etapa_nome, " ", el("span", { class: "pill " + (a.ativo ? "verde" : "cinza") }, a.ativo ? "Aberta" : "Encerrada")),
          el("div", { class: "meta" },
            el("span", null, a.local_tipo === "online" ? "Online" : "Presencial: " + a.local),
            el("span", null, a.duracao_min + " min"),
            el("span", null, el("b", null, String(a.livres)), " livre(s)"),
            el("span", null, el("b", null, String(reservados.length)), " reservado(s)"),
            el("span", null, "Entrevistam: " + a.participantes.map(p => p.nome || p.email).join(", ")))),
        rh ? el("div", { class: "acoes" },
          a.ativo ? el("button", { type: "button", class: semConvite.length ? "bt" : "bt-sec", onclick: () => convidarAgenda(a, recarregarAgenda) },
            "Enviar link" + (semConvite.length ? " (" + semConvite.length + ")" : "")) : null,
          el("button", { type: "button", class: "bt-sec", onclick: () => editarAgenda(a, v, r, recarregarAgenda) }, "Editar horários"),
          el("button", { type: "button", class: "bt-sec", onclick: async () => {
            const res = await api("agenda_encerrar", { id: a.id, ativo: !a.ativo });
            if (!res.ok) return toast(res.erro, true);
            toast(a.ativo ? "Agenda encerrada: o link deixa de mostrar horários livres." : "Agenda reaberta.");
            recarregarAgenda();
          } }, a.ativo ? "Encerrar" : "Reabrir")) : null),
      grade,
      a.elegiveis.length ? el("div", { class: "mini", style: "margin-top:10px" },
        aguardando.length ? el("div", null, "Ainda não escolheram: ", el("b", null, aguardando.map(e => e.nome).join(", "))) : null,
        semConvite.length ? el("div", null, "Sem link enviado: ", el("b", null, semConvite.map(e => e.nome).join(", "))) : null) : null);
  }

  function abrirReserva(h, a, rh, recarregarAgenda) {
    const extra = el("textarea", { rows: "2", placeholder: "Nome <email@exemplo.com>, um por linha" });
    const motivo = el("textarea", { rows: "2", placeholder: "Motivo (vai no e-mail ao candidato)" });
    const reenviar = el("input", { type: "checkbox", checked: true });
    const corpo = el("div", null,
      dados([["Candidato", h.candidato_nome], ["E-mail", h.candidato_email], ["Quando", diaCurto(h.inicio) + " · " + horaDe(h.inicio) + " às " + horaDe(h.fim)],
        ["Local", (a.local_tipo === "online" ? "Online: " : "") + a.local],
        ["Participantes", a.participantes.concat(h.participantes_extra || []).map(p => p.nome || p.email).join(", ")]]),
      rh && !h.passado ? el("div", null,
        el("h3", { class: "titulo-etapas" }, "Convidar mais alguém só para esta entrevista"),
        extra,
        el("div", { class: "acoes", style: "margin-top:8px" }, el("button", { type: "button", class: "bt-sec", onclick: async () => {
          const res = await api("agenda_participante", { horario_id: h.id, participantes: extra.value });
          if (!res.ok) return toast(res.erro, true);
          toast("Convite enviado para " + res.convidados + " pessoa(s).");
          $("dlg").close(); recarregarAgenda();
        } }, "Enviar convite")),
        el("h3", { class: "titulo-etapas" }, "Cancelar este horário"),
        motivo,
        el("label", { class: "check", style: "margin-top:8px" }, reenviar, el("span", null, "Mandar o link para o candidato escolher outro horário")),
        el("div", { class: "acoes", style: "margin-top:8px" }, el("button", { type: "button", class: "bt-perigo", onclick: async () => {
          if (!confirm("Cancelar o horário de " + h.candidato_nome + "? Todos recebem o cancelamento por e-mail.")) return;
          const res = await api("agenda_cancelar_reserva", { horario_id: h.id, motivo: motivo.value, reenviar: reenviar.checked });
          if (!res.ok) return toast(res.erro, true);
          toast("Horário cancelado e liberado.");
          $("dlg").close(); recarregarAgenda();
        } }, "Cancelar horário"))) : null);
    dialogo({ titulo: a.etapa_nome + " — " + h.candidato_nome, corpo, semOk: true, largo: true });
  }

  async function editarAgenda(a, v, r, recarregarAgenda) {
    const novo = !a;
    a = a || { etapa_nome: r.etapasAgendaveis[0], local_tipo: "presencial", local: "", duracao_min: 30, instrucoes: "",
      participantes: r.sugestaoParticipantes.concat(U.email ? [{ nome: U.nome, email: U.email }] : []), horarios: [] };
    const etapa = seletor("etapa_nome", r.etapasAgendaveis, a.etapa_nome, false);
    const tipo = seletor("local_tipo", ["presencial", "online"], a.local_tipo, false);
    tipo.options[0].textContent = "Presencial"; tipo.options[1].textContent = "Online";
    const local = entrada("local", a.local);
    const duracao = entrada("duracao_min", a.duracao_min, { type: "number", min: "10", max: "480", step: "5" });
    const parts = areaTexto("participantes", fmtParticipantes(a.participantes), { rows: "3", placeholder: "Nome <email@innomaker.com.br>, um por linha" });
    const instr = areaTexto("instrucoes", a.instrucoes, { rows: "3", placeholder: "Ex.: leve um documento com foto; chegue 10 minutos antes." });
    const pintarLocal = () => { local.placeholder = tipo.value === "online" ? "https://meet.google.com/…" : "Endereço e sala"; };
    tipo.addEventListener("change", pintarLocal); pintarLocal();

    // Horários: gerador por dia/intervalo + lista do que vai ser criado ou removido
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const gDia = entrada("g_dia", hoje, { type: "date", min: hoje });
    const gAte = entrada("g_ate", "", { type: "date", min: hoje });
    const gIni = entrada("g_ini", "09:00", { type: "time" });
    const gFim = entrada("g_fim", "12:00", { type: "time" });
    const gPausa = entrada("g_pausa", "0", { type: "number", min: "0", max: "120", step: "5" });
    const gFds = el("input", { type: "checkbox", checked: true });
    const novos = new Set(), remover = new Set();
    const lista = el("div", { class: "agenda-horas", style: "margin-top:10px" });
    function pintarHorarios() {
      limpar(lista);
      const existentes = a.horarios.filter(h => !h.passado).map(h => ({ ini: h.inicio, id: h.id, reservado: h.reservado, nome: h.candidato_nome }));
      const todos = existentes.concat([...novos].filter(n => !existentes.some(e => e.ini === n)).map(n => ({ ini: n, novo: true }))).sort((x, y) => x.ini < y.ini ? -1 : 1);
      if (!todos.length) return lista.append(el("span", { class: "pequeno suave" }, "Nenhum horário. Gere os horários acima."));
      todos.forEach(t => {
        const fora = t.id && remover.has(t.id);
        lista.append(el("span", { class: "slot " + (t.reservado ? "ocupado" : t.novo ? "novo" : "livre") + (fora ? " removido" : ""),
          title: t.reservado ? "Reservado por " + t.nome + " (cancele pela agenda)" : "" },
          diaCurto(t.ini) + " " + horaDe(t.ini),
          t.reservado ? null : el("button", { type: "button", class: "slot-x", "aria-label": (fora ? "Manter " : "Remover ") + horaDe(t.ini), onclick: () => {
            if (t.novo) novos.delete(t.ini); else if (fora) remover.delete(t.id); else remover.add(t.id);
            pintarHorarios();
          } }, fora ? "↺" : "×")));
      });
    }
    const gerar = el("button", { type: "button", class: "bt-sec", onclick: () => {
      const dur = parseInt(duracao.value, 10) || 30, passo = dur + (parseInt(gPausa.value, 10) || 0);
      const ini = minutos(gIni.value), fim = minutos(gFim.value);
      if (!gDia.value || isNaN(ini) || isNaN(fim) || fim - ini < dur) return toast("Confira o dia e o intervalo de horas (precisa caber pelo menos uma entrevista).", true);
      const ate = gAte.value && gAte.value > gDia.value ? gAte.value : gDia.value;
      let d = new Date(gDia.value + "T12:00:00Z"), n = 0;
      const agora = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date()).replace(" ", "T");
      while (d.toISOString().slice(0, 10) <= ate && n < 300) {
        const dia = d.toISOString().slice(0, 10), sem = d.getUTCDay();
        if (!(gFds.checked && (sem === 0 || sem === 6))) {
          for (let m = ini; m + dur <= fim; m += passo) { const s = dia + "T" + hhmm(m); if (s > agora) { novos.add(s); n++; } }
        }
        d = new Date(d.getTime() + 864e5);
      }
      if (!n) return toast("Nenhum horário novo nesse intervalo.", true);
      toast(n + " horário(s) incluído(s). Clique em Salvar para criar.");
      pintarHorarios();
    } }, "Gerar horários");

    const corpo = el("div", null,
      el("div", { class: "campos" },
        campo("Etapa", etapa, { dica: "Os candidatos que estão nesta etapa podem receber o link." }),
        campo("Duração de cada entrevista (min)", duracao),
        campo("Formato", tipo),
        campo("Local ou link da reunião", local, { dica: "No formato online, o link só aparece para o candidato depois que ele reservar." }),
        campo("Quem entrevista (recebe o convite na agenda)", parts, { largo: true, dica: "RH, o funcionário que vai entrevistar e outros convidados." }),
        campo("Instruções para o candidato (opcional)", instr, { largo: true })),
      el("h3", { class: "titulo-etapas" }, "Horários"),
      el("div", { class: "gerador" },
        campo("De", gDia), campo("Até (opcional)", gAte), campo("Das", gIni), campo("Às", gFim), campo("Pausa entre (min)", gPausa)),
      el("div", { class: "acoes", style: "margin-top:10px" }, gerar, el("label", { class: "check" }, gFds, el("span", null, "Pular sábados e domingos"))),
      lista);
    pintarHorarios();

    const ok = await dialogo({
      titulo: novo ? "Nova agenda — " + v.titulo : "Editar agenda — " + a.etapa_nome, corpo, okTexto: "Salvar agenda", largo: true,
      aoConfirmar: async () => {
        const res = await api("agenda_salvar", { id: a.id, vaga_id: v.id, etapa_nome: etapa.value, local_tipo: tipo.value, local: local.value,
          duracao_min: duracao.value, participantes: parts.value, instrucoes: instr.value, horarios_novos: [...novos], horarios_remover: [...remover] });
        if (!res.ok) return res.erro;
        toast("Agenda salva" + (res.criados ? ": " + res.criados + " horário(s) novo(s)." : ".") + (novo ? " Agora envie o link aos candidatos." : ""));
        return true;
      }
    });
    if (ok) recarregarAgenda();
  }

  async function convidarAgenda(a, recarregarAgenda) {
    const livres = a.elegiveis.filter(e => !e.reservado);
    if (!livres.length) return toast("Nenhum candidato está na etapa " + a.etapa_nome + " sem horário. Aprove a etapa anterior primeiro.", true);
    const caixas = livres.map(e => ({ e, ck: el("input", { type: "checkbox", checked: !e.convidado_em }) }));
    const corpo = el("div", null,
      el("p", { class: "suave pequeno", style: "margin:0 0 12px" }, "Cada candidato recebe por e-mail um link para escolher um dos " + a.livres + " horário(s) livre(s). Quem já recebeu pode receber de novo (o link é o mesmo)."),
      el("div", { class: "lista-check" }, caixas.map(({ e, ck }) => el("label", { class: "check" }, ck,
        el("span", null, el("b", null, e.nome), " — " + e.email, e.convidado_em ? el("span", { class: "mini" }, " (link enviado em " + fmtData(e.convidado_em, true) + ")") : null)))));
    const ok = await dialogo({
      titulo: "Enviar link de agendamento — " + a.etapa_nome, corpo, okTexto: "Enviar",
      aoConfirmar: async () => {
        const ids = caixas.filter(c => c.ck.checked).map(c => c.e.candidatura_id);
        if (!ids.length) return "Escolha pelo menos um candidato.";
        const res = await api("agenda_convidar", { agenda_id: a.id, candidatura_ids: ids });
        if (!res.ok) return res.erro;
        toast(res.enviados.length + " link(s) enviado(s)." + (res.ignorados.length ? " Não enviados: " + res.ignorados.map(i => i.nome + " (" + i.motivo + ")").join("; ") : ""), !!res.ignorados.length);
        return true;
      }
    });
    if (ok) recarregarAgenda();
  }

  // =================================================================
  //  Banco de talentos (RH)
  // =================================================================
  async function editarTalento(t, depois) {
    const marcado = el("input", { type: "checkbox", checked: true });
    const tags = entrada("tags", t.talento_tags || "", { placeholder: "ex.: python, cad, comunicação" });
    const nota = areaTexto("nota", t.talento_nota || "", { rows: "3", placeholder: "Por que lembrar desta pessoa? Para que tipo de vaga?" });
    const corpo = el("div", null,
      t.banco_talentos
        ? el("div", { class: "nota verde" }, el("strong", null, "Autorizou o banco de talentos"), "Pode receber convites para outras vagas.")
        : el("div", { class: "nota ambar" }, el("strong", null, "Não autorizou o banco de talentos"),
            "A anotação fica visível para o RH, mas ele não pode receber convites e os dados são apagados no fim do prazo de guarda (LGPD)."),
      el("label", { class: "check", style: "margin:14px 0" }, marcado, el("span", null, "Manter no banco de talentos (marcado pelo RH)")),
      el("div", { class: "campos" }, campo("Palavras-chave", tags, { largo: true, dica: "Separe por vírgula. Ajudam na busca." }), campo("Anotação do RH", nota, { largo: true })));
    const ok = await dialogo({ titulo: "Banco de talentos — " + t.nome, corpo, okTexto: "Salvar",
      aoConfirmar: async () => {
        const res = await api("talento_salvar", { candidato_id: t.candidato_id || t.id, marcado: marcado.checked, tags: tags.value, nota: nota.value });
        if (!res.ok) return res.erro;
        toast(marcado.checked ? "Salvo no banco de talentos." : "Retirado do banco de talentos.");
        return true;
      } });
    if (ok && depois) depois();
  }

  async function excluirCandidato(c, depois) {
    const conf = entrada("conf", "", { placeholder: "EXCLUIR", autocomplete: "off" });
    const motivo = entrada("motivo", "", { placeholder: "Ex.: pedido do candidato por e-mail em 10/11" });
    const corpo = el("div", null,
      el("div", { class: "nota verm" }, el("strong", null, "Não pode ser desfeito"),
        "Apaga a conta de " + c.nome + ", currículos, todas as candidaturas e avaliações. Horários marcados são cancelados. " +
        "Quem tem admissão em andamento ou é funcionário não pode ser excluído por aqui (guarda obrigatória)."),
      el("div", { class: "campos", style: "margin-top:14px" }, campo("Motivo (fica no Histórico)", motivo, { largo: true }), campo("Digite EXCLUIR para confirmar", conf)));
    const ok = await dialogo({ titulo: "Excluir dados (LGPD) — " + c.nome, corpo, okTexto: "Excluir definitivamente", okClasse: "bt-perigo",
      aoConfirmar: async () => {
        const res = await api("candidato_excluir", { candidato_id: c.candidato_id || c.id, confirmacao: conf.value, motivo: motivo.value });
        if (!res.ok) return res.erro;
        toast("Dados excluídos: " + res.candidaturas + " candidatura(s) e " + res.arquivos + " arquivo(s).");
        return true;
      } });
    if (ok && depois) depois();
  }

  function viewTalentos(box) {
    const selecionados = new Set();
    const btConvidar = el("button", { type: "button", class: "bt", disabled: true, onclick: () => convidarTalentos([...selecionados]) }, "Convidar para uma vaga");
    const pintarBotao = () => { btConvidar.disabled = !selecionados.size; btConvidar.textContent = "Convidar para uma vaga" + (selecionados.size ? " (" + selecionados.size + ")" : ""); };
    box.append(cabecalho("Banco de talentos", "Candidatos que autorizaram ficar no banco ou que o RH marcou. Selecione quem autorizou e convide para uma vaga aberta.", btConvidar));
    carregarEm(box, "talentos_listar", {}, (area, r) => {
      area.append(el("p", { class: "pequeno suave", style: "margin:-6px 0 14px" }, "Quem autorizou fica guardado por até " + r.prazoBanco + " meses após a autorização (Configurações → Privacidade)."));
      if (!r.itens.length) return area.append(el("div", { class: "vazio" }, "Ninguém no banco de talentos ainda. Os candidatos autorizam na inscrição ou na Área do candidato; o RH marca pela ficha do candidato na vaga."));
      listaFiltrada(area, r.itens, {
        filtros: [["todas", "Todos"], ["marcados", "Marcados pelo RH"], ["autorizados", "Só autorizaram"], ["sem", "Sem autorização"]],
        grupo: c => !c.banco_talentos ? "sem" : c.talento_marcado ? "marcados" : "autorizados",
        placeholder: "Buscar por nome, e-mail, palavra-chave ou vaga",
        texto: c => [c.nome, c.email, c.talento_tags, c.talento_nota, c.candidaturas.map(x => x.titulo + " " + x.departamento).join(" ")].join(" "),
        vazio: "Ninguém neste filtro.",
        desenhar: (alvo, vis) => alvo.append(el("div", { class: "lista" }, vis.map(c => {
          const ck = c.banco_talentos ? el("input", { type: "checkbox", checked: selecionados.has(c.id), "aria-label": "Selecionar " + c.nome,
            onchange: ev => { ev.target.checked ? selecionados.add(c.id) : selecionados.delete(c.id); pintarBotao(); } }) : null;
          return el("article", { class: "card talento" },
            el("div", { class: "item-topo" },
              el("div", { class: "talento-nome" }, ck,
                el("div", null, el("h3", null, c.nome, c.talento_marcado ? el("span", { class: "estrela-tag", title: "Marcado pelo RH" }, " ★") : null),
                  el("div", { class: "meta" }, el("span", null, c.email), c.telefone ? el("span", null, c.telefone) : null,
                    c.periodo_curso ? el("span", null, "Período: " + c.periodo_curso) : null,
                    c.previsao_formatura ? el("span", null, "Formatura: " + c.previsao_formatura) : null))),
              el("div", { class: "acoes" },
                c.banco_talentos ? el("span", { class: "pill verde" }, "Autorizou") : el("span", { class: "pill ambar" }, "Sem autorização"),
                c.em_processo ? el("span", { class: "pill azul" }, "Em processo") : null,
                c.curriculo_id ? el("a", { class: "bt-sec", href: "/arquivo/" + c.curriculo_id, target: "_blank", rel: "noopener" }, "Currículo") : null,
                el("button", { type: "button", class: "bt-sec", onclick: () => editarTalento(Object.assign({ candidato_id: c.id }, c), recarregar) }, "Anotar"),
                el("button", { type: "button", class: "bt-perigo-txt", onclick: () => excluirCandidato(Object.assign({ candidato_id: c.id }, c), recarregar) }, "Excluir dados"))),
            c.talento_tags ? el("div", { class: "tags" }, c.talento_tags.split(",").map(t => el("span", { class: "tag" }, t.trim()))) : null,
            c.talento_nota ? el("p", { class: "pequeno", style: "margin:8px 0 0" }, c.talento_nota, el("span", { class: "mini" }, " — " + (c.talento_por || "RH"))) : null,
            el("ul", { class: "talento-hist" }, c.candidaturas.map(x => el("li", null, el("b", null, x.titulo), " · " + x.status +
              (x.avaliadas ? " · ★ " + x.estrelas + "/" + x.avaliadas * 3 : "") + (x.parou_em && x.status === "Encerrado" ? " · parou em " + x.parou_em : "") + " · " + fmtData(x.criado_em)))));
        })))
      });
    });
  }

  async function convidarTalentos(ids) {
    const v = await api("vagas_todas");
    if (!v.ok) return toast(v.erro, true);
    const abertas = v.vagas.filter(x => x.aberta_site);
    if (!abertas.length) return toast("Não há vaga aberta no site para convidar.", true);
    const vaga = el("select", null, abertas.map(x => el("option", { value: x.id }, x.titulo + " — " + x.id)));
    const texto = areaTexto("mensagem", "", { rows: "3", placeholder: "Mensagem opcional (ex.: por que lembramos de você)" });
    await dialogo({ titulo: "Convidar " + ids.length + " pessoa(s) para uma vaga", corpo: el("div", { class: "campos" }, campo("Vaga", vaga, { largo: true }), campo("Mensagem", texto, { largo: true })),
      okTexto: "Enviar convites",
      aoConfirmar: async () => {
        const res = await api("talento_convidar", { vaga_id: vaga.value, candidato_ids: ids, mensagem: texto.value });
        if (!res.ok) return res.erro;
        toast(res.enviados.length + " convite(s) enviado(s)." + (res.ignorados.length ? " Não enviados: " + res.ignorados.map(i => i.nome + " (" + i.motivo + ")").join("; ") : ""), !!res.ignorados.length);
        return true;
      } });
  }

  // =================================================================
  //  Indicadores (RH)
  // =================================================================
  function barras(itens, valor, rotulo, detalhe) {
    const max = Math.max(1, ...itens.map(valor));
    return el("div", { class: "barras", role: "list" }, itens.map(i => {
      const v = valor(i);
      return el("div", { class: "barra-linha", role: "listitem", title: rotulo(i) + ": " + v + (detalhe ? " — " + detalhe(i) : "") },
        el("span", { class: "barra-rot" }, rotulo(i)),
        el("span", { class: "barra-trilho" }, el("span", { class: "barra-val", style: "width:" + Math.max(v ? 2 : 0, v / max * 100) + "%" })),
        el("b", { class: "barra-num" }, String(v)),
        detalhe ? el("span", { class: "barra-det" }, detalhe(i)) : null);
    }));
  }

  function viewIndicadores(box) {
    box.append(cabecalho("Indicadores", "Como andam os processos seletivos: volume, tempo até contratar, onde os candidatos param e de onde vêm."));
    const alvo = el("div");
    const periodo = chips([[30, "30 dias"], [90, "90 dias"], [180, "6 meses"], [365, "12 meses"], [0, "Tudo"]].map(([id, nome]) => ({ id, nome })), 90, d => desenhar(d));
    box.append(el("div", { class: "filtros" }, el("span", { class: "pequeno suave" }, "Inscrições feitas nos últimos:"), periodo), alvo);
    async function desenhar(dias) {
      limpar(alvo);
      alvo.append(carregando("Calculando…"));
      const r = await api("indicadores", { dias });
      limpar(alvo);
      if (!r.ok) return alvo.append(msg("erro", r.erro || "Não foi possível calcular."));
      const s = r.resumo;
      const tile = (rot, val, sub) => el("div", { class: "numero" }, el("span", null, rot), el("b", null, val == null ? "—" : String(val)), sub ? el("small", null, sub) : null);
      alvo.append(el("div", { class: "numeros" },
        tile("Candidaturas", s.candidaturas, s.em_andamento + " em andamento"),
        tile("Contratações", s.contratados, s.admissoes_aprovadas + " admissão(ões) aprovada(s) no período"),
        tile("Dias da inscrição à contratação", s.dias_ate_contratar, s.dias_ate_contratar_mediana != null ? "mediana " + s.dias_ate_contratar_mediana + " dias" : "sem contratações no período"),
        tile("Dias da vaga aberta à contratação", s.dias_vaga_ate_contratar, null),
        tile("Desistências", s.desistencias, s.candidaturas ? Math.round(s.desistencias / s.candidaturas * 100) + "% das candidaturas" : null),
        tile("Indicações de funcionários", s.indicacoes, s.candidaturas ? Math.round(s.indicacoes / s.candidaturas * 100) + "% das candidaturas" : null)));
      if (!s.candidaturas) return alvo.append(el("div", { class: "vazio" }, "Nenhuma inscrição neste período."));

      const pior = r.etapas.filter(e => e.recusados + e.desistiram).sort((a, b) => (b.recusados + b.desistiram) / b.chegaram - (a.recusados + a.desistiram) / a.chegaram)[0];
      alvo.append(el("h2", { class: "sec" }, "Funil por etapa"),
        el("div", { class: "card" },
          pior ? el("p", { class: "pequeno", style: "margin:0 0 14px" }, "Onde mais candidatos param: ", el("b", null, pior.etapa),
            " (" + Math.round((pior.recusados + pior.desistiram) / pior.chegaram * 100) + "% recusados ou desistiram).") : null,
          barras(r.etapas, e => e.chegaram, e => e.etapa,
            e => e.aprovados + " aprovados · " + e.recusados + " recusados · " + e.desistiram + " desistiram · " + e.aguardando + " aguardando" + (e.nota_media ? " · ★ " + e.nota_media : "")),
          el("details", { class: "mais", style: "margin-top:12px" }, el("summary", null, "Ver em tabela"),
            el("div", { class: "rolagem" }, el("table", { class: "tabela" },
              el("thead", null, el("tr", null, ["Etapa", "Chegaram", "Aprovados", "Recusados", "Desistiram", "Aguardando", "Nota média"].map(t => el("th", null, t)))),
              el("tbody", null, r.etapas.map(e => el("tr", null, [e.etapa, e.chegaram, e.aprovados, e.recusados, e.desistiram, e.aguardando, e.nota_media == null ? "—" : e.nota_media].map(x => el("td", null, String(x)))))))))));

      alvo.append(el("h2", { class: "sec" }, "De onde vêm os candidatos"),
        el("div", { class: "card" }, barras(r.origens.slice().sort((a, b) => b.candidaturas - a.candidaturas), o => o.candidaturas, o => o.nome,
          o => o.contratados + " contratado(s)")));

      alvo.append(el("h2", { class: "sec" }, "Candidatos por vaga"),
        el("div", { class: "rolagem" }, el("table", { class: "tabela" },
          el("thead", null, el("tr", null, ["Vaga", "Status", "Inscritos", "Em processo", "Contratados"].map(t => el("th", null, t)))),
          el("tbody", null, r.vagas.map(v => el("tr", null,
            el("td", { class: "titulo", "data-rotulo": "Vaga" }, el("a", { href: "#vaga/" + v.id }, el("b", null, v.titulo)), el("span", { class: "mini" }, v.id + (v.departamento ? " · " + v.departamento : ""))),
            el("td", { "data-rotulo": "Status" }, pill(v.status)),
            el("td", { "data-rotulo": "Inscritos" }, String(v.inscritos)),
            el("td", { "data-rotulo": "Em processo" }, String(v.em_processo)),
            el("td", { "data-rotulo": "Contratados" }, String(v.contratados))))))));
    }
    desenhar(90);
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
        el("a", { class: "bt-sec", href: "/?page=central", target: "_blank", rel: "noopener" }, "Ver vagas no site"))));

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

    secaoAgenda(box, v);
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
        el("thead", null, el("tr", null, ["Candidato", "Inscrição", "Etapas e notas", "Situação", ""].map(t => el("th", null, t)))),
        el("tbody", null, vis.map(c => el("tr", null,
          el("td", { class: "titulo", "data-rotulo": "Candidato" }, el("b", null, c.nome), el("span", { class: "mini" }, c.email)),
          el("td", { "data-rotulo": "Inscrição" }, fmtData(c.criado_em)),
          el("td", { "data-rotulo": "Etapas" }, c.status === "Em processo" ? el("div", { class: "mini", style: "margin-bottom:4px" }, "Atual: ", el("b", null, c.etapa_atual)) : null, progresso(c)),
          el("td", { "data-rotulo": "Situação" }, pill(c.status), c.admissao_status ? el("div", { class: "mini" }, (STATUS[c.admissao_status] || [c.admissao_status])[0]) : null),
          el("td", { "data-rotulo": "" }, el("button", { type: "button", class: rh && c.status === "Em processo" ? "bt" : "bt-sec", onclick: () => abrirCandidato(c, v, rh) }, rh && c.status === "Em processo" ? "Avaliar" : "Abrir")))))))),
      vazio: "Nenhum candidato neste filtro."
    });
    // Volta para a ficha do candidato depois de salvar uma etapa
    if (reabrirCandidato) {
      const c = r.candidatos.find(x => x.id === reabrirCandidato);
      reabrirCandidato = null;
      if (c) abrirCandidato(c, v, rh);
    }
  }

  // =================================================================
  //  Candidato na vaga: linha do tempo das etapas e avaliação (RHC-PROC-2026-001, 5.4–5.7)
  // =================================================================
  const NOTAS = ["Sem nota", "Abaixo do esperado", "Dentro do esperado", "Acima do esperado"];
  const ROT_ETAPA = { Aprovado: ["Aprovado", "verde"], Reprovado: ["Recusado", "verm"], Pendente: ["A avaliar", "cinza"] };
  let reabrirCandidato = null; // depois de salvar uma etapa, a ficha do candidato abre de novo

  function estrelas(n) {
    return el("span", { class: "estrelas", title: n ? n + " de 3 — " + NOTAS[n] : NOTAS[0], "aria-label": n ? n + " de 3 estrelas" : NOTAS[0] },
      [1, 2, 3].map(i => el("span", { class: i <= n ? "cheia" : "", "aria-hidden": "true" }, "★")));
  }
  const pillEtapa = r => { const s = ROT_ETAPA[r] || [r, "cinza"]; return el("span", { class: "pill " + s[1] }, s[0]); };
  const ehTriagem = e => e.ordem === 1 || /triagem/i.test(e.nome);
  const candidatoTravado = c => ["Proposta", "Contratado", "Desistiu"].indexOf(c.status) >= 0;

  // Situação de cada etapa: concluída, recusada, atual (pode avaliar) ou bloqueada (espera a anterior)
  function etapasComEstado(c) {
    let bloqueia = false;
    return c.etapas.slice().sort((a, b) => a.ordem - b.ordem).map(e => {
      const estado = e.resultado === "Aprovado" ? "concluida" : e.resultado === "Reprovado" ? "recusada" : bloqueia ? "bloqueada" : "atual";
      if (e.resultado !== "Aprovado") bloqueia = true;
      return Object.assign({ estado }, e);
    });
  }

  // Trilha de bolinhas + soma das estrelas (lista de candidatos)
  function progresso(c) {
    const ets = etapasComEstado(c);
    const avaliadas = ets.filter(e => e.nota);
    const soma = avaliadas.reduce((t, e) => t + e.nota, 0);
    return el("div", { class: "progresso" },
      el("div", { class: "trilha", "aria-hidden": "true" }, ets.map(e => el("span", {
        class: "passo " + e.estado, title: e.ordem + ". " + e.nome + " — " + (ROT_ETAPA[e.resultado] || [e.resultado])[0] + (e.nota ? " · " + e.nota + " estrela(s)" : "")
      }))),
      avaliadas.length ? el("span", { class: "mini", title: "Soma das estrelas nas etapas avaliadas" }, "★ " + soma + "/" + avaliadas.length * 3) : null);
  }

  function abrirCandidato(c, vaga, rh) {
    const ets = etapasComEstado(c);
    const travado = candidatoTravado(c);
    const atual = ets.find(e => e.estado === "atual");

    const topo = el("div", { class: "cand-topo" },
      el("div", null,
        el("div", { class: "meta" }, pill(c.status), el("span", null, c.email), c.telefone ? el("span", null, c.telefone) : null,
          el("span", null, "Inscrição " + fmtData(c.criado_em))),
        el("div", { class: "meta", style: "margin-top:6px" },
          c.periodo_curso ? el("span", null, "Período: ", el("b", null, c.periodo_curso)) : null,
          c.previsao_formatura ? el("span", null, "Formatura: ", el("b", null, c.previsao_formatura)) : null,
          c.origem_nome ? el("span", null, "Origem: ", el("b", null, c.origem_nome + (c.indicado_por ? " (" + c.indicado_por + ")" : ""))) : null,
          c.banco_talentos ? el("span", { class: "pill verde" }, "Banco de talentos") : null)),
      el("div", { class: "acoes" },
        c.curriculo_id ? el("a", { class: "bt-sec", href: "/arquivo/" + c.curriculo_id, target: "_blank", rel: "noopener" }, "Abrir currículo (PDF)") : null,
        rh && atual && !travado ? el("button", { type: "button", class: "bt", onclick: () => editarEtapa(atual, c, vaga) }, "Avaliar: " + atual.nome) : null,
        rh && c.admissao_id ? el("a", { class: "bt-sec", href: "#admissao/" + c.admissao_id }, "Ver admissão") : null,
        rh ? el("button", { type: "button", class: "bt-sec", onclick: () => editarTalento(c, recarregar) }, (c.talento_marcado ? "★ " : "") + "Banco de talentos") : null,
        rh && !c.admissao_id && c.status === "Aprovado" ? el("button", { type: "button", class: "bt", onclick: () => abrirProposta(c, vaga) }, "Enviar proposta") : null));

    const mensagem = c.mensagem ? el("details", { class: "mais" }, el("summary", null, "Mensagem do candidato"), el("p", { class: "pre pequeno", style: "margin:8px 0 0" }, c.mensagem)) : null;

    const fim = c.status === "Aprovado" ? el("div", { class: "nota verde" }, el("strong", null, "Aprovado em todas as etapas"),
        rh && !c.admissao_id ? "Próximo passo: enviar a proposta." : "")
      : c.status === "Encerrado" ? el("div", { class: "nota verm" }, el("strong", null, "Processo encerrado"), "O candidato foi recusado e recebeu o feedback por e-mail.")
      : travado ? el("div", { class: "nota azul" }, "Candidato em " + c.status.toLowerCase() + ": as etapas não podem mais ser alteradas.") : null;

    const linha = el("ol", { class: "linha-etapas" }, ets.map(e => el("li", { class: "etapa-item " + e.estado },
      el("div", { class: "etapa-marca", "aria-hidden": "true" }, e.estado === "concluida" ? "✓" : e.estado === "recusada" ? "✕" : String(e.ordem)),
      el("div", { class: "etapa-corpo" },
        el("div", { class: "etapa-topo" },
          el("b", null, e.nome), pillEtapa(e.resultado), e.nota ? estrelas(e.nota) : null,
          rh && !travado && e.estado !== "bloqueada" ? el("button", {
            type: "button", class: e.estado === "atual" ? "bt" : "bt-sec", onclick: () => editarEtapa(e, c, vaga)
          }, e.estado === "atual" ? "Avaliar" : "Editar") : null),
        e.motivo ? el("p", { class: "etapa-analise" }, e.motivo) : null,
        el("div", { class: "mini" }, [
          e.data_prevista ? "Agendada para " + fmtData(e.data_prevista) : "",
          e.data_realizada && e.resultado !== "Pendente" ? "Avaliada em " + fmtData(e.data_realizada) : "",
          e.responsavel && e.resultado !== "Pendente" ? "por " + e.responsavel : "",
          e.notificado_em ? "e-mail ao candidato em " + fmtData(e.notificado_em, true) : ""].filter(Boolean).join(" · ")),
        e.obs ? el("div", { class: "mini" }, "Observação interna: " + e.obs) : null,
        e.estado === "bloqueada" ? el("div", { class: "mini" }, "Libera quando a etapa anterior for aprovada.") : null))));

    const rodape = rh ? el("div", { class: "acoes", style: "margin-top:16px;justify-content:flex-end" },
        !c.admissao_id ? el("button", { type: "button", class: "bt-perigo-txt", onclick: () => excluirCandidato(c, recarregar) }, "Excluir dados (LGPD)") : null,
        !travado && ["Em processo", "Aprovado"].indexOf(c.status) >= 0
          ? el("button", { type: "button", class: "bt-perigo", onclick: () => marcarDesistencia(c) }, "Registrar desistência") : null)
      : null;

    dialogo({ titulo: c.nome + " — " + vaga.titulo, corpo: el("div", null, topo, mensagem, fim, el("h3", { class: "titulo-etapas" }, "Etapas do processo"), linha, rodape),
      semOk: true, largo: true });
  }

  async function editarEtapa(e, c, vaga) {
    const triagem = ehTriagem(e);
    let nota = e.nota || 0;
    let decisao = e.resultado === "Pendente" ? "" : e.resultado;
    const jaRecusou = e.resultado === "Reprovado" && e.notificado_em;

    // Estrelas
    const legenda = el("span", { class: "estrelas-legenda" });
    const botoesEstrela = [1, 2, 3].map(i => el("button", {
      type: "button", class: "estrela", role: "radio", "aria-label": i + (i > 1 ? " estrelas" : " estrela") + " — " + NOTAS[i],
      onclick: () => { nota = i; pintar(); }
    }, "★"));
    const blocoNota = el("div", { class: "aval-bloco" },
      el("div", { class: "aval-rotulo" }, "Nota da etapa", el("span", { class: "req" }, " *")),
      el("div", { class: "estrelas-escolha" }, el("div", { role: "radiogroup", "aria-label": "Nota da etapa" }, botoesEstrela), legenda));

    // Decisão
    const btAprovar = el("button", { type: "button", class: "decisao aprovar", onclick: () => { decisao = "Aprovado"; pintar(); } },
      el("b", null, "✓ Aprovado"), el("span", null, "Segue para a próxima etapa"));
    const btRecusar = el("button", { type: "button", class: "decisao recusar", onclick: () => { decisao = "Reprovado"; pintar(); } },
      el("b", null, "✕ Recusado"), el("span", null, "Encerra o processo e envia o feedback"));
    const blocoDecisao = el("div", { class: "aval-bloco" },
      el("div", { class: "aval-rotulo" }, "Resultado", el("span", { class: "req" }, " *")),
      el("div", { class: "decisoes" }, btAprovar, btRecusar));

    // Análise / feedback
    const analise = el("textarea", { name: "analise", rows: "5", placeholder: "Pontos fortes, pontos a desenvolver e o que levou à decisão." });
    analise.value = e.motivo || "";
    analise.id = "avalAnalise";
    const rotuloAnalise = el("label", { class: "aval-rotulo", for: "avalAnalise" });
    const dicaAnalise = el("small", { class: "suave" });
    const blocoAnalise = el("div", { class: "aval-bloco" }, rotuloAnalise, analise, dicaAnalise);

    // Prévia do e-mail de recusa
    const previaTexto = el("p", { class: "pre" });
    const previa = el("div", { class: "previa-email" },
      el("div", { class: "previa-cab" }, "O candidato vai receber este e-mail", el("span", null, c.email)),
      el("p", null, "Olá, " + String(c.nome).split(" ")[0] + "."),
      el("p", null, "Agradecemos sua participação no processo seletivo para " + vaga.titulo + ". Neste momento, sua candidatura não seguirá para as próximas etapas."),
      el("p", null, el("b", null, "Retorno sobre a etapa " + e.nome + ":")), previaTexto,
      el("p", null, "Desejamos sucesso e esperamos ver você em outras oportunidades da Innomaker."));

    // Aviso de aprovação (opcional)
    const avisar = el("input", { type: "checkbox", checked: !e.notificado_em });
    const caixaAvisar = el("label", { class: "check" }, avisar,
      el("span", null, "Avisar o candidato por e-mail que ele foi aprovado nesta etapa",
        e.notificado_em ? el("span", { class: "mini" }, " (um e-mail já foi enviado em " + fmtData(e.notificado_em, true) + ")") : null));

    // Datas e responsável (Triagem não tem data prevista)
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const dataRealizada = entrada("data_realizada", e.data_realizada || hoje, { type: "date" });
    const dataPrevista = triagem ? null : entrada("data_prevista", e.data_prevista, { type: "date" });
    const responsavel = entrada("responsavel", e.responsavel || U.nome);
    const detalhes = el("div", { class: "campos" },
      dataPrevista ? campo("Data agendada (entrevista / teste)", dataPrevista) : null,
      campo(triagem ? "Data da análise do currículo" : "Data em que a etapa foi feita", dataRealizada),
      campo("Avaliado por", responsavel));
    const obs = el("textarea", { name: "obs", rows: "2", placeholder: "Só o RH vê. Não vai para o candidato." });
    obs.value = e.obs || "";
    const blocoObs = el("details", { class: "mais", open: !!e.obs }, el("summary", null, "Observação interna (opcional)"), obs);

    function pintar() {
      botoesEstrela.forEach((b, i) => { b.classList.toggle("cheia", i < nota); b.setAttribute("aria-checked", String(i + 1 === nota)); });
      legenda.textContent = nota ? NOTAS[nota] : "Clique nas estrelas";
      btAprovar.setAttribute("aria-pressed", String(decisao === "Aprovado"));
      btRecusar.setAttribute("aria-pressed", String(decisao === "Reprovado"));
      const recusa = decisao === "Reprovado";
      rotuloAnalise.textContent = recusa ? "Feedback para o candidato *" : "Análise da etapa *";
      dicaAnalise.textContent = recusa
        ? (jaRecusou ? "O feedback já foi enviado em " + fmtData(e.notificado_em, true) + ". Salvar de novo atualiza o registro, mas não reenvia o e-mail." : "Este texto vai no e-mail ao candidato. Seja respeitoso e objetivo.")
        : "Registro interno do processo seletivo.";
      previa.hidden = !recusa || !!jaRecusou;
      previaTexto.textContent = analise.value.trim() || "(escreva o feedback acima)";
      caixaAvisar.hidden = decisao !== "Aprovado";
      const ok = $("dlgOk");
      if (ok && !ok.disabled) {
        ok.textContent = recusa && !jaRecusou ? "Recusar e enviar feedback" : "Salvar avaliação";
        ok.className = recusa ? "bt-perigo" : "bt";
      }
    }
    analise.addEventListener("input", pintar);

    const corpo = el("div", { class: "avaliacao" },
      el("p", { class: "suave pequeno", style: "margin:0" }, "Etapa " + e.ordem + " de " + c.etapas.length + " · " + vaga.titulo),
      blocoNota, blocoDecisao, blocoAnalise, previa, caixaAvisar, detalhes, blocoObs);

    const p = dialogo({
      titulo: e.nome + " — " + c.nome, corpo, okTexto: "Salvar avaliação", largo: true,
      aoConfirmar: async () => {
        if (!nota) return "Dê a nota da etapa (1 a 3 estrelas).";
        if (!decisao) return "Escolha Aprovado ou Recusado.";
        if (analise.value.trim().length < 5) return decisao === "Reprovado" ? "Escreva o feedback para o candidato." : "Escreva a análise da etapa.";
        const r = await api("etapa_atualizar", {
          etapa_id: e.id, resultado: decisao, nota, analise: analise.value, obs: obs.value, responsavel: responsavel.value,
          data_realizada: dataRealizada.value, data_prevista: dataPrevista ? dataPrevista.value : "", avisar_candidato: avisar.checked
        });
        if (!r.ok) return r.erro;
        toast(decisao === "Reprovado"
          ? (r.emailEnviado ? "Candidato recusado. O feedback foi enviado por e-mail." : "Avaliação salva.")
          : "Etapa aprovada" + (r.emailEnviado ? " e candidato avisado por e-mail." : ".") + (r.status === "Aprovado" ? " Todas as etapas concluídas: envie a proposta." : ""));
        return true;
      }
    });
    pintar();
    if (await p) { reabrirCandidato = c.id; recarregar(); }
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

  // ---------- Proposta: formulário (enviar e editar) ----------
  const hojeBR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const maisDias = n => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + n * 864e5));
  const OBRIG_PROPOSTA = ["email_contato", "tipo_contratacao", "cargo", "funcao", "departamento", "horario_trabalho", "data_inicio", "bolsa_valor", "prazo_resposta"];

  function formProposta(op, v, aviso) {
    const deps = op.departamentos.map(d => d.nome);
    return el("form", { novalidate: true },
      el("p", { class: "suave", style: "margin:0 0 12px" }, aviso),
      el("div", { class: "campos" },
        campo("E-mail pessoal do candidato (não pode ser IdUFF)", entrada("email_contato", v.email_contato, { type: "email" }), { obrigatorio: true, nome: "email_contato" }),
        campo("Responder até", entrada("prazo_resposta", v.prazo_resposta || maisDias(5), { type: "date", min: hojeBR() }),
          { obrigatorio: true, nome: "prazo_resposta", dica: "Depois desse dia a proposta vence sozinha e o RH é avisado." }),
        campo("Tipo de contratação", seletor("tipo_contratacao", lista(op, "tipo_contratacao"), v.tipo_contratacao), { obrigatorio: true, nome: "tipo_contratacao",
          dica: "Define os documentos que o candidato precisa enviar (Configurações → Admissão)." }),
        campo("Situação", seletor("situacao", lista(op, "situacao"), v.situacao || "")),
        campo("Cargo", el("div", null, comLista(entrada("cargo", v.cargo || ""), lista(op, "cargo"))), { obrigatorio: true, nome: "cargo" }),
        campo("Função", el("div", null, comLista(entrada("funcao", v.funcao || ""), lista(op, "funcao"))), { obrigatorio: true, nome: "funcao" }),
        campo("Departamento", el("div", null, comLista(entrada("departamento", v.departamento || ""), deps)), { obrigatorio: true, nome: "departamento" }),
        campo("Setor", el("div", null, comLista(entrada("setor", v.setor || ""), lista(op, "setor")))),
        campo("Horário de trabalho", el("div", null, comLista(entrada("horario_trabalho", v.horario_trabalho || ""), lista(op, "horario"))), { obrigatorio: true, nome: "horario_trabalho" }),
        campo("Data de início (onboarding)", entrada("data_inicio", v.data_inicio || "", { type: "date" }), { obrigatorio: true, nome: "data_inicio" }),
        campo("Bolsa / remuneração", entrada("bolsa_valor", v.bolsa_valor || ""), { obrigatorio: true, nome: "bolsa_valor" }),
        campo("Auxílio", seletor("auxilio", lista(op, "auxilio"), v.auxilio || "")),
        campo("Responsável", entrada("responsavel", v.responsavel || "")),
        campo("Entidade vinculada", entrada("entidade_vinculada", v.entidade_vinculada || "")),
        campo("Início da bolsa", entrada("data_inicial_bolsa", v.data_inicial_bolsa || "", { type: "date" })),
        campo("Fim da bolsa / contrato", entrada("data_final_bolsa", v.data_final_bolsa || "", { type: "date" }), { dica: "Se vazio, o contrato vale 1 ano a partir do início." }),
        campo("Gestor", entrada("gestor_nome", v.gestor_nome || "")),
        campo("E-mail do gestor", entrada("gestor_email", v.gestor_email || "", { type: "email" }), { dica: "Recebe o aviso da aprovação e da véspera do 1º dia." }),
        campo("Observação interna", areaTexto("observacao", v.observacao || ""), { largo: true, dica: "Só o RH vê." })),
      el("label", { class: "check", style: "margin-top:12px", dataset: { campo: "conferido" } }, el("input", { type: "checkbox", name: "conferido" }),
        el("span", null, "Conferi todas as informações.")));
  }

  function lerFormProposta(f) {
    const d = lerForm(f);
    const falta = OBRIG_PROPOSTA.filter(k => !String(d[k] || "").trim());
    if (!d.conferido) falta.push("conferido");
    if (falta.length) { marcarFaltando(f, falta); return { erro: "Preencha os campos obrigatórios e confirme a conferência." }; }
    if (/@id\.uff\.br$/i.test(d.email_contato)) return { erro: "Não é permitido usar e-mail @id.uff.br." };
    const extra = { email_contato: d.email_contato, prazo_resposta: d.prazo_resposta };
    delete d.email_contato; delete d.prazo_resposta; delete d.conferido;
    return Object.assign(extra, { proposta: d });
  }

  async function abrirProposta(c, vaga) {
    const op = await opcoes();
    const f = formProposta(op, { email_contato: c.email, tipo_contratacao: vaga.tipo_contratacao, funcao: vaga.titulo, departamento: vaga.departamento,
      horario_trabalho: vaga.carga_horaria, bolsa_valor: vaga.remuneracao, responsavel: vaga.gestor_nome, gestor_nome: vaga.gestor_nome, gestor_email: vaga.gestor_email },
      "Revisão obrigatória: confira se tudo pertence ao candidato correto e à contratação autorizada. A data de início é a mesma do onboarding.");
    await dialogo({
      titulo: "Proposta para " + c.nome, corpo: f, okTexto: "Enviar proposta", largo: true,
      aoConfirmar: async () => {
        const d = lerFormProposta(f);
        if (d.erro) return d.erro;
        const r = await api("proposta_criar", Object.assign({ candidatura_id: c.id }, d));
        if (!r.ok) return r.erro;
        toast("Proposta " + r.id + " enviada.");
        return true;
      }
    }) && recarregar();
  }

  async function editarProposta(a) {
    const op = await opcoes();
    const aceita = ["COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA", "AGUARDANDO_APROVACAO"].indexOf(a.status) >= 0;
    const aviso = a.status === "PROPOSTA_EXPIRADA" ? "A proposta venceu. Dê um novo prazo para reabrir: o candidato recebe um e-mail."
      : aceita ? "O candidato já aceitou. Se mudar algo que ele vê (bolsa, horário, função, datas…), ele precisa aceitar de novo; o cadastro dele é mantido. Mudanças só no que é interno não reabrem a proposta."
      : "O candidato ainda não respondeu. Ele recebe um e-mail com o que mudou.";
    const f = formProposta(op, Object.assign({ email_contato: a.email_contato, prazo_resposta: a.prazo_resposta && a.prazo_resposta >= hojeBR() ? a.prazo_resposta : maisDias(5) }, a.proposta), aviso);
    await dialogo({
      titulo: "Editar proposta — " + a.candidato_nome, corpo: f, okTexto: "Salvar proposta", largo: true,
      aoConfirmar: async () => {
        const d = lerFormProposta(f);
        if (d.erro) return d.erro;
        const r = await api("adm_proposta_salvar", Object.assign({ id: a.id }, d));
        if (!r.ok) return r.erro;
        toast(r.precisaAceitar ? "Proposta salva. O candidato foi avisado e precisa aceitar." : "Proposta salva (sem mudar nada que o candidato vê).");
        return true;
      }
    }) && recarregar();
  }

  async function cancelarAdm(a) {
    const motivo = areaTexto("motivo", "", { placeholder: "Ex.: vaga suspensa pela diretoria." });
    const avisar = el("input", { type: "checkbox", checked: true });
    await dialogo({
      titulo: "Cancelar admissão de " + a.candidato_nome, okTexto: "Cancelar admissão", okClasse: "bt-perigo",
      corpo: el("div", null, el("div", { class: "nota ambar", style: "margin:0 0 12px" }, "O candidato volta a \"Aprovado no processo\": você pode enviar outra proposta depois. O cadastro e os arquivos ficam guardados no histórico."),
        campo("Motivo", motivo, { largo: true }), el("label", { class: "check", style: "margin-top:10px" }, avisar, el("span", null, "Avisar o candidato por e-mail (com o motivo)"))),
      aoConfirmar: async () => {
        const r = await api("adm_cancelar", { id: a.id, motivo: motivo.value, avisar: avisar.checked });
        if (!r.ok) return r.erro;
        toast("Admissão cancelada.");
        return true;
      }
    }) && recarregar();
  }

  // =================================================================
  //  Admissões (RHC-PROC-2026-003)
  // =================================================================
  function trilhaMini(t) {
    return el("div", { class: "trilha-mini", title: t.passos.map(p => (p.feito ? "✓ " : "· ") + p.nome).join("\n") },
      el("div", { class: "trilha", "aria-hidden": "true" }, t.passos.map(p => el("span", { class: "passo " + (p.feito ? "concluida" : p.encerrado ? "recusada" : p.bloqueado ? "bloqueada" : "atual") }))),
      el("span", { class: "mini" }, t.concluida ? "Admissão concluída" : t.feitos + " de " + t.total + (t.proximo ? " · Próximo: " + t.proximo : "")));
  }

  function prazoPill(a, hoje) {
    if (a.status !== "PROPOSTA_ENVIADA" || !a.prazo_resposta) return null;
    const vencendo = a.prazo_resposta <= maisDias(1);
    return el("span", { class: "pill " + (a.prazo_resposta < hoje ? "verm" : vencendo ? "ambar" : "cinza") }, "Responder até " + fmtData(a.prazo_resposta));
  }

  function listaAdmissoes(area, itens, hoje, comFiltros) {
    const grupo = i => i.status === "AGUARDANDO_APROVACAO" ? "conferir"
      : ["PROPOSTA_ENVIADA", "COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA"].indexOf(i.status) >= 0 ? "andamento"
      : i.status === "APROVADA" ? (i.trilha.concluida ? "concluidas" : "pos") : "encerradas";
    listaFiltrada(area, itens, {
      inicial: comFiltros && itens.some(i => grupo(i) === "conferir") ? "conferir" : "todas",
      filtros: [["conferir", "Para conferir"], ["andamento", "Com o candidato"], ["pos", "Pós-aprovação"], ["concluidas", "Concluídas"], ["encerradas", "Encerradas"], ["todas", "Todas"]],
      grupo, placeholder: "Buscar por candidato, vaga ou ID", texto: i => [i.id, i.candidato_nome, i.email_contato, i.titulo_vaga].join(" "),
      desenhar: (alvo, vis) => vis.forEach(i => alvo.append(el(comFiltros ? "a" : "div", { class: "card" + (comFiltros ? " atalho" : ""), href: comFiltros ? "#admissao/" + i.id : null },
        el("div", { class: "item-topo" },
          el("div", null, el("h3", null, i.candidato_nome),
            el("div", { class: "meta" }, el("span", null, el("b", null, i.titulo_vaga)), el("span", null, i.id), i.data_inicio ? el("span", null, "Início " + fmtData(i.data_inicio)) : null,
              el("span", null, "Atualizado " + fmtData(i.atualizado_em, true)))),
          el("div", { class: "acoes" }, prazoPill(i, hoje), pillAdm(i.status))),
        trilhaMini(i.trilha))))
    });
  }

  function viewAdmissoes(box) {
    box.append(cabecalho("Admissões", "Envie propostas pela vaga (Candidatos → Enviar proposta). Cada admissão mostra a trilha até o onboarding."));
    carregarEm(box, "adm_listar", {}, (area, r) => {
      if (!r.itens.length) return area.append(el("div", { class: "vazio" }, "Nenhuma admissão ainda. Envie uma proposta a partir dos candidatos de uma vaga."));
      listaAdmissoes(area, r.itens, r.hoje, true);
    });
  }

  function viewAdmArea(box) {
    box.append(cabecalho("Admissões da minha área", "Acompanhe as contratações das vagas da sua área: proposta, cadastro, documentos e primeiro dia."));
    carregarEm(box, "adm_area", {}, (area, r) => {
      if (!r.itens.length) return area.append(el("div", { class: "vazio" }, "Nenhuma admissão nas vagas da sua área."));
      listaAdmissoes(area, r.itens, hojeBR(), false);
    });
  }

  const ETAPAS_CADASTRO = [["pessoais", "Dados pessoais"], ["endereco", "Endereço e emergência"], ["formacao", "Formação"], ["banco", "Dados bancários"]];

  async function viewAdmissaoDetalhe(box, id) {
    const a0 = el("div", null, carregando());
    box.append(a0);
    const r = await api("adm_detalhe", { id });
    a0.remove();
    if (!r.ok) return box.append(msg("erro", r.erro));
    const a = r.admissao, p = a.proposta, c = a.cadastro;
    const st = a.status;
    const conferindo = st === "AGUARDANDO_APROVACAO";
    const marcados = new Map(); // itens marcados para correção
    const antesAprov = ["PROPOSTA_ENVIADA", "COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA", "AGUARDANDO_APROVACAO", "PROPOSTA_EXPIRADA"].indexOf(st) >= 0;
    box.append(cabecalho(a.candidato_nome, a.titulo_vaga + " · " + a.id, [
      conferindo ? el("button", { type: "button", class: "bt", onclick: () => aprovarAdm(a, r.modelos, r.documentosFaltando) }, "Aprovar cadastro") : null,
      antesAprov ? el("button", { type: "button", class: "bt-sec", onclick: () => editarProposta(a) }, st === "PROPOSTA_EXPIRADA" ? "Reabrir proposta" : "Editar proposta") : null,
      ["PROPOSTA_ENVIADA", "COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA"].indexOf(st) >= 0 ? el("button", { type: "button", class: "bt-sec", onclick: () => reenviarAdm(a) }, "Reenviar e-mail") : null,
      conferindo ? el("button", { type: "button", class: "bt-alerta", onclick: () => decidirAdm(a, "correcao", [...marcados.values()]) }, "Pedir correção") : null,
      conferindo ? el("button", { type: "button", class: "bt-perigo", onclick: () => decidirAdm(a, "recusar") }, "Recusar") : null,
      antesAprov ? el("button", { type: "button", class: "bt-perigo-txt", onclick: () => cancelarAdm(a) }, "Cancelar admissão") : null,
      a.funcionario_id ? el("a", { class: "bt", href: "#funcionario/" + a.funcionario_id }, "Ver funcionário") : null
    ], ["#admissoes", "Admissões"]));

    box.append(el("div", { class: "card" }, el("div", { class: "meta" }, pillAdm(st), el("span", null, "E-mail: " + a.email_contato),
      st === "PROPOSTA_ENVIADA" && a.prazo_resposta ? el("span", null, "Responder até ", el("b", null, fmtData(a.prazo_resposta))) : null,
      a.prazo_vencido ? el("span", { class: "pill verm" }, "Prazo vencido") : null)));

    // Trilha da admissão
    box.append(el("h2", { class: "sec" }, "Trilha da admissão"), cartaoTrilha(a, r.trilha, r.emailAcessos));

    // Itens corrigidos pelo candidato (depois de um pedido de correção)
    const corr = a.correcoes || {};
    const ultima = (a.historico || []).slice(-1)[0] || {};
    if (conferindo && corr.itens && corr.itens.length && ultima.acao === "Cadastro corrigido") {
      box.append(el("div", { class: "nota azul" }, el("strong", null, "O candidato corrigiu o que você pediu em " + fmtData(corr.em, true)),
        el("ul", { class: "lista-corrigidos" }, corr.itens.map(i => el("li", null, el("b", null, i.rotulo + ": "),
          i.tipo === "campo" ? [el("span", { class: "antes" }, i.valor_antes || "(vazio)"), " → ", el("b", null, c[i.chave] || "(vazio)")] : "novo arquivo enviado (veja abaixo)",
          el("span", { class: "mini" }, " — pedido: " + i.comentario))))));
    }

    // Itens marcados para correção (só na conferência)
    const barra = el("div", { class: "barra-correcao", hidden: true });
    const pintarBarra = () => {
      limpar(barra);
      barra.hidden = !marcados.size;
      if (!marcados.size) return;
      barra.append(el("span", null, el("b", null, String(marcados.size)), " item(ns) marcado(s) para correção"),
        el("button", { type: "button", class: "bt-alerta", onclick: () => decidirAdm(a, "correcao", [...marcados.values()]) }, "Pedir correção"));
    };
    const bandeira = (tipo, chave, rotulo, linha) => {
      if (!conferindo) return null;
      const k = tipo + ":" + chave;
      const bt = el("button", { type: "button", class: "bt-flag", title: "Marcar para correção", "aria-pressed": "false", onclick: () => {
        if (marcados.has(k)) marcados.delete(k); else marcados.set(k, { tipo, chave, rotulo });
        bt.setAttribute("aria-pressed", String(marcados.has(k)));
        bt.textContent = marcados.has(k) ? "Marcado" : "Corrigir";
        linha.classList.toggle("marcado", marcados.has(k));
        pintarBarra();
      } }, "Corrigir");
      return bt;
    };

    if (conferindo) box.append(el("div", { class: "nota ambar" }, el("strong", null, "Conferência obrigatória (item 4.5)"),
      "Confira cada campo e documento. Clique em \"Corrigir\" no que estiver errado; depois \"Pedir correção\" com o que ajustar em cada item. " +
      "O candidato vê só os itens marcados. Se estiver tudo certo, use \"Aprovar cadastro\"."));

    box.append(el("h2", { class: "sec" }, "Proposta"), el("div", { class: "card" }, dados([
      ["Contratação", p.tipo_contratacao], ["Situação", p.situacao], ["Cargo", p.cargo], ["Função", p.funcao], ["Departamento", p.departamento], ["Setor", p.setor],
      ["Horário", p.horario_trabalho], ["Início", fmtData(p.data_inicio)], ["Bolsa / remuneração", p.bolsa_valor], ["Auxílio", p.auxilio], ["Responsável", p.responsavel],
      ["Entidade vinculada", p.entidade_vinculada], ["Bolsa de/até", [fmtData(p.data_inicial_bolsa), fmtData(p.data_final_bolsa)].filter(Boolean).join(" até ")],
      ["Gestor", [p.gestor_nome, p.gestor_email].filter(Boolean).join(" — ")], ["Observação interna", p.observacao]])));

    if (Object.keys(c).length) {
      const flagados = new Set((corr.itens || []).map(i => i.tipo + ":" + i.chave));
      box.append(el("h2", { class: "sec" }, "Cadastro enviado"), el("div", { class: "card cad-rh" }, ETAPAS_CADASTRO.map(([etapa, nomeEtapa]) =>
        el("div", { class: "cad-bloco" }, el("h3", null, nomeEtapa), el("div", { class: "cad-linhas" }, r.camposCadastro.filter(x => x.etapa === etapa).map(x => {
          const linha = el("div", { class: "cad-linha" + (x.obrigatorio && !c[x.chave] ? " vazio" : "") + (flagados.has("campo:" + x.chave) && ultima.acao === "Cadastro corrigido" ? " corrigido" : "") });
          linha.append(el("span", { class: "cad-rot" }, x.rotulo), el("span", { class: "cad-val" }, (x.chave === "data_nascimento" ? fmtData(c[x.chave]) : c[x.chave]) || "—"),
            bandeira("campo", x.chave, x.rotulo, linha));
          return linha;
        }))))));
    }

    // Documentos: um por tipo, com os obrigatórios do contrato
    const faltando = new Set(r.documentosFaltando || []);
    const porCat = cat => r.arquivos.filter(x => x.categoria === cat);
    const antigos = r.arquivos.filter(x => !r.documentosExigidos.some(d => d.id === x.categoria));
    const flagArq = new Set((corr.itens || []).filter(i => i.tipo === "arquivo").map(i => i.chave));
    const linhasDocs = r.documentosExigidos.filter(d => d.obrigatorio || porCat(d.id).length).map(d => {
      const linha = el("div", { class: "doc-linha" + (faltando.has(d.id) ? " vazio" : "") });
      const arqs = porCat(d.id);
      linha.append(el("div", { class: "doc-info" }, el("b", null, d.nome), d.obrigatorio ? el("span", { class: "mini" }, " obrigatório") : null,
          el("div", { class: "doc-arqs" }, arqs.length ? arqs.map(x => el("a", { href: "/arquivo/" + x.id, target: "_blank", rel: "noopener",
            class: flagArq.has(d.id) && corr.em && x.criado_em > corr.em ? "novo" : "" }, x.nome + (flagArq.has(d.id) && corr.em && x.criado_em > corr.em ? " (novo)" : ""))) : el("span", { class: "pill verm" }, "Falta"))),
        arqs.length ? bandeira("arquivo", d.id, d.nome, linha) : null);
      return linha;
    });
    antigos.forEach(x => {
      const linha = el("div", { class: "doc-linha" });
      linha.append(el("div", { class: "doc-info" }, el("b", null, x.categoria_nome), el("div", { class: "doc-arqs" }, el("a", { href: "/arquivo/" + x.id, target: "_blank", rel: "noopener" }, x.nome))),
        bandeira("arquivo", x.categoria, x.categoria_nome, linha));
      linhasDocs.push(linha);
    });
    box.append(el("h2", { class: "sec" }, "Documentos enviados"),
      linhasDocs.length ? el("div", { class: "card docs-rh" }, linhasDocs) : el("div", { class: "vazio" }, "Nenhum arquivo enviado ainda."));
    box.append(barra);

    if (r.documentos.length) {
      box.append(el("h2", { class: "sec" }, "Documentos para assinatura"), el("div", { class: "lista" }, r.documentos.map(d =>
        el("div", { class: "card item-topo" }, el("a", { href: "/documento/" + d.id, target: "_blank", rel: "noopener" }, el("b", null, d.titulo)), pill(d.status)))));
    }
    box.append(el("h2", { class: "sec" }, "Histórico"), el("div", { class: "card" }, el("ul", { class: "pequeno", style: "margin:0;padding-left:18px" },
      a.historico.map(h => el("li", null, fmtData(h.quando, true) + " — ", el("b", null, h.acao), " (" + String(h.quem).replace(/ <.*>$/, "") + ")" + (h.texto ? ": " + h.texto : ""))))));
  }

  function cartaoTrilha(a, t, emailAcessos) {
    const lista = el("ol", { class: "trilha-adm" }, t.passos.map((p, i) => {
      const estado = p.feito ? "feito" : p.encerrado ? "encerrado" : p.bloqueado ? "bloqueado" : "pendente";
      const acoes = [];
      if (p.manual && !p.bloqueado) {
        acoes.push(el("button", { type: "button", class: p.feito ? "bt-perigo-txt" : "bt-sec", onclick: async ev => {
          ev.currentTarget.disabled = true;
          const res = await api("adm_passo", { id: a.id, passo: p.id, feito: !p.feito });
          if (!res.ok) { ev.currentTarget.disabled = false; return toast(res.erro, true); }
          toast(p.nome + (p.feito ? " desmarcado." : " marcado como feito."));
          recarregar();
        } }, p.feito ? "Desfazer" : "Marcar como feito"));
        if (p.id === "acessos" && !p.feito) acoes.push(el("button", { type: "button", class: "bt-sec", onclick: () => pedirAcessos(a, emailAcessos) }, "Pedir acessos"));
      }
      return el("li", { class: "passo-adm " + estado },
        el("span", { class: "passo-marca", "aria-hidden": "true" }, p.feito ? "✓" : p.encerrado ? "✕" : String(i + 1)),
        el("div", { class: "passo-corpo" },
          el("b", null, p.nome),
          el("span", { class: "mini" }, [p.quando ? fmtData(p.quando, true) + (p.por ? " · " + p.por : "") : "", p.detalhe || "",
            !p.feito && p.ajuda && !p.bloqueado ? p.ajuda : "", p.bloqueado && !p.feito ? "Depois da aprovação do cadastro" : ""].filter(Boolean).join(" · "))),
        acoes.length ? el("div", { class: "acoes" }, acoes) : null);
    }));
    return el("div", { class: "card" }, el("div", { class: "trilha-cab" }, el("b", null, t.concluida ? "Admissão concluída" : t.feitos + " de " + t.total + " passos"),
      t.proximo ? el("span", { class: "pequeno suave" }, "Próximo: " + t.proximo) : null), lista);
  }

  async function pedirAcessos(a, emailPadrao) {
    const para = entrada("para", emailPadrao || "", { type: "email", placeholder: "ti@innomaker.com.br" });
    const obs = areaTexto("obs", "", { rows: "3", placeholder: "Ex.: precisa de acesso ao SolidWorks e ao drive da Engenharia." });
    await dialogo({
      titulo: "Pedir acessos para " + a.candidato_nome, okTexto: "Enviar pedido",
      corpo: el("div", null, el("p", { class: "suave pequeno", style: "margin:0 0 12px" }, "Vai um e-mail com nome, matrícula, cargo, departamento, data de início e e-mail pessoal. O e-mail padrão fica em Configurações → Admissão."),
        el("div", { class: "campos" }, campo("Para", para, { largo: true }), campo("Observação", obs, { largo: true }))),
      aoConfirmar: async () => {
        const r = await api("adm_pedir_acessos", { id: a.id, para: para.value, observacao: obs.value });
        if (!r.ok) return r.erro;
        toast("Pedido de acessos enviado para " + r.para + ".");
        return true;
      }
    }) && recarregar();
  }

  async function aprovarAdm(a, modelos, faltando) {
    if (faltando && faltando.length) return toast("Faltam documentos obrigatórios. Peça correção antes de aprovar.", true);
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

  async function decidirAdm(a, tipo, itens) {
    const correcao = tipo === "correcao";
    itens = itens || [];
    const comentarios = itens.map(i => el("textarea", { rows: "2", placeholder: "O que ajustar em " + i.rotulo + "?" }));
    const t = el("textarea", { rows: "3", placeholder: correcao ? (itens.length ? "Observação geral (opcional)" : "Liste exatamente o que falta ou está incorreto.") : "Justificativa enviada ao candidato." });
    const corpo = el("div", null,
      correcao ? (itens.length
        ? el("div", { class: "lista-corrigir" }, itens.map((i, k) => el("div", { class: "campo" }, el("label", null, (i.tipo === "arquivo" ? "📎 " : "") + i.rotulo, el("span", { class: "req" }, " *")), comentarios[k])))
        : el("div", { class: "nota azul", style: "margin:0 0 12px" }, "Dica: feche esta janela e clique em \"Corrigir\" nos campos e documentos com problema. O candidato vê cada item destacado."))
        : el("div", { class: "nota ambar", style: "margin:0 0 12px" }, "Para pendências de dados ou documentos, prefira \"Pedir correção\". A recusa encerra a admissão."),
      correcao && itens.length ? el("label", { class: "aval-rotulo", style: "margin-top:12px" }, "Observação geral") : null, t);
    await dialogo({
      titulo: (correcao ? "Pedir correção a " : "Recusar admissão de ") + a.candidato_nome, corpo, largo: correcao && itens.length > 0,
      okTexto: correcao ? "Enviar pedido de correção" : "Recusar e avisar", okClasse: correcao ? "bt-alerta" : "bt-perigo",
      aoConfirmar: async () => {
        if (correcao && comentarios.some(x => x.value.trim().length < 3)) return "Escreva o que ajustar em cada item marcado.";
        if (!itens.length && t.value.trim().length < 5) return "Escreva o texto para o candidato.";
        const r = await api("adm_decidir", { id: a.id, decisao: tipo, texto: t.value.trim(),
          itens: itens.map((i, k) => ({ tipo: i.tipo, chave: i.chave, comentario: comentarios[k].value.trim() })) });
        if (!r.ok) return r.erro;
        toast(correcao ? "Pedido de correção enviado." : "Recusa registrada.");
        return true;
      }
    }) && recarregar();
  }

  async function reenviarAdm(a) {
    await dialogo({ titulo: "Reenviar e-mail da proposta", corpo: el("p", { style: "margin:0" }, "O e-mail da proposta será enviado de novo para " + a.email_contato + "."), okTexto: "Reenviar",
      aoConfirmar: async () => { const r = await api("adm_reenviar", { id: a.id }); if (!r.ok) return r.erro; toast("E-mail reenviado."); return true; } }) && recarregar();
  }

  // =================================================================
  //  Funcionários
  // =================================================================
  function viewFuncionarios(box) {
    box.append(cabecalho("Funcionários", "Registros criados na aprovação das admissões. Contratos têm duração mínima de 1 ano; o RH recebe aviso 45 dias antes do fim."));
    carregarEm(box, "func_listar", {}, (area, r) => {
      if (!r.itens.length) return area.append(el("div", { class: "vazio" }, "Nenhum funcionário registrado ainda."));
      const limite = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
      const pend = f => f.docs_pendentes || !f.documentos_conferidos || !f.ponto_cadastrado || !f.acessos_ok || !f.onboarding_ok;
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
            el("td", { "data-rotulo": "Checklist" }, el("div", { class: "acoes" }, chk(f.documentos_conferidos, "Docs"), chk(f.ponto_cadastrado, "Ponto"), chk(f.acessos_ok, "Acessos"), chk(f.onboarding_ok, "Onboarding"))),
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
      flag("acessos_ok", "Acessos criados", "E-mail Innomaker e sistemas que a pessoa vai usar."),
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

      // Admissão: quem cria os acessos e documentos exigidos por tipo de contrato
      const tiposContrato = (r.listas.tipo_contratacao || []);
      const emailAc = entrada("email_acessos", r.config.email_acessos || "", { type: "email", placeholder: "ti@innomaker.com.br" });
      const docsAlvo = el("div", { class: "docs-cfg" });
      const docs = (r.admissaoDocumentos || []).map(d => Object.assign({}, d));
      const pintarDocs = () => {
        limpar(docsAlvo);
        docs.forEach((d, i) => {
          const nome = entrada("nome", d.nome, { "aria-label": "Nome do documento" });
          nome.addEventListener("input", () => { d.nome = nome.value; });
          const todos = el("input", { type: "checkbox", checked: (d.obrigatorio_para || []).indexOf("todos") >= 0 });
          const tipos = tiposContrato.map(t => {
            const cb = el("input", { type: "checkbox", checked: (d.obrigatorio_para || []).some(x => x.toLowerCase() === t.toLowerCase()), disabled: todos.checked });
            cb.addEventListener("change", () => { d.obrigatorio_para = tiposContrato.filter((x, k) => cbs[k].checked); });
            return cb;
          });
          const cbs = tipos;
          todos.addEventListener("change", () => { d.obrigatorio_para = todos.checked ? ["todos"] : tiposContrato.filter((x, k) => cbs[k].checked); cbs.forEach(cb => { cb.disabled = todos.checked; }); });
          const ativo = el("input", { type: "checkbox", checked: d.ativo !== false });
          ativo.addEventListener("change", () => { d.ativo = ativo.checked; });
          docsAlvo.append(el("div", { class: "doc-cfg" },
            el("div", { class: "doc-cfg-nome" }, nome, el("label", { class: "check pequeno" }, ativo, el("span", null, "Pedir este documento")),
              el("button", { type: "button", class: "bt-perigo-txt", onclick: () => { docs.splice(i, 1); pintarDocs(); } }, "Remover")),
            el("div", { class: "doc-cfg-tipos" }, el("span", { class: "mini" }, "Obrigatório para:"),
              el("label", { class: "check pequeno" }, todos, el("span", null, "Todos")),
              tiposContrato.map((t, k) => el("label", { class: "check pequeno" }, tipos[k], el("span", null, t))))));
        });
      };
      pintarDocs();
      const fAdm = el("form", { novalidate: true },
        el("div", { class: "campos" }, campo("E-mail de quem cria os acessos (e-mail Innomaker, sistemas)", emailAc, { largo: true, dica: "Usado pelo botão \"Pedir acessos\" na trilha da admissão." })),
        el("h3", { class: "titulo-etapas" }, "Documentos que o candidato envia"),
        el("p", { class: "pequeno suave", style: "margin:0 0 10px" }, "Cada documento é enviado separado. Marque para quais tipos de contratação ele é obrigatório (os tipos vêm da lista \"Tipos de contratação\" abaixo). Os não obrigatórios aparecem como opcionais."),
        docsAlvo,
        el("div", { class: "acoes", style: "margin-top:12px" },
          el("button", { type: "button", class: "bt-sec", onclick: () => { docs.push({ id: "", nome: "", obrigatorio_para: [], ativo: true }); pintarDocs(); } }, "+ Documento"),
          el("button", { type: "submit", class: "bt" }, "Salvar admissão")));
      fAdm.addEventListener("submit", async ev => {
        ev.preventDefault();
        const res = await api("cfg_salvar_admissao", { email_acessos: emailAc.value, documentos: docs });
        res.ok ? toast("Configurações da admissão salvas.") : toast(res.erro, true);
      });
      area.append(el("h2", { class: "sec" }, "Admissão"), el("div", { class: "card" }, fAdm));

      // Privacidade (LGPD)
      const ret = entrada("lgpd_meses_retencao", r.lgpd.retencao, { type: "number", min: "3", max: "120" });
      const banco = entrada("lgpd_meses_banco", r.lgpd.banco, { type: "number", min: "3", max: "120" });
      const fPriv = el("form", { novalidate: true },
        el("div", { class: "campos" },
          campo("Prazo de guarda das candidaturas (meses)", ret, { dica: "Depois da última atividade do candidato. Passado o prazo, conta, currículos e candidaturas são apagados sozinhos." }),
          campo("Prazo do banco de talentos (meses)", banco, { dica: "Para quem autorizou o banco de talentos, contado da autorização." })),
        el("p", { class: "pequeno suave", style: "margin:12px 0 0" },
          "Nunca são apagados por prazo: candidatos em processo em vaga não concluída, admissões e funcionários. " +
          (r.lgpdVencidos ? r.lgpdVencidos + " candidato(s) já passaram do prazo e serão apagados na próxima rotina (madrugada)." : "Nenhum candidato passou do prazo.") + " A Política de privacidade mostra estes prazos."),
        el("div", { class: "acoes", style: "margin-top:14px" }, el("button", { type: "submit", class: "bt" }, "Salvar prazos"),
          el("a", { class: "bt-sec", href: "/privacidade", target: "_blank", rel: "noopener" }, "Ver Política de privacidade")));
      fPriv.addEventListener("submit", async ev => {
        ev.preventDefault();
        const res = await api("cfg_salvar_lgpd", { lgpd_meses_retencao: ret.value, lgpd_meses_banco: banco.value });
        res.ok ? toast("Prazos salvos.") : toast(res.erro, true);
      });
      area.append(el("h2", { class: "sec" }, "Privacidade (LGPD)"), el("div", { class: "card" }, fPriv));

      // Backup fora do servidor
      const b = r.backup || {};
      const estadoBackup = !b.configurado ? el("div", { class: "nota ambar" }, el("strong", null, "Backup externo não configurado"),
          "Hoje só existe a cópia dentro do próprio servidor (pasta data/backups). Se o disco falhar, perde-se tudo. Peça a quem cuida do servidor para montar um disco externo, NAS ou pasta sincronizada com a nuvem e definir BACKUP_EXTERNO_DIR no backend/.env (passo a passo no README).")
        : b.ok ? el("div", { class: "nota verde" }, el("strong", null, "Backup externo em dia"),
          "Última cópia: " + fmtData(b.quando, true) + " · banco " + b.banco + (b.arquivos ? " · " + b.arquivos.total + " arquivo(s) espelhado(s)" : "") + "\nDestino: " + b.destino)
        : el("div", { class: "nota verm" }, el("strong", null, b.quando ? "A última cópia externa falhou" : "Aguardando a primeira cópia externa"),
          (b.erro ? "Erro: " + b.erro + "\n" : "") + (b.ultimoOk ? "Última cópia que deu certo: " + fmtData(b.ultimoOk, true) : b.quando ? "Ainda não houve cópia que desse certo." : "A rotina roda de hora em hora.") + "\nDestino: " + b.destino);
      area.append(el("h2", { class: "sec" }, "Backup"), el("div", { class: "card" }, estadoBackup,
        el("p", { class: "pequeno suave", style: "margin:10px 0 0" }, "Todo dia o sistema copia o banco e espelha os currículos e documentos. O RH recebe um e-mail se a cópia externa falhar.")));

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
