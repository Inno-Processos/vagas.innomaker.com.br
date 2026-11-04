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

  async function api(acao, dados) {
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
    try { return await r.json(); }
    catch (e) { return { ok: false, erro: "Resposta inválida do servidor." }; }
  }

  function carregando(texto) {
    return el("div", { class: "carregando" }, el("div", { class: "spin" }), texto || "Carregando…");
  }

  function msg(tipo, texto) { return el("div", { class: "msg " + tipo, role: tipo === "erro" ? "alert" : null }, texto); }

  function fmtData(v, comHora) {
    if (!v) return "";
    const s = String(v);
    if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return comHora ? s : s.slice(0, 10);
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
    "": ["Sem envio", "cinza"],
    "PENDENTE": ["Aguardando RH", "ambar"],
    "REAJUSTE SOLICITADO": ["Reajuste solicitado", "verm"],
    "APROVADO": ["Aprovada", "verde"],
    "VAGA_CRIADA": ["Vaga criada", "azul"],
    // Vagas
    "Aberta": ["Aberta", "verde"],
    "Pausada": ["Pausada", "ambar"],
    "Fechada": ["Fechada", "cinza"],
    // Admissão
    "PROPOSTA_ENVIADA": ["Proposta enviada", "cinza"],
    "COMPLETANDO_CADASTRO": ["Completando cadastro", "azul"],
    "AGUARDANDO_APROVACAO": ["Aguardando aprovação do RH", "ambar"],
    "APROVADA": ["Aprovada", "verde"],
    "PROPOSTA_RECUSADA": ["Proposta recusada", "verm"],
    "RECUSADA_ADMIN": ["Recusada pelo RH", "verm"],
    // Candidatos (site de vagas)
    "Em processo": ["Em processo", "azul"],
    "Processo encerrado": ["Encerrado", "verm"],
    "Processo concluído": ["Concluído", "verde"]
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
      desc: "Acompanhe a análise do RH e veja pedidos de reajuste." },
    { grupo: "RH" },
    { id: "solicitacoes", nome: "Solicitações", acao: "solic_listar", render: viewSolicitacoes,
      desc: "Analise os pedidos dos gestores, aprove ou peça reajustes e crie a vaga." },
    { id: "vagas", nome: "Vagas", acao: "vagas_todas", render: viewVagas,
      desc: "Abra, pause ou feche vagas, ajuste prazos e veja os inscritos." },
    { id: "admissoes", nome: "Admissões", acao: "adm_listar", render: viewAdmissoes,
      desc: "Acompanhe propostas, revise cadastros e aprove admissões." }
  ];
  const visiveis = () => VIEWS.filter(v => v.id && pode(v.acao));

  function montarMenu() {
    const nav = $("lateral");
    limpar(nav);
    let grupoPendente = null;
    VIEWS.forEach(v => {
      if (v.grupo) { grupoPendente = v.grupo; return; }
      if (!pode(v.acao)) return;
      if (grupoPendente) { nav.append(el("h3", null, grupoPendente)); grupoPendente = null; }
      nav.append(el("a", { href: "#" + v.id, dataset: { view: v.id } }, v.nome));
    });
  }

  function irPara() {
    const id = (location.hash || "#inicio").slice(1);
    const v = visiveis().find(x => x.id === id) || visiveis()[0];
    document.querySelectorAll(".lateral a").forEach(a => {
      if (a.dataset.view === v.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("lateral").classList.remove("aberta");
    $("menuBtn").setAttribute("aria-expanded", "false");
    document.title = v.nome + " — Painel Innomaker";
    limpar(main);
    window.scrollTo(0, 0);
    v.render(main);
    main.focus({ preventScroll: true });
  }

  function cabecalho(titulo, texto, acoes) {
    return el("div", { class: "cab" },
      el("div", null, el("h1", null, titulo), texto ? el("p", null, texto) : null),
      acoes ? el("div", { class: "acoes" }, acoes) : null);
  }

  // =================================================================
  //  Início
  // =================================================================
  function viewInicio(box) {
    const textos = {
      funcionario: "Esta é a área do colaborador. Veja as vagas abertas para indicar pessoas e acesse os links úteis.",
      gerente: "Solicite novas vagas para a sua área e acompanhe a análise do RH.",
      rh: "Acompanhe solicitações, vagas e admissões em um só lugar."
    };
    box.append(cabecalho("Olá, " + (primeiroNome(U.nome) || U.login), textos[U.papel]));

    if (U.papel === "rh") {
      const nums = el("div", { class: "numeros" }, carregando("Buscando os números…"));
      box.append(nums);
      carregarResumoRH(nums);
    }

    const atalhos = visiveis().filter(v => v.id !== "inicio");
    if (atalhos.length) {
      box.append(el("h2", { class: "sec" }, "O que você pode fazer"));
      box.append(el("div", { class: "grade" }, atalhos.map(v =>
        el("a", { class: "card atalho", href: "#" + v.id }, el("h3", null, v.nome), el("p", null, v.desc || "")))));
    }

    if ((BOOT.links || []).length) {
      box.append(el("h2", { class: "sec" }, "Links úteis"));
      box.append(el("div", { class: "grade" }, BOOT.links.map(l =>
        el("a", { class: "card atalho", href: l.url, target: "_blank", rel: "noopener" },
          el("h3", null, l.titulo || l.url), l.descricao ? el("p", null, l.descricao) : null))));
    }
  }

  async function carregarResumoRH(box) {
    const [s, v, a] = await Promise.all([api("solic_listar"), api("vagas_todas"), api("adm_listar")]);
    limpar(box);
    const num = (rotulo, valor, href) => el("a", { class: "numero", href: href, style: "text-decoration:none;color:inherit" },
      el("span", null, rotulo), el("b", null, valor == null ? "—" : String(valor)));
    const sol = s.ok ? s.itens : [];
    box.append(
      num("Solicitações aguardando", s.ok ? sol.filter(i => i.status === "PENDENTE").length : null, "#solicitacoes"),
      num("Aprovadas sem vaga criada", s.ok ? sol.filter(i => i.status === "APROVADO" && !i.vagaCriada).length : null, "#solicitacoes"),
      num("Vagas abertas no site", v.ok ? v.vagas.filter(x => x.aberta_site).length : null, "#vagas"),
      num("Cadastros para aprovar", a.ok ? a.itens.filter(i => i.status === "AGUARDANDO_APROVACAO").length : null, "#admissoes"),
      num("Propostas em andamento", a.ok ? a.itens.filter(i => i.status === "PROPOSTA_ENVIADA" || i.status === "COMPLETANDO_CADASTRO").length : null, "#admissoes")
    );
    const falhas = [s, v, a].filter(r => !r.ok).map(r => r.erro);
    if (falhas.length) box.after(msg("erro", "Algumas integrações não responderam: " + falhas.join(" | ")));
  }

  // =================================================================
  //  Vagas abertas (todos)
  // =================================================================
  async function viewVagasAbertas(box) {
    box.append(cabecalho("Vagas abertas", "Oportunidades publicadas no site. Copie o link para indicar alguém.",
      el("a", { class: "bt-sec", href: "/?page=central", target: "_blank", rel: "noopener" }, "Abrir site de vagas")));
    const area = el("div", null, carregando());
    box.append(area);
    const r = await api("vagas_abertas");
    limpar(area);
    if (!r.ok) return area.append(msg("erro", r.erro || "Não foi possível carregar as vagas."));
    if (!r.vagas.length) return area.append(el("div", { class: "vazio" }, "Não há vagas abertas no momento."));
    area.append(el("div", { class: "lista" }, r.vagas.map(v => el("article", { class: "card" },
      el("div", { class: "item-topo" },
        el("div", null, el("h3", null, v.titulo_vaga),
          el("div", { class: "meta" },
            v.localidade ? el("span", null, v.localidade) : null,
            v.tipo_contratacao ? el("span", null, v.tipo_contratacao) : null,
            v.carga_horaria ? el("span", null, v.carga_horaria) : null,
            v.data_limite_inscricao ? el("span", null, "Inscrições até ", el("b", null, v.data_limite_inscricao)) : null)),
        el("div", { class: "acoes" },
          el("button", { type: "button", class: "bt-sec", onclick: () => copiar(v.link) }, "Copiar link"),
          el("a", { class: "bt", href: v.link, target: "_blank", rel: "noopener" }, "Abrir")))))));
  }

  // =================================================================
  //  Solicitar vaga (gerente e RH) — RHC-PROC-2026-002
  // =================================================================
  let opcoesCache = null;

  function viewSolicitar(box) {
    const pre = estadoPrefill || {};
    estadoPrefill = null;

    box.append(cabecalho("Solicitar vaga",
      "Preencha com o máximo de clareza. O RH analisa, pode chamar você para uma reunião de alinhamento e, depois do acordo com Financeiro e Engenharia, abre a vaga."));

    const f = {};
    const txt = (nome, attrs) => (f[nome] = el("input", Object.assign({ type: "text", name: nome }, attrs || {})));
    const area = (nome, attrs) => (f[nome] = el("textarea", Object.assign({ name: nome }, attrs || {})));
    const sel = (nome, opcoes) => (f[nome] = el("select", { name: nome },
      el("option", { value: "" }, "Selecione"), opcoes.map(o => el("option", { value: o }, o))));

    const listaId = n => "dl_" + n;
    const datalists = ["localidade", "tipoContrato", "tipoContratacao", "cargaHoraria"].map(n => el("datalist", { id: listaId(n) }));

    const form = el("form", { novalidate: true },
      datalists,
      el("section", { class: "card bloco" },
        el("h2", null, "1. A vaga"),
        el("p", null, "Use um título claro, que represente a função. Ex.: Estágio em Engenharia Mecânica, Analista Financeiro Pleno."),
        el("div", { class: "campos" },
          campo("Departamento", f.departamento = el("select", { name: "departamento" }, el("option", { value: "" }, "Carregando…")), { obrigatorio: true, nome: "departamento" }),
          campo("Título do cargo", txt("tituloCargo", { placeholder: "Ex.: Estágio em Engenharia de Software" }), { obrigatorio: true, nome: "tituloCargo" }),
          campo("Quantidade de vagas", txt("quantidadeVagas", { type: "number", min: "1", value: "1" }), { obrigatorio: true, nome: "quantidadeVagas" }),
          campo("Data limite de inscrição", txt("dataLimite", { type: "date" }), { obrigatorio: true, nome: "dataLimite" }),
          campo("Localidade", txt("localidade", { list: listaId("localidade"), placeholder: "Cidade/UF ou Remoto" }), { obrigatorio: true, nome: "localidade" }),
          campo("Tipo de contrato", txt("tipoContrato", { list: listaId("tipoContrato"), placeholder: "Ex.: Presencial, Híbrido, Remoto" }), { obrigatorio: true, nome: "tipoContrato" }),
          campo("Tipo de contratação", txt("tipoContratacao", { list: listaId("tipoContratacao"), placeholder: "Ex.: Estágio, Bolsista, CLT, PJ" }), { obrigatorio: true, nome: "tipoContratacao",
            dica: "Estágio: acompanhamento constante. CLT: autonomia moderada. PJ: lidera soluções e decisões." }),
          campo("Carga horária", txt("cargaHoraria", { list: listaId("cargaHoraria"), placeholder: "Ex.: 20 horas semanais" }), { obrigatorio: true, nome: "cargaHoraria" }),
          campo("Remuneração / Bolsa", txt("remuneracao", { placeholder: "Ex.: Bolsa de R$ 700,00" }), { obrigatorio: true, nome: "remuneracao", largo: true,
            dica: "Considere a complexidade da função, a experiência esperada, o mercado e o budget. O valor final é alinhado entre RH, Financeiro e Engenharia." })
        )),
      el("section", { class: "card bloco" },
        el("h2", null, "2. Perfil e atividades"),
        el("p", null, "Separe o que é obrigatório do que é diferencial. Isso deixa a triagem mais justa e rápida."),
        el("div", { class: "campos" },
          campo("Descrição geral da oportunidade", area("descricao", { placeholder: "Quais atividades a pessoa fará, que problemas vai ajudar a resolver, com quem vai trabalhar e qual impacto terá." }), { obrigatorio: true, nome: "descricao", largo: true }),
          campo("Habilidades técnicas obrigatórias", area("habilidadesObrigatorias", { placeholder: "Uma por linha. Ex.:\nCursando Engenharia Mecânica\nSolidWorks" }), { obrigatorio: true, nome: "habilidadesObrigatorias" }),
          campo("Habilidades técnicas diferenciais", area("habilidadesDiferenciais", { placeholder: "Uma por linha. Ex.:\nPython\nPower BI" }), { nome: "habilidadesDiferenciais" }),
          campo("Principais funções e atividades", area("principaisFuncoes", { placeholder: "Uma por linha. Ex.:\nElaboração de desenhos 2D e 3D\nDetalhamento técnico" }), { obrigatorio: true, nome: "principaisFuncoes", largo: true }),
          campo("Competências comportamentais desejadas", area("competencias", { placeholder: "Pense na rotina da equipe. Ex.: organização, comunicação, autonomia." }), { nome: "competencias", largo: true })
        )),
      el("section", { class: "card bloco" },
        el("h2", null, "3. Contexto"),
        el("div", { class: "campos" },
          campo("Motivo da solicitação", sel("motivoSolicitacao", ["Aumento de demanda", "Substituição de profissional", "Criação de cargo", "Novo projeto", "Outro"]), { obrigatorio: true, nome: "motivoSolicitacao" }),
          campo("Urgência", sel("urgencia", ["Baixa", "Média", "Alta"]), { nome: "urgencia" }),
          campo("Gestor responsável", txt("gestorResponsavel", { value: U.nome }), { obrigatorio: true, nome: "gestorResponsavel" }),
          campo("Observações gerais", area("observacoes", { placeholder: "Prazo previsto para contratação, informações para o RH etc." }), { nome: "observacoes", largo: true })
        ),
        el("label", { class: "check", style: "margin-top:16px", dataset: { campo: "concordancia" } },
          f.concordancia = el("input", { type: "checkbox", name: "concordancia" }),
          el("span", null, "Declaro que as informações são verdadeiras e que a necessidade desta contratação foi alinhada com a minha área."))),
      el("div", { id: "solMsg" }),
      el("div", { class: "acoes", style: "margin-top:16px" },
        el("button", { type: "submit", class: "bt", id: "solEnviar" }, "Enviar solicitação ao RH"))
    );

    const dicas = el("aside", { class: "card dicas" },
      el("h3", null, "Antes de enviar"),
      el("ul", null,
        el("li", null, "Informe as prioridades reais e a urgência da contratação."),
        el("li", null, "Diferencie requisitos obrigatórios de desejáveis."),
        el("li", null, "Evite exigir tecnologias desnecessárias ou incompatíveis com o nível da vaga."),
        el("li", null, "Não misture cargos diferentes em uma mesma solicitação."),
        el("li", null, "Informe a faixa salarial e o motivo da vaga.")),
      el("p", { class: "pequeno suave", style: "margin:12px 0 0" }, "Você recebe por e-mail a decisão do RH: aprovação ou pedido de reajuste."));

    box.append(el("div", { class: "form-grade" }, form, dicas));

    // pré-preenchimento (nova solicitação a partir de uma anterior)
    const mapaPre = {
      tituloCargo: pre.tituloCargo, quantidadeVagas: pre.quantidadeVagas, localidade: pre.localidade,
      tipoContrato: pre.tipoContrato, tipoContratacao: pre.tipoContratacao, cargaHoraria: pre.cargaHoraria,
      remuneracao: pre.remuneracao, descricao: pre.descricao, habilidadesObrigatorias: pre.habilidades,
      principaisFuncoes: pre.principaisFuncoes, competencias: pre.competencias, observacoes: pre.observacoes
    };
    Object.keys(mapaPre).forEach(k => { if (mapaPre[k] && f[k]) f[k].value = mapaPre[k]; });

    carregarOpcoes().then(op => {
      limpar(f.departamento);
      f.departamento.append(el("option", { value: "" }, "Selecione"));
      (op.departamentos || []).forEach(d => f.departamento.append(el("option", { value: d }, d)));
      f.departamento.append(el("option", { value: "__outro" }, "Outro (informar nas observações)"));
      if (pre.departamento) f.departamento.value = pre.departamento;
      [["localidade", op.localidades], ["tipoContrato", op.tiposContrato], ["tipoContratacao", op.tiposContratacao], ["cargaHoraria", op.cargasHorarias]]
        .forEach(([n, vals]) => { const dl = $(listaId(n)); (vals || []).forEach(v => dl.append(el("option", { value: v }))); });
    });

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const solMsg = $("solMsg");
      limpar(solMsg);
      form.querySelectorAll(".erro").forEach(x => x.classList.remove("erro"));

      const obrig = ["departamento", "tituloCargo", "quantidadeVagas", "dataLimite", "localidade", "tipoContrato", "tipoContratacao",
        "cargaHoraria", "remuneracao", "descricao", "habilidadesObrigatorias", "principaisFuncoes", "motivoSolicitacao", "gestorResponsavel"];
      const faltando = obrig.filter(n => !String(f[n].value || "").trim());
      if (!f.concordancia.checked) faltando.push("concordancia");
      if (faltando.length) {
        faltando.forEach(n => { const c = form.querySelector('[data-campo="' + n + '"]'); if (c) c.classList.add("erro"); });
        solMsg.append(msg("erro", "Preencha os campos obrigatórios marcados em vermelho" + (faltando.indexOf("concordancia") >= 0 ? " e confirme a declaração" : "") + "."));
        const primeiro = form.querySelector(".erro input, .erro select, .erro textarea, .erro");
        if (primeiro) primeiro.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      const d = {};
      Object.keys(f).forEach(k => { d[k] = k === "concordancia" ? f[k].checked : String(f[k].value || "").trim(); });
      if (d.departamento === "__outro") d.departamento = "Outro";

      const bt = $("solEnviar");
      bt.disabled = true;
      bt.textContent = "Enviando…";
      const r = await api("solic_criar", { dados: d });
      bt.disabled = false;
      bt.textContent = "Enviar solicitação ao RH";

      if (!r.ok) return solMsg.append(msg("erro", r.erro || "Não foi possível enviar a solicitação."));

      limpar(box);
      box.append(cabecalho("Solicitação enviada", null));
      box.append(el("div", { class: "card" },
        el("p", { style: "margin-top:0" }, "Sua solicitação ", el("b", null, r.id || ""), " foi registrada e enviada para análise."),
        r.aviso ? el("div", { class: "nota ambar" }, r.aviso) : null,
        el("div", { class: "nota verde" }, el("strong", null, "Próximos passos"),
          "1. O RH analisa as informações (descrição, requisitos, salário, prazo e tipo de contrato).\n" +
          "2. Se houver dúvidas, o RH agenda uma reunião de alinhamento com você.\n" +
          "3. RH, Financeiro e Engenharia alinham faixa salarial, budget e prioridade.\n" +
          "4. Com tudo aprovado, a vaga é aberta e publicada."),
        el("div", { class: "acoes", style: "margin-top:16px" },
          el("a", { class: "bt", href: "#minhas" }, "Ver minhas solicitações"),
          el("button", { type: "button", class: "bt-sec", onclick: () => irPara() }, "Fazer outra solicitação"))));
    });
  }

  async function carregarOpcoes() {
    if (opcoesCache) return opcoesCache;
    const r = await api("solic_opcoes");
    opcoesCache = r.ok ? r : { departamentos: [] };
    return opcoesCache;
  }

  // =================================================================
  //  Minhas solicitações (gerente e RH)
  // =================================================================
  async function viewMinhas(box) {
    box.append(cabecalho("Minhas solicitações", "Pedidos de vaga feitos com o seu e-mail (" + U.email + ").",
      pode("solic_criar") ? el("a", { class: "bt", href: "#solicitar" }, "Nova solicitação") : null));
    const area = el("div", null, carregando());
    box.append(area);
    const r = await api("solic_minhas");
    limpar(area);
    if (!r.ok) return area.append(msg("erro", r.erro || "Não foi possível carregar."));
    if (!r.itens.length) {
      return area.append(el("div", { class: "vazio" }, "Você ainda não fez nenhuma solicitação.",
        el("div", { style: "margin-top:14px" }, el("a", { class: "bt", href: "#solicitar" }, "Solicitar vaga"))));
    }
    area.append(el("div", { class: "lista" }, r.itens.map(i => {
      const st = i.vagaCriada ? "VAGA_CRIADA" : i.status;
      return el("article", { class: "card" },
        el("div", { class: "item-topo" },
          el("div", null, el("h3", null, i.dados.tituloCargo || "(sem título)"),
            el("div", { class: "meta" }, el("span", null, i.id), el("span", null, i.dados.departamento),
              el("span", null, "Enviada em ", el("b", null, fmtData(i.dados.ts))))),
          pill(st)),
        i.status === "REAJUSTE SOLICITADO" ? el("div", { class: "nota ambar" }, el("strong", null, "O RH pediu ajustes"),
          i.comentarios || "Veja o e-mail enviado pelo RH.", "\n\nFaça uma nova solicitação com as correções (os dados desta podem ser usados como base).") : null,
        i.status === "APROVADO" && !i.vagaCriada ? el("div", { class: "nota verde" }, "Aprovada por " + (i.decididoPor || "RH") + (i.dataDecisao ? " em " + i.dataDecisao : "") + ". O RH vai criar a vaga.") : null,
        i.vagaCriada ? el("div", { class: "nota azul" }, "Vaga criada: " + i.vagaCriada) : null,
        el("div", { class: "item-acoes acoes" },
          el("button", { type: "button", class: "bt-sec", onclick: () => { estadoPrefill = i.dados; location.hash = "#solicitar"; } }, "Usar como base para nova solicitação")));
    })));
  }

  // =================================================================
  //  Solicitações (RH)
  // =================================================================
  async function viewSolicitacoes(box) {
    box.append(cabecalho("Solicitações de contratação", "Analise os pedidos: confira descrição, requisitos, salário, prazo e tipo de contrato antes de aprovar."));
    const area = el("div", null, carregando());
    box.append(area);
    const r = await api("solic_listar");
    limpar(area);
    if (!r.ok) return area.append(msg("erro", r.erro || "Não foi possível carregar as solicitações."));

    const itens = r.itens;
    const grupo = i => i.vagaCriada ? "criada" : i.status === "APROVADO" ? "aprovada" : i.status === "REAJUSTE SOLICITADO" ? "reajuste" : "aguardando";
    let filtro = itens.some(i => grupo(i) === "aguardando") ? "aguardando" : "todas";
    let busca = "";
    const conta = g => itens.filter(i => g === "todas" || grupo(i) === g).length;

    const buscaInput = el("input", { type: "search", placeholder: "Buscar por cargo, departamento, solicitante ou ID", "aria-label": "Buscar solicitações" });
    const lista = el("div", { class: "lista" });
    area.append(el("div", { class: "filtros" }, buscaInput,
      chips([{ id: "aguardando", nome: "Aguardando", qtd: conta("aguardando") }, { id: "reajuste", nome: "Reajuste", qtd: conta("reajuste") },
        { id: "aprovada", nome: "Aprovadas", qtd: conta("aprovada") }, { id: "criada", nome: "Vaga criada", qtd: conta("criada") },
        { id: "todas", nome: "Todas", qtd: itens.length }], filtro, id => { filtro = id; desenhar(); })), lista);
    buscaInput.addEventListener("input", () => { busca = norm(buscaInput.value); desenhar(); });

    function desenhar() {
      limpar(lista);
      const vis = itens.filter(i => (filtro === "todas" || grupo(i) === filtro) &&
        (!busca || norm([i.id, i.dados.tituloCargo, i.dados.departamento, i.dados.nome, i.dados.requesterEmail].join(" ")).indexOf(busca) >= 0));
      if (!vis.length) return lista.append(el("div", { class: "vazio" }, "Nenhuma solicitação neste filtro."));
      vis.forEach(i => lista.append(cartaoSolicitacao(i, () => { limpar(box); viewSolicitacoes(box); })));
    }
    desenhar();
  }

  function cartaoSolicitacao(i, recarregar) {
    const d = i.dados;
    const st = i.vagaCriada ? "VAGA_CRIADA" : i.status;
    const pendente = !!i.id && !i.vagaCriada && i.status !== "APROVADO";
    return el("article", { class: "card" },
      el("div", { class: "item-topo" },
        el("div", null, el("h3", null, d.tituloCargo || "(sem título)"),
          el("div", { class: "meta" },
            el("span", null, el("b", null, i.id)),
            el("span", null, d.departamento),
            el("span", null, (d.quantidadeVagas || "1") + " vaga(s)"),
            el("span", null, "Por ", el("b", null, d.nome || d.requesterEmail)),
            el("span", null, fmtData(d.ts)))),
        pill(st)),
      !i.id ? el("div", { class: "nota ambar" }, "Esta resposta ainda não tem ID. Na planilha de solicitações, selecione a linha e use o menu “Enviar/Reenviar para aprovação”.") : null,
      i.comentarios ? el("div", { class: "nota ambar" }, el("strong", null, "Histórico de comentários"), i.comentarios) : null,
      i.decididoPor ? el("p", { class: "pequeno suave", style: "margin:10px 0 0" }, "Decidido por " + i.decididoPor + (i.dataDecisao ? " em " + i.dataDecisao : "")) : null,
      el("details", { class: "mais" }, el("summary", null, "Ver todos os dados da solicitação"),
        dados([
          ["Solicitante", (d.nome || "") + (d.requesterEmail ? " — " + d.requesterEmail : "")],
          ["Gestor responsável", d.gestorResponsavel], ["Localidade", d.localidade], ["Tipo de contrato", d.tipoContrato],
          ["Tipo de contratação", d.tipoContratacao], ["Carga horária", d.cargaHoraria], ["Remuneração / Bolsa", d.remuneracao],
          ["Data limite de inscrição", d.dataLimite], ["Descrição", d.descricao], ["Habilidades técnicas", d.habilidades],
          ["Principais funções", d.principaisFuncoes], ["Competências comportamentais", d.competencias],
          ["Motivo", d.motivoSolicitacao], ["Observações", d.observacoes], ["Enviado para", i.enviadoPara]
        ])),
      el("div", { class: "item-acoes acoes" },
        pendente ? el("button", { type: "button", class: "bt", onclick: () => decidir(i, "aprovar", recarregar) }, "Aprovar") : null,
        pendente ? el("button", { type: "button", class: "bt-alerta", onclick: () => decidir(i, "reajuste", recarregar) }, "Pedir reajustes") : null,
        i.linkVaga && !i.vagaCriada ? el("a", { class: "bt", href: i.linkVaga, target: "_blank", rel: "noopener" }, "Criar vaga") : null,
        i.planilhaUrl ? el("a", { class: "bt-sec", href: i.planilhaUrl, target: "_blank", rel: "noopener" }, "Abrir planilha") : null));
  }

  async function decidir(i, tipo, recarregar) {
    const aprovar = tipo === "aprovar";
    const texto = el("textarea", { placeholder: aprovar ? "Observação para o gestor (opcional)" : "O que precisa ser ajustado? O gestor recebe este texto por e-mail." });
    const corpo = el("div", null,
      el("p", { class: "suave", style: "margin:0 0 10px" }, (aprovar
        ? "Confirme que o alinhamento com o gestor e com Financeiro/Engenharia (faixa salarial, budget, modelo de contratação e prioridade) foi feito."
        : "Explique com clareza o que falta ou precisa mudar.")),
      campo(aprovar ? "Observação" : "Reajustes necessários", texto, { largo: true, obrigatorio: !aprovar }));
    let linkVaga = "";
    const ok = await dialogo({
      titulo: (aprovar ? "Aprovar: " : "Pedir reajustes: ") + (i.dados.tituloCargo || i.id),
      corpo, okTexto: aprovar ? "Aprovar solicitação" : "Enviar pedido de reajuste", okClasse: aprovar ? "bt" : "bt-alerta",
      aoConfirmar: async () => {
        const c = texto.value.trim();
        if (!aprovar && c.length < 5) return "Descreva os reajustes necessários.";
        const r = await api("solic_decidir", { id: i.id, decisao: tipo, comentario: c });
        if (!r.ok) return r.erro || "Não foi possível registrar a decisão.";
        linkVaga = r.linkVaga || "";
        toast(r.mensagem || "Decisão registrada.");
        return true;
      }
    });
    if (!ok) return;
    if (aprovar && linkVaga) {
      const criar = await dialogo({
        titulo: "Criar a vaga agora?",
        corpo: el("p", { style: "margin:0" }, "A solicitação foi aprovada. O formulário da vaga abre em outra aba, já preenchido com os dados do gestor."),
        okTexto: "Abrir formulário da vaga"
      });
      if (criar) window.open(linkVaga, "_blank", "noopener");
    }
    recarregar();
  }

  // =================================================================
  //  Vagas (RH)
  // =================================================================
  async function viewVagas(box) {
    box.append(cabecalho("Vagas", "Somente vagas com status Aberta e prazo em dia aparecem no site. Mudanças entram no site em até 1 minuto.",
      el("a", { class: "bt-sec", href: "#solicitacoes" }, "Criar vaga a partir de solicitação")));
    const area = el("div", null, carregando());
    box.append(area);
    const r = await api("vagas_todas");
    limpar(area);
    if (!r.ok) return area.append(msg("erro", r.erro || "Não foi possível carregar as vagas."));
    if (!r.vagas.length) return area.append(el("div", { class: "vazio" }, "Nenhuma vaga cadastrada."));

    const vagas = r.vagas;
    const statusOpcoes = r.statusOpcoes || ["Aberta", "Pausada", "Fechada"];
    let filtro = "todas";
    let busca = "";
    const conta = s => vagas.filter(v => s === "todas" || v.status === s).length;

    const buscaInput = el("input", { type: "search", placeholder: "Buscar por título, ID ou localidade", "aria-label": "Buscar vagas" });
    const tbody = el("tbody");
    area.append(
      el("div", { class: "filtros" }, buscaInput,
        chips([{ id: "todas", nome: "Todas", qtd: vagas.length }].concat(statusOpcoes.map(s => ({ id: s, nome: s, qtd: conta(s) }))),
          filtro, id => { filtro = id; desenhar(); })),
      el("div", { class: "rolagem" }, el("table", { class: "tabela" },
        el("thead", null, el("tr", null, ["Vaga", "Status", "Inscrições até", "Inscritos", "No site", "Ações"].map(t => el("th", null, t)))),
        tbody)));
    buscaInput.addEventListener("input", () => { busca = norm(buscaInput.value); desenhar(); });

    function desenhar() {
      limpar(tbody);
      const vis = vagas.filter(v => (filtro === "todas" || v.status === filtro) &&
        (!busca || norm([v.vaga_id, v.titulo, v.localidade].join(" ")).indexOf(busca) >= 0));
      if (!vis.length) return tbody.append(el("tr", null, el("td", { colspan: "6", class: "suave" }, "Nenhuma vaga neste filtro.")));
      vis.forEach(v => tbody.append(linhaVaga(v)));
    }

    function linhaVaga(v) {
      const st = el("select", { "aria-label": "Status de " + v.titulo },
        statusOpcoes.concat(statusOpcoes.indexOf(v.status) < 0 && v.status ? [v.status] : []).map(s => el("option", { value: s, selected: s === v.status }, s)));
      const prazo = el("input", { type: "date", value: v.prazo_iso || "", "aria-label": "Inscrições até, " + v.titulo });
      const salvar = el("button", { type: "button", class: "bt", disabled: true }, "Salvar");
      const mudou = () => { salvar.disabled = st.value === v.status && prazo.value === (v.prazo_iso || ""); };
      st.addEventListener("change", mudou);
      prazo.addEventListener("change", mudou);
      salvar.addEventListener("click", async () => {
        salvar.disabled = true;
        salvar.textContent = "Salvando…";
        const res = await api("vaga_atualizar", { vaga_id: v.vaga_id, status_vaga: st.value, data_limite_inscricao: prazo.value });
        salvar.textContent = "Salvar";
        if (!res.ok) { toast(res.erro || "Não foi possível salvar.", true); mudou(); return; }
        Object.assign(v, res.vaga);
        toast("Vaga " + v.vaga_id + " atualizada.");
        desenhar();
      });

      return el("tr", null,
        el("td", { class: "titulo", "data-rotulo": "Vaga" }, el("b", null, v.titulo), el("span", { class: "mini" }, v.vaga_id + (v.localidade ? " · " + v.localidade : ""))),
        el("td", { "data-rotulo": "Status" }, st),
        el("td", { "data-rotulo": "Inscrições até" }, prazo),
        el("td", { "data-rotulo": "Inscritos" }, String(v.inscritos || 0)),
        el("td", { "data-rotulo": "No site" }, v.aberta_site ? pill("Aberta") : el("span", { class: "mini" }, v.status === "Aberta" ? "Prazo vencido" : "Não")),
        el("td", { "data-rotulo": "Ações" }, el("div", { class: "acoes" },
          salvar,
          el("button", { type: "button", class: "bt-sec", onclick: () => verCandidatos(v) }, "Candidatos"),
          v.planilha_url ? el("a", { class: "bt-sec", href: v.planilha_url, target: "_blank", rel: "noopener" }, "Planilha") : null,
          v.pasta_url ? el("a", { class: "bt-sec", href: v.pasta_url, target: "_blank", rel: "noopener" }, "Pasta") : null,
          v.link_publico ? el("button", { type: "button", class: "bt-sec", onclick: () => copiar(v.link_publico) }, "Copiar link") : null)));
    }
    desenhar();
  }

  async function verCandidatos(v) {
    const corpo = el("div", null, carregando("Abrindo a planilha da vaga…"));
    const promessa = api("vaga_candidatos", { vaga_id: v.vaga_id });
    dialogo({ titulo: "Candidatos — " + v.titulo, corpo, semOk: true, largo: true });
    const r = await promessa;
    limpar(corpo);
    if (!r.ok) return corpo.append(msg("erro", r.erro || "Não foi possível carregar os candidatos."));
    corpo.append(el("p", { class: "suave", style: "margin:0 0 12px" },
      "As etapas (aprovar, recusar e enviar e-mails) continuam sendo registradas na aba ETAPAS da planilha da vaga. ",
      v.planilha_url ? el("a", { href: v.planilha_url, target: "_blank", rel: "noopener" }, "Abrir planilha da vaga") : null));
    if (!r.candidatos.length) return corpo.append(el("div", { class: "vazio" }, "Nenhum candidato inscrito ainda."));
    corpo.append(el("div", { class: "rolagem" }, el("table", { class: "tabela" },
      el("thead", null, el("tr", null, ["Candidato", "Contato", "Inscrição", "Etapa atual", "Situação", "Currículo"].map(t => el("th", null, t)))),
      el("tbody", null, r.candidatos.map(c => el("tr", null,
        el("td", { class: "titulo", "data-rotulo": "Candidato" }, el("b", null, c.nome), el("span", { class: "mini" }, c.cand_id + (c.periodo_curso ? " · " + c.periodo_curso : ""))),
        el("td", { "data-rotulo": "Contato" }, el("div", null, c.email), el("span", { class: "mini" }, c.telefone)),
        el("td", { "data-rotulo": "Inscrição" }, c.data_inscricao),
        el("td", { "data-rotulo": "Etapa atual" }, c.etapa_atual || "—"),
        el("td", { "data-rotulo": "Situação" }, pill(c.status_publico), c.status ? el("div", { class: "mini" }, c.status) : null),
        el("td", { "data-rotulo": "Currículo" }, c.curriculo_link ? el("a", { href: c.curriculo_link, target: "_blank", rel: "noopener" }, "Abrir PDF") : "—")))))));
  }

  // =================================================================
  //  Admissões (RH) — RHC-PROC-2026-003
  // =================================================================
  async function viewAdmissoes(box) {
    const area = el("div", null, carregando());
    box.append(cabecalho("Admissões", "Do envio da proposta à aprovação do cadastro. Toda ação automática do sistema deve ser conferida pelo RH."), area);
    const r = await api("adm_listar");
    limpar(area);
    if (!r.ok) return area.append(msg("erro", r.erro || "Não foi possível carregar as admissões."));

    if (r.appUrl) {
      box.querySelector(".cab").append(el("div", { class: "acoes" },
        el("a", { class: "bt", href: r.appUrl + "?mode=gestor", target: "_blank", rel: "noopener" }, "Enviar nova proposta")));
    }

    const itens = r.itens;
    const conta = s => itens.filter(i => s === "todas" || grupoAdm(i.status) === s).length;
    area.append(el("div", { class: "numeros" },
      [["Propostas em andamento", "andamento"], ["Aguardando aprovação", "aprovar"], ["Aprovadas", "aprovadas"], ["Recusadas", "recusadas"]]
        .map(([n, g]) => el("div", { class: "numero" }, el("span", null, n), el("b", null, String(conta(g)))))));

    let filtro = conta("aprovar") ? "aprovar" : "todas";
    let busca = "";
    const buscaInput = el("input", { type: "search", placeholder: "Buscar por candidato, vaga, e-mail ou ID", "aria-label": "Buscar admissões" });
    const lista = el("div", { class: "lista" });
    area.append(el("div", { class: "filtros" }, buscaInput,
      chips([{ id: "aprovar", nome: "Aguardando aprovação", qtd: conta("aprovar") }, { id: "andamento", nome: "Em andamento", qtd: conta("andamento") },
        { id: "aprovadas", nome: "Aprovadas", qtd: conta("aprovadas") }, { id: "recusadas", nome: "Recusadas", qtd: conta("recusadas") },
        { id: "todas", nome: "Todas", qtd: itens.length }], filtro, id => { filtro = id; desenhar(); })), lista);
    buscaInput.addEventListener("input", () => { busca = norm(buscaInput.value); desenhar(); });

    function desenhar() {
      limpar(lista);
      const vis = itens.filter(i => (filtro === "todas" || grupoAdm(i.status) === filtro) &&
        (!busca || norm([i.requestId, i.candidato_nome, i.candidato_email, i.titulo_vaga].join(" ")).indexOf(busca) >= 0));
      if (!vis.length) return lista.append(el("div", { class: "vazio" }, "Nenhuma admissão neste filtro."));
      vis.forEach(i => lista.append(cartaoAdmissao(i, () => { limpar(box); viewAdmissoes(box); })));
    }
    desenhar();
  }

  function grupoAdm(s) {
    if (s === "AGUARDANDO_APROVACAO") return "aprovar";
    if (s === "PROPOSTA_ENVIADA" || s === "COMPLETANDO_CADASTRO") return "andamento";
    if (s === "APROVADA") return "aprovadas";
    if (s === "PROPOSTA_RECUSADA" || s === "RECUSADA_ADMIN") return "recusadas";
    return "outros";
  }

  function cartaoAdmissao(i, recarregar) {
    const arquivos = i.arquivos || [];
    return el("article", { class: "card" },
      el("div", { class: "item-topo" },
        el("div", null, el("h3", null, i.candidato_nome || "(sem nome)"),
          el("div", { class: "meta" },
            el("span", null, el("b", null, i.titulo_vaga || "")),
            el("span", null, i.requestId),
            i.data_inicio ? el("span", null, "Início ", el("b", null, fmtData(i.data_inicio))) : null,
            el("span", null, "Atualizado ", fmtData(i.updatedAt, true)))),
        pill(i.status)),
      i.erro_ultimo ? el("div", { class: "nota verm" }, el("strong", null, "Último erro do sistema"), i.erro_ultimo) : null,
      i.status === "RECUSADA_ADMIN" && i.approval_reason ? el("div", { class: "nota ambar" }, el("strong", null, "Justificativa enviada ao candidato"), i.approval_reason) : null,
      i.status === "APROVADA" ? el("div", { class: "nota verde" }, el("strong", null, "Depois da aprovação (manual)"),
        "• Confirme que o e-mail com Termo de Compromisso e Direito de Imagem chegou ao funcionário; envie manualmente o que faltar.\n" +
        "• Receba, confira e registre os documentos assinados na planilha de Funcionários.\n" +
        "• Cadastre o funcionário no aplicativo de ponto.\n" +
        "• Prepare o onboarding para o primeiro dia (sala, slides, camisa, crachá).") : null,
      el("details", { class: "mais" }, el("summary", null, "Ver dados e documentos"),
        dados([
          ["E-mail", i.candidato_email], ["Telefone", i.telefone_contato], ["Gestor", (i.gestor_nome || "") + (i.gestor_email ? " — " + i.gestor_email : "")],
          ["Função", i.funcao], ["Departamento", i.departamento], ["Setor", i.setor], ["Tipo de contratação", i.tipo_contratacao],
          ["Bolsa / remuneração", i.bolsa_valor || i.remuneracao_bolsa], ["CPF", i.cpf], ["RG", i.rg], ["Endereço", i.endereco_completo],
          ["Banco / Agência / Conta", i.dados_bancarios], ["PIX", i.pix], ["Formação", i.formacao], ["Matrícula UFF", i.matricula_uff],
          ["E-mail Innomaker", i.email_innomaker], ["Emergência", i.emergencia], ["Pasta do funcionário", i.pasta_funcionario_link]
        ]),
        arquivos.length ? el("div", { style: "margin-top:12px" }, el("b", { class: "pequeno" }, "Arquivos enviados"),
          el("ul", { class: "pequeno", style: "margin:6px 0 0" }, arquivos.map(a => el("li", null, el("a", { href: a.url, target: "_blank", rel: "noopener" }, a.name || "Arquivo"))))) : null),
      el("div", { class: "item-acoes acoes" },
        i.status === "AGUARDANDO_APROVACAO" ? el("button", { type: "button", class: "bt", onclick: () => aprovarAdmissao(i, recarregar) }, "Aprovar cadastro") : null,
        i.status === "AGUARDANDO_APROVACAO" ? el("button", { type: "button", class: "bt-perigo", onclick: () => recusarAdmissao(i, recarregar) }, "Recusar") : null,
        (i.status === "PROPOSTA_ENVIADA" || i.status === "COMPLETANDO_CADASTRO") ? el("button", { type: "button", class: "bt-sec", onclick: () => reenviarProposta(i, recarregar) }, "Reenviar proposta") : null,
        i.pasta_funcionario_link ? el("a", { class: "bt-sec", href: i.pasta_funcionario_link, target: "_blank", rel: "noopener" }, "Pasta do funcionário") : null));
  }

  async function aprovarAdmissao(i, recarregar) {
    const itens = [
      "Todos os campos obrigatórios estão preenchidos",
      "Todos os documentos obrigatórios foram recebidos",
      "Os dados conferem com os documentos anexados",
      "Os arquivos estão completos e legíveis",
      "Não há informações divergentes ou incorretas"
    ];
    const checks = itens.map(t => el("input", { type: "checkbox" }));
    const corpo = el("div", null,
      el("p", { class: "suave", style: "margin:0 0 12px" }, "Ao aprovar, o sistema registra o funcionário, cria a pasta no Drive, gera o Termo de Compromisso e o Direito de Imagem e envia os documentos para assinatura."),
      el("div", { style: "display:grid;gap:10px" }, itens.map((t, k) => el("label", { class: "check" }, checks[k], el("span", null, t)))));
    await dialogo({
      titulo: "Aprovar cadastro de " + (i.candidato_nome || i.requestId),
      corpo, okTexto: "Aprovar e registrar funcionário",
      aoConfirmar: async () => {
        if (checks.some(c => !c.checked)) return "Confirme todos os itens da conferência antes de aprovar.";
        const r = await api("adm_aprovar", { requestId: i.requestId });
        if (!r.ok) return r.erro || "Não foi possível aprovar.";
        toast("Cadastro aprovado. Matrícula " + (r.matricula || "") + ".");
        return true;
      }
    }) && recarregar();
  }

  async function recusarAdmissao(i, recarregar) {
    const motivo = el("textarea", { placeholder: "Explique exatamente o que está faltando ou incorreto. O candidato recebe este texto por e-mail." });
    const corpo = el("div", null,
      el("div", { class: "nota ambar", style: "margin:0 0 12px" }, "Se for só uma pendência de documento ou dado, prefira pedir a correção por e-mail e aprovar depois. A recusa encerra esta admissão."),
      campo("Justificativa", motivo, { largo: true, obrigatorio: true }));
    await dialogo({
      titulo: "Recusar cadastro de " + (i.candidato_nome || i.requestId),
      corpo, okTexto: "Recusar e avisar candidato", okClasse: "bt-perigo",
      aoConfirmar: async () => {
        if (motivo.value.trim().length < 5) return "Escreva a justificativa.";
        const r = await api("adm_recusar", { requestId: i.requestId, motivo: motivo.value.trim() });
        if (!r.ok) return r.erro || "Não foi possível recusar.";
        toast("Recusa registrada e candidato avisado.");
        return true;
      }
    }) && recarregar();
  }

  async function reenviarProposta(i, recarregar) {
    await dialogo({
      titulo: "Reenviar proposta",
      corpo: el("p", { style: "margin:0" }, "A proposta será enviada de novo para " + (i.candidato_email || "o candidato") + "."),
      okTexto: "Reenviar",
      aoConfirmar: async () => {
        const r = await api("adm_reenviar", { requestId: i.requestId });
        if (!r.ok) return r.erro || "Não foi possível reenviar.";
        toast("Proposta reenviada.");
        return true;
      }
    }) && recarregar();
  }

  // =================================================================
  //  Início
  // =================================================================
  $("logo").src = BOOT.logoUrl;
  $("uNome").textContent = U.nome || U.login;
  $("uPapel").textContent = U.papelNome;
  $("menuBtn").addEventListener("click", () => {
    const aberta = $("lateral").classList.toggle("aberta");
    $("menuBtn").setAttribute("aria-expanded", String(aberta));
  });
  montarMenu();
  window.addEventListener("hashchange", irPara);
  irPara();
})();
