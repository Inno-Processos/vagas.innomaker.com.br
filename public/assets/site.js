/* Site público — Vagas.Innomaker (vagas.innomaker.com.br) */
/* global BOOT */
(function(){
  const $ = id => document.getElementById(id);
  const VAGAS = BOOT.vagas || [];
  const MAX_PDF = 10 * 1024 * 1024;
  let vagaAtual = null;
  let ultimoTracking = null;

  /* ---------- Assets e links ---------- */
  $("lnkWhats").href = $("fWhats").href = BOOT.contato.whatsapp;
  $("lnkSite").href = $("fSite").href = BOOT.contato.site;
  $("fMail").href = "mailto:" + BOOT.contato.email;
  $("ano").textContent = new Date().getFullYear();
  let usvCarregada = false;
  function carregarUSV(){ if(!usvCarregada){ $("imgUSV").src = BOOT.usvUrl; usvCarregada = true; } }

  /* ---------- Utilitários ---------- */
  function el(tag, cls, txt){ const e = document.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }
  function caixa(tipo, titulo, texto){ const d = el("div", "msg " + tipo); if(titulo) d.append(el("strong", null, titulo)); d.append(document.createTextNode(texto || "")); return d; }
  function setMsg(id, tipo, titulo, texto){ const a = $(id); a.innerHTML = ""; if(tipo) a.append(caixa(tipo, titulo, texto)); }
  function loading(on, txt){ $("loadingTxt").textContent = txt || "Processando"; $("loading").hidden = !on; }
  function txt(v){ return v && String(v).trim() ? v : "—"; }

  // POST /api/candidato/<acao> — dados: objeto (JSON) ou FormData (com arquivos)
  function api(acao, dados){
    const ehForm = typeof FormData !== "undefined" && dados instanceof FormData;
    return fetch("/api/candidato/" + acao, {
      method: "POST",
      credentials: "same-origin",
      headers: ehForm ? {} : { "content-type": "application/json" },
      body: ehForm ? dados : JSON.stringify(dados || {})
    })
    .then(r => r.json())
    .catch(() => ({ ok: false, erro: "Falha de conexão. Verifique sua internet e tente novamente." }));
  }

  /* ---------- Navegação ---------- */
  const PAGES = ["home", "central", "vaga", "acompanhar", "msg"];

  function mostrar(page){
    document.querySelectorAll(".view").forEach(v => v.hidden = v.id !== "v-" + page);
    document.querySelectorAll(".nav button").forEach(b => {
      if (b.dataset.go === page) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }

  function go(page, params, push){
    params = params || {};
    if (page === "sucesso") page = "central";
    if (PAGES.indexOf(page) < 0) page = "home";

    if (page === "home") carregarUSV();
    if (page === "central") renderCentral();
    if (page === "vaga" && !abrirVaga(params.vaga_id)) {
      page = "msg";
      params = {};
      $("mTitulo").textContent = "Inscrições encerradas";
      $("mTexto").textContent = "Esta vaga não está mais recebendo inscrições ou o link está incompleto. Veja as outras oportunidades abertas.";
    }
    if (page === "acompanhar") abrirAcompanhar(params);

    mostrar(page);

    const estado = { page: page, vaga_id: params.vaga_id || "" };
    const q = new URLSearchParams();
    if (page !== "home") q.set("page", page);
    if (estado.vaga_id) q.set("vaga_id", estado.vaga_id);
    const url = q.toString() ? "?" + q.toString() : "/";
    if (push === false) history.replaceState(estado, "", url);
    else history.pushState(estado, "", url);
  }

  document.addEventListener("click", function(ev){
    const b = ev.target.closest("[data-go]");
    if (!b) return;
    ev.preventDefault();
    go(b.dataset.go, b.dataset.vaga ? { vaga_id: b.dataset.vaga } : {});
    if (b.dataset.scroll) setTimeout(() => $("formCard").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  });

  window.addEventListener("popstate", function(e){
    const s = e.state || {};
    go(s.page || "home", s, false);
  });

  /* ---------- Central ---------- */
  let centralPronta = false;
  function renderCentral(){
    if (centralPronta) return;
    centralPronta = true;

    if (BOOT.erro) $("centralErro").append(caixa("err", "Vagas indisponíveis", BOOT.erro));

    const grid = $("grid");
    VAGAS.forEach(v => {
      const c = el("article", "vcard");
      c.dataset.text = [v.titulo_vaga, v.localidade, v.tipo_vaga, v.tipo_contratacao, v.carga_horaria, v.remuneracao_bolsa].join(" ").toLowerCase();
      c.append(el("div", "pill", v.data_limite_inscricao ? "Inscrições até " + v.data_limite_inscricao : "Inscrições abertas"));
      c.append(el("h3", null, v.titulo_vaga || "Vaga"));
      const dl = el("dl");
      [["Local", v.localidade], ["Modalidade", v.tipo_vaga], ["Contratação", v.tipo_contratacao], ["Carga", v.carga_horaria], ["Remuneração", v.remuneracao_bolsa]]
        .forEach(([k, val]) => { dl.append(el("dt", null, k), el("dd", null, txt(val))); });
      c.append(dl);
      const a = el("div", "actions");
      const b1 = el("button", "btn-line", "Ver detalhes"); b1.dataset.go = "vaga"; b1.dataset.vaga = v.vaga_id;
      const b2 = el("button", "btn", "Inscrever-se"); b2.dataset.go = "vaga"; b2.dataset.vaga = v.vaga_id; b2.dataset.scroll = "1";
      a.append(b1, b2);
      c.append(a);
      grid.append(c);
    });
    filtrar();
  }

  function filtrar(){
    const term = $("q").value.trim().toLowerCase();
    let n = 0;
    document.querySelectorAll(".vcard").forEach(c => { const ok = !term || c.dataset.text.indexOf(term) >= 0; c.hidden = !ok; if (ok) n++; });
    $("counter").textContent = n + (n === 1 ? " vaga" : " vagas");
    $("resultsBar").hidden = VAGAS.length === 0;
    $("empty").hidden = n > 0;
    $("empty").textContent = VAGAS.length === 0 ? "No momento não há vagas abertas. Volte em breve." : "Nenhuma vaga encontrada para essa pesquisa.";
  }
  $("q").addEventListener("input", filtrar);

  /* ---------- Vaga ---------- */
  function abrirVaga(id){
    const v = VAGAS.find(x => x.vaga_id === String(id || "").trim());
    if (!v) return false;

    if (!vagaAtual || vagaAtual.vaga_id !== v.vaga_id) {
      vagaAtual = v;
      document.title = v.titulo_vaga + " — Innomaker";
      $("vTitulo").textContent = v.titulo_vaga;
      $("vLocal").textContent = txt(v.localidade);
      $("vTipo").textContent = txt(v.tipo_vaga);
      $("vContr").textContent = txt(v.tipo_contratacao);
      $("vCarga").textContent = txt(v.carga_horaria);
      $("vRem").textContent = txt(v.remuneracao_bolsa);
      $("vPrazo").textContent = txt(v.data_limite_inscricao);
      $("vDesc").textContent = txt(v.descricao_geral);
      $("vReq").textContent = txt(v.requisitos);
      $("vFun").textContent = txt(v.principais_funcoes);
      $("form").reset();
      if (BOOT.candidato) {
        $("fNome").value = BOOT.candidato.nome || "";
        $("fEmail").value = BOOT.candidato.email || "";
        $("fTel").value = BOOT.candidato.telefone || "";
      }
      $("form").hidden = false;
      $("formDone").hidden = true;
      $("formBack").hidden = false;
      setMsg("formMsg");
      $("btnEnviar").disabled = false;
      $("btnEnviar").textContent = "Enviar candidatura";
    }
    return true;
  }

  /* ---------- Inscrição ---------- */
  function erroForm(m){ setMsg("formMsg", "err", null, m); $("formMsg").scrollIntoView({ behavior: "smooth", block: "center" }); }

  $("form").addEventListener("submit", async function(ev){
    ev.preventDefault();
    if (!vagaAtual) return;
    setMsg("formMsg");

    const d = {
      nome: $("fNome").value.trim(), email: $("fEmail").value.trim(), telefone: $("fTel").value.trim(),
      periodo_curso: $("fPer").value.trim(), previsao_formatura: $("fPrev").value.trim(), mensagem: $("fObs").value.trim()
    };
    const file = $("fPdf").files[0];

    if (!d.nome) return erroForm("Preencha seu nome completo.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return erroForm("Informe um e-mail válido.");
    if (!d.telefone) return erroForm("Preencha seu telefone ou WhatsApp.");
    if (!d.periodo_curso) return erroForm("Preencha seu período ou semestre.");
    if (!d.previsao_formatura) return erroForm("Preencha sua previsão de formatura.");
    if (!file) return erroForm("Selecione seu currículo em PDF.");
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""))) return erroForm("O currículo precisa estar em PDF.");
    if (file.size > MAX_PDF) return erroForm("O currículo passa de 10 MB.");

    const fd = new FormData();
    fd.append("vaga_id", vagaAtual.vaga_id);
    Object.keys(d).forEach(k => fd.append(k, d[k]));
    fd.append("curriculo", file);

    $("btnEnviar").disabled = true;
    $("btnEnviar").textContent = "Enviando…";
    loading(true, "Enviando candidatura");
    const res = await api("inscrever", fd);
    loading(false);

    if (!res || !res.ok) {
      $("btnEnviar").disabled = false;
      $("btnEnviar").textContent = "Enviar candidatura";
      return erroForm((res && res.erro) || "Não foi possível enviar sua candidatura. Tente novamente.");
    }

    $("form").hidden = true;
    $("formBack").hidden = true;
    $("formDone").hidden = false;
    areaDados = null;
    setMsg("formMsg", "ok", "Inscrição enviada",
      res.conta_nova
        ? "Enviamos para " + d.email + " a senha da sua Área do candidato, onde você acompanha todas as suas inscrições."
        : "Ela já aparece na sua Área do candidato. Entre com seu e-mail e a senha que você já recebeu.");
    $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("btnAcompanharNovo").addEventListener("click", () => go("acompanhar", {}));

  /* ---------- Área do candidato ---------- */
  let areaDados = null;
  let logado = !!BOOT.candidato;

  const fmtData = iso => {
    if (!iso) return "";
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[3] + "/" + m[2] + "/" + m[1];
    const dt = new Date(iso);
    return isNaN(dt.getTime()) ? String(iso) : dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  };

  function mostrarBox(qual){
    ["boxLogin", "boxEsqueci", "boxArea"].forEach(id => { $(id).hidden = id !== qual; });
    $("aIntro").hidden = qual === "boxArea";
  }

  function abrirAcompanhar(){
    if (logado) {
      mostrarBox("boxArea");
      if (areaDados) renderArea(areaDados);
      carregarArea();
    } else {
      abrirLogin();
    }
  }

  function abrirLogin(tipo, texto){
    mostrarBox("boxLogin");
    setMsg("loginMsg", tipo, null, texto);
    $("btnLogin").disabled = false;
    $("btnLogin").textContent = "Entrar";
  }

  async function carregarArea(){
    if (!areaDados) { $("areaConteudo").innerHTML = ""; setMsg("areaMsg", "info", null, "Carregando sua área…"); }
    $("btnAtualizar").disabled = true;
    const r = await api("area");
    $("btnAtualizar").disabled = false;
    if (r && r.sessaoExpirada) { logado = false; areaDados = null; return abrirLogin("info", "Sua sessão expirou. Entre novamente."); }
    if (!r || !r.ok) return setMsg("areaMsg", "err", null, (r && r.erro) || "Não foi possível carregar sua área.");
    areaDados = r;
    setMsg("areaMsg");
    renderArea(r);
  }

  function secao(titulo, sub){
    const h = el("h2", "area-titulo", titulo);
    const box = el("div", "area-secao");
    box.append(h);
    if (sub) box.append(el("p", "small", sub));
    return box;
  }

  function dl(pares){
    const d = el("dl", "dados-lista");
    pares.forEach(([k, v]) => { if (v) { d.append(el("dt", null, k), el("dd", null, v)); } });
    return d;
  }

  function renderArea(d){
    $("pNome").textContent = String(d.conta.nome || "").split(" ")[0] || "candidato(a)";
    $("pEmail").textContent = d.conta.email;
    const box = $("areaConteudo");
    box.innerHTML = "";

    (d.admissoes || []).forEach(a => box.append(cardAdmissao(a, d)));

    const docs = d.documentos || [];
    if (docs.length) {
      const s = secao("Documentos", "Leia com atenção e assine. Você também pode imprimir ou salvar em PDF.");
      docs.forEach(doc => {
        const c = el("article", "card cand");
        const top = el("div", "track-top");
        top.append(el("h3", "doc-titulo", doc.titulo));
        top.append(el("span", "status" + (doc.status === "ASSINADO" ? " ok" : " pend"), doc.status === "ASSINADO" ? "Assinado em " + fmtData(doc.assinado_em) : "Aguardando sua assinatura"));
        c.append(top);
        const a = el("a", doc.status === "ASSINADO" ? "btn-line" : "btn", doc.status === "ASSINADO" ? "Ver documento" : "Ler e assinar");
        a.href = "/documento/" + encodeURIComponent(doc.id);
        a.style.marginTop = "12px";
        c.append(a);
        s.append(c);
      });
      box.append(s);
    }

    const s = secao("Minhas candidaturas");
    const cands = d.candidaturas || [];
    if (!cands.length) s.append(el("div", "empty", "Você ainda não tem candidaturas."));
    cands.forEach((c, i) => s.append(cardCandidatura(c, cands.length === 1)));
    box.append(s);
  }

  function cardCandidatura(d, aberto){
    const card = el("article", "card cand");
    const top = el("div", "track-top");
    const info = el("div");
    info.append(el("div", "small", "Inscrição em " + fmtData(d.data_inscricao)));
    const h = el("h2", null, d.titulo_vaga || "Vaga");
    h.style.margin = "5px 0 8px";
    info.append(h);
    const st = el("div", "status", d.status_publico || "Em processo");
    if (d.status_publico === "Processo encerrado" || d.status_publico === "Desistência registrada") st.classList.add("fim");
    if (d.status_publico === "Processo concluído" || d.status_publico === "Contratado") st.classList.add("ok");
    top.append(info, st);
    card.append(top);

    if (d.etapa_atual && d.status_publico === "Em processo") {
      const cur = el("div", "current");
      cur.append(el("div", "small", "Etapa atual"), el("b", null, d.etapa_atual), el("div", "small", d.mensagem || ""));
      card.append(cur);
    } else if (d.mensagem && d.status_publico !== "Contratado") {
      card.append(el("p", "small", d.mensagem));
    }

    if ((d.etapas || []).length) {
      const det = el("details");
      if (aberto) det.open = true;
      det.append(el("summary", null, "Ver todas as etapas"));
      const tl = el("div", "timeline");
      const rot = { concluida: "Concluída", atual: "Etapa atual", encerrada: "Processo encerrado", pendente: "Aguardando" };
      d.etapas.forEach((e, i) => {
        const s = el("div", "step " + e.estado);
        s.append(el("div", "dot", e.estado === "concluida" ? "✓" : e.estado === "encerrada" ? "×" : e.estado === "atual" ? "●" : String(i + 1)));
        const t = el("div");
        t.append(el("h3", null, e.nome || "Etapa"), el("p", null, (rot[e.estado] || "Aguardando") + (e.data ? " • " + fmtData(e.data) : "")));
        s.append(t);
        tl.append(s);
      });
      det.append(tl);
      card.append(det);
    }
    return card;
  }

  // ---------- Proposta e admissão ----------
  function cardAdmissao(a, d){
    const card = el("article", "card cand adm");
    const p = a.proposta || {};
    const top = el("div", "track-top");
    const info = el("div");
    info.append(el("div", "small", "Proposta " + a.id), el("h2", null, a.titulo_vaga));
    info.lastChild.style.margin = "5px 0 8px";
    const rotulos = {
      PROPOSTA_ENVIADA: ["Aguardando sua resposta", "pend"], COMPLETANDO_CADASTRO: ["Preencha seu cadastro", "pend"],
      CORRECAO_SOLICITADA: ["Ajustes solicitados", "fim"], AGUARDANDO_APROVACAO: ["Em análise pelo RH", ""],
      APROVADA: ["Admissão aprovada", "ok"], PROPOSTA_RECUSADA: ["Proposta recusada", "fim"], RECUSADA: ["Não aprovada", "fim"]
    };
    const r = rotulos[a.status] || [a.status, ""];
    top.append(info, el("div", "status " + r[1], r[0]));
    card.append(top);

    const resumo = dl([
      ["Contratação", p.tipo_contratacao], ["Cargo", p.cargo], ["Função", p.funcao], ["Departamento", p.departamento],
      ["Setor", p.setor], ["Horário", p.horario_trabalho], ["Bolsa / remuneração", p.bolsa_valor], ["Auxílio", p.auxilio],
      ["Início", fmtData(p.data_inicio)], ["Local", p.localidade]
    ]);

    if (a.status === "PROPOSTA_ENVIADA") {
      card.append(el("p", null, "Parabéns! Você concluiu o processo seletivo e recebeu esta proposta. Confira as condições:"));
      card.append(resumo);
      if (p.principais_funcoes) {
        const det = el("details"); det.open = true;
        det.append(el("summary", null, "Principais funções"), el("p", "pre", p.principais_funcoes));
        card.append(det);
      }
      const msgBox = el("div");
      const motivo = el("textarea", "input");
      motivo.placeholder = "Se quiser, conte o motivo da recusa (opcional).";
      motivo.hidden = true;
      const btA = el("button", "btn", "Aceitar proposta");
      const btR = el("button", "btn-line", "Recusar");
      const responder = async decisao => {
        btA.disabled = btR.disabled = true;
        const res = await api("proposta", { admissao_id: a.id, decisao, motivo: motivo.value.trim() });
        btA.disabled = btR.disabled = false;
        if (!res.ok) { msgBox.innerHTML = ""; msgBox.append(caixa("err", null, res.erro || "Não foi possível registrar.")); return; }
        carregarArea();
      };
      btA.onclick = () => responder("aceitar");
      btR.onclick = () => {
        if (motivo.hidden) { motivo.hidden = false; btR.textContent = "Confirmar recusa"; motivo.focus(); return; }
        responder("recusar");
      };
      const ac = el("div", "actions");
      ac.style.marginTop = "16px";
      ac.append(btA, btR);
      card.append(motivo, ac, msgBox);
      return card;
    }

    if (a.status === "COMPLETANDO_CADASTRO" || a.status === "CORRECAO_SOLICITADA") {
      if (a.status === "CORRECAO_SOLICITADA" && a.correcao) card.append(caixa("warn", "O RH pediu ajustes", a.correcao));
      card.append(el("p", null, "Preencha seus dados e envie os documentos. Use o e-mail pessoal (não use o IdUFF)."));
      if (d.links && d.links.cartilha) {
        const c = caixa("info", "Antes de enviar", "Leia a Cartilha do Colaborador: ");
        const l = el("a", null, "abrir cartilha");
        l.href = d.links.cartilha; l.target = "_blank"; l.rel = "noopener";
        c.append(l);
        card.append(c);
      }
      card.append(formCadastro(a, d));
      return card;
    }

    card.append(resumo);
    if (a.status === "AGUARDANDO_APROVACAO") card.append(caixa("info", null, "Recebemos seu cadastro. O RH está conferindo seus dados e documentos. Você recebe um e-mail com a decisão."));
    if (a.status === "APROVADA") {
      card.append(caixa("ok", "Bem-vindo(a) à Innomaker!", "Assine os documentos listados abaixo. Seu onboarding será no primeiro dia, " + fmtData(p.data_inicio) + "."));
      if (d.links && d.links.onboarding) {
        const l = el("a", "btn-line", "Agendar onboarding");
        l.href = d.links.onboarding; l.target = "_blank"; l.rel = "noopener"; l.style.marginTop = "12px";
        card.append(l);
      }
    }
    if (a.status === "RECUSADA" && a.recusa) card.append(caixa("warn", "Justificativa do RH", a.recusa));
    return card;
  }

  const CAD_SECOES = [
    ["Dados pessoais", [
      ["nome", "Nome completo", "text", 1, { largo: 1 }], ["cpf", "CPF", "text", 1, { ph: "000.000.000-00", modo: "numeric" }],
      ["rg", "RG", "text", 1], ["data_nascimento", "Data de nascimento", "date", 1], ["sexo", "Sexo", "select", 0, { op: ["Feminino", "Masculino", "Prefiro não informar"] }],
      ["cnh", "CNH", "text", 0], ["ctps", "CTPS", "text", 0],
      ["telefone", "Telefone / WhatsApp", "tel", 1], ["email_pessoal", "E-mail pessoal", "email", 1],
      ["curriculo_lattes", "Link do Currículo Lattes", "url", 0, { largo: 1 }]
    ]],
    ["Endereço", [
      ["cep", "CEP", "text", 1, { modo: "numeric" }], ["endereco", "Endereço (rua, número, complemento)", "text", 1, { largo: 1 }],
      ["bairro", "Bairro", "text", 1], ["cidade", "Cidade", "text", 1], ["estado", "UF", "text", 1, { max: 2 }]
    ]],
    ["Formação", [
      ["grau_instrucao", "Grau de instrução", "select", 1, { op: ["Graduando", "Graduado", "Mestrando", "Mestre", "Doutorando", "Doutor"] }],
      ["area_formacao", "Curso / área de formação", "text", 1], ["instituicao_ensino", "Instituição de ensino", "text", 1],
      ["matricula_uff", "Matrícula UFF", "text", 0, { dica: "Obrigatória para estágio ou bolsa vinculados à UFF." }], ["cr", "CR acadêmico", "text", 0],
      ["email_innomaker", "E-mail Innomaker", "email", 0, { largo: 1, dica: "Crie no formato nomesobrenome.innomaker@gmail.com e cole aqui." }]
    ]],
    ["Dados bancários", [
      ["banco", "Banco", "text", 0], ["agencia", "Agência", "text", 0], ["conta", "Conta", "text", 0],
      ["tipo_conta", "Tipo de conta", "select", 0, { op: ["Corrente", "Poupança", "Pagamento"] }],
      ["pix_numero", "Chave PIX", "text", 0], ["pix_banco", "Banco do PIX", "text", 0]
    ]],
    ["Contato de emergência", [
      ["nome_emergencia", "Nome", "text", 1], ["telefone_emergencia", "Telefone", "tel", 1]
    ]]
  ];

  const CAD_ARQUIVOS = [
    ["doc_pessoais", "Documentos pessoais (RG, CPF, comprovante de residência)", 1],
    ["doc_curriculo", "Currículo atualizado", 0],
    ["doc_matricula", "Regularização de matrícula", 0],
    ["doc_cr", "Declaração de CR", 0],
    ["doc_plano", "Plano de estudos", 0]
  ];

  function formCadastro(a, d){
    const v = Object.assign({ nome: d.conta.nome, email_pessoal: d.conta.email }, a.cadastro || {});
    const form = el("form", "cadastro");
    form.noValidate = true;

    CAD_SECOES.forEach(([titulo, campos]) => {
      form.append(el("h3", "cad-titulo", titulo));
      const g = el("div", "cad-grid");
      campos.forEach(([nome, rotulo, tipo, obrig, o]) => {
        o = o || {};
        const w = el("div", "field" + (o.largo ? " largo" : ""));
        w.dataset.campo = nome;
        const lab = el("label", null, rotulo + (obrig ? " *" : ""));
        lab.htmlFor = "cad_" + nome;
        let inp;
        if (tipo === "select") {
          inp = el("select", "input");
          inp.append(new Option("Selecione", ""));
          o.op.forEach(x => inp.append(new Option(x, x, false, v[nome] === x)));
        } else {
          inp = el("input", "input");
          inp.type = tipo;
          if (o.ph) inp.placeholder = o.ph;
          if (o.modo) inp.inputMode = o.modo;
          if (o.max) inp.maxLength = o.max;
          inp.value = v[nome] || "";
        }
        inp.id = "cad_" + nome;
        inp.name = nome;
        w.append(lab, inp);
        if (o.dica) w.append(el("p", "hint", o.dica));
        g.append(w);
      });
      form.append(g);
    });

    // CEP → endereço (ViaCEP)
    const cep = form.querySelector("[name=cep]");
    cep.addEventListener("blur", async () => {
      const n = cep.value.replace(/\D/g, "");
      if (n.length !== 8) return;
      try {
        const r = await (await fetch("https://viacep.com.br/ws/" + n + "/json/")).json();
        if (r.erro) return;
        [["endereco", r.logradouro], ["bairro", r.bairro], ["cidade", r.localidade], ["estado", r.uf]].forEach(([k, val]) => {
          const i = form.querySelector("[name=" + k + "]");
          if (i && !i.value && val) i.value = val;
        });
      } catch (e) { /* preenchimento manual */ }
    });

    form.append(el("h3", "cad-titulo", "Documentos"));
    form.append(el("p", "hint", "PDF, JPG ou PNG, até 10 MB cada. Os itens sem * só são necessários quando se aplicam a você."));
    CAD_ARQUIVOS.forEach(([cat, rotulo, obrig]) => {
      const w = el("div", "field");
      w.dataset.campo = cat;
      const lab = el("label", null, rotulo + (obrig ? " *" : ""));
      lab.htmlFor = "arq_" + cat;
      const inp = el("input", "input");
      inp.type = "file"; inp.id = "arq_" + cat; inp.name = cat; inp.multiple = true;
      inp.accept = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";
      w.append(lab);
      const existentes = (a.arquivos || []).filter(x => x.categoria === cat);
      if (existentes.length) {
        const ul = el("ul", "arq-lista");
        existentes.forEach(x => {
          const li = el("li");
          const link = el("a", null, x.nome);
          link.href = "/arquivo/" + x.id; link.target = "_blank"; link.rel = "noopener";
          const rem = el("label", "rem");
          const cb = el("input"); cb.type = "checkbox"; cb.name = "remover"; cb.value = x.id;
          rem.append(cb, document.createTextNode(" remover"));
          li.append(link, rem);
          ul.append(li);
        });
        w.append(ul);
      }
      w.append(inp);
      form.append(w);
    });

    const msg = el("div");
    const bt = el("button", "btn", a.status === "CORRECAO_SOLICITADA" ? "Enviar correções" : "Enviar cadastro ao RH");
    bt.type = "submit";
    bt.style.marginTop = "18px";
    form.append(msg, bt);

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      msg.innerHTML = "";
      form.querySelectorAll(".erro").forEach(x => x.classList.remove("erro"));
      const faltando = [];
      CAD_SECOES.forEach(([, campos]) => campos.forEach(([nome, , , obrig]) => {
        if (obrig && !String(form.querySelector("[name=" + nome + "]").value || "").trim()) faltando.push(nome);
      }));
      const temPessoais = (a.arquivos || []).some(x => x.categoria === "doc_pessoais" &&
        !form.querySelector('[name=remover][value="' + x.id + '"]:checked')) || form.querySelector("[name=doc_pessoais]").files.length;
      if (!temPessoais) faltando.push("doc_pessoais");
      if (faltando.length) return marcarErros(form, msg, faltando, "Preencha os campos obrigatórios marcados.");

      const grandes = [...form.querySelectorAll("input[type=file]")].flatMap(i => [...i.files]).filter(f => f.size > MAX_PDF);
      if (grandes.length) return marcarErros(form, msg, [], '"' + grandes[0].name + '" passa de 10 MB.');

      const fd = new FormData(form);
      fd.append("admissao_id", a.id);
      bt.disabled = true;
      bt.textContent = "Enviando…";
      loading(true, "Enviando cadastro e documentos");
      const res = await api("cadastro", fd);
      loading(false);
      bt.disabled = false;
      bt.textContent = a.status === "CORRECAO_SOLICITADA" ? "Enviar correções" : "Enviar cadastro ao RH";
      if (!res.ok) return marcarErros(form, msg, res.campos || [], res.erro || "Não foi possível enviar.");
      areaDados = null;
      await carregarArea();
      setMsg("areaMsg", "ok", "Cadastro enviado", "O RH vai conferir seus dados e documentos. Você recebe um e-mail com a decisão.");
      window.scrollTo(0, 0);
    });
    return form;
  }

  function marcarErros(form, msg, campos, texto){
    campos.forEach(n => { const w = form.querySelector('[data-campo="' + n + '"]'); if (w) w.classList.add("erro"); });
    msg.innerHTML = "";
    msg.append(caixa("err", null, texto));
    const primeiro = form.querySelector(".erro") || msg;
    primeiro.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------- Login, senha e saída ----------
  $("formLogin").addEventListener("submit", async function(ev){
    ev.preventDefault();
    const email = $("lEmail").value.trim(), senha = $("lSenha").value.trim();
    if (!email || !senha) return setMsg("loginMsg", "err", null, "Informe seu e-mail e sua senha.");
    setMsg("loginMsg");
    $("btnLogin").disabled = true;
    $("btnLogin").textContent = "Entrando…";
    const res = await api("login", { email, senha });
    $("btnLogin").disabled = false;
    $("btnLogin").textContent = "Entrar";
    if (!res.ok) return setMsg("loginMsg", "err", null, res.erro || "Não foi possível entrar.");
    logado = true;
    $("lSenha").value = "";
    mostrarBox("boxArea");
    carregarArea();
  });

  $("btnEsqueci").addEventListener("click", function(){
    $("eEmail").value = $("lEmail").value.trim();
    setMsg("esqueciMsg");
    mostrarBox("boxEsqueci");
    $("eEmail").focus();
  });
  $("btnVoltarLogin").addEventListener("click", () => abrirLogin());

  $("formEsqueci").addEventListener("submit", async function(ev){
    ev.preventDefault();
    const email = $("eEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg("esqueciMsg", "err", null, "Informe um e-mail válido.");
    $("btnEsqueciEnviar").disabled = true;
    setMsg("esqueciMsg", "info", null, "Enviando…");
    const res = await api("esqueci", { email });
    $("btnEsqueciEnviar").disabled = false;
    if (!res.ok) return setMsg("esqueciMsg", "err", null, res.erro || "Não foi possível enviar agora.");
    $("lEmail").value = email;
    abrirLogin("ok", res.mensagem);
  });

  $("btnAtualizar").addEventListener("click", () => carregarArea());

  $("btnSair").addEventListener("click", async function(){
    await api("sair");
    logado = false;
    areaDados = null;
    BOOT.candidato = null;
    $("boxTrocar").hidden = true;
    abrirLogin("info", "Você saiu da sua área.");
  });

  $("btnTrocar").addEventListener("click", function(){
    $("boxTrocar").hidden = !$("boxTrocar").hidden;
    setMsg("trocarMsg");
    $("formTrocar").reset();
    if (!$("boxTrocar").hidden) $("sAtual").focus();
  });

  $("formTrocar").addEventListener("submit", async function(ev){
    ev.preventDefault();
    const atual = $("sAtual").value.trim(), nova = $("sNova").value.trim(), conf = $("sConf").value.trim();
    if (!atual || !nova) return setMsg("trocarMsg", "err", null, "Preencha a senha atual e a nova senha.");
    if (nova.length < 8) return setMsg("trocarMsg", "err", null, "A nova senha precisa ter pelo menos 8 caracteres.");
    if (nova !== conf) return setMsg("trocarMsg", "err", null, "As duas senhas novas não são iguais.");
    $("btnTrocarSalvar").disabled = true;
    const res = await api("senha", { atual, nova });
    $("btnTrocarSalvar").disabled = false;
    if (res.sessaoExpirada) { logado = false; return abrirLogin("info", "Sua sessão expirou. Entre novamente."); }
    if (!res.ok) return setMsg("trocarMsg", "err", null, res.erro || "Não foi possível trocar a senha.");
    $("formTrocar").reset();
    setMsg("trocarMsg", "ok", null, "Senha alterada. Use a nova senha nos próximos acessos.");
  });

  /* ---------- Início ---------- */
  go(BOOT.page || "home", BOOT.params || {}, false);
})();

/* ---------- Menu no celular ---------- */
(function(){
  const nav = document.getElementById("navPrincipal");
  const bt = document.getElementById("menuToggle");
  if (!nav || !bt) return;
  function fechar(){ nav.classList.remove("aberto"); bt.setAttribute("aria-expanded", "false"); }
  bt.addEventListener("click", function(){
    const abrir = !nav.classList.contains("aberto");
    nav.classList.toggle("aberto", abrir);
    bt.setAttribute("aria-expanded", String(abrir));
  });
  nav.addEventListener("click", function(ev){ if (ev.target.closest("[data-go]")) fechar(); });
  document.addEventListener("keydown", function(ev){ if (ev.key === "Escape") fechar(); });
})();

/* ---------- Botão de acesso interno (Authelia) ---------- */
(function(){
  const b = document.getElementById("btnStaff");
  if (!b || !BOOT.staff || !BOOT.staff.temSessao) return;
  fetch("/api/staff/me", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" })
    .then(r => r.ok ? r.json() : null)
    .then(res => {
      if (!res || !res.ok || !res.usuario) return;
      b.textContent = "Painel";
      b.classList.add("logado");
      b.title = res.usuario.nome + " — " + res.usuario.papelNome;
    })
    .catch(() => {});
})();
