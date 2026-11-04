/* Site público — Carreiras Innomaker (vagas.innomaker.com.br) */
/* global BOOT */
(function(){
  const $ = id => document.getElementById(id);
  const VAGAS = BOOT.vagas || [];
  const MAX_PDF = 10 * 1024 * 1024;
  let vagaAtual = null;
  let ultimoTracking = null;

  /* ---------- Assets e links ---------- */
  $("logoTop").src = BOOT.logoUrl;
  $("logoFoot").src = BOOT.logoUrl;
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

  function api(acao, dados){
    return fetch("/api", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action: acao }, dados))
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

    const estado = { page: page, vaga_id: params.vaga_id || "", cand_id: params.cand_id || "", t: params.t || "" };
    const q = new URLSearchParams();
    if (page !== "home") q.set("page", page);
    ["vaga_id", "cand_id", "t"].forEach(k => { if (estado[k]) q.set(k, estado[k]); });
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
      $("form").hidden = false;
      $("formDone").hidden = true;
      $("formBack").hidden = false;
      setMsg("formMsg");
      $("btnEnviar").disabled = false;
      $("btnEnviar").textContent = "Enviar candidatura";
    }
    return true;
  }

  function erroForm(m){ setMsg("formMsg", "err", null, m); $("formMsg").scrollIntoView({ behavior: "smooth", block: "center" }); }

  function lerPdf(file){
    return new Promise((ok, falha) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => falha(new Error("Não foi possível ler o arquivo."));
      r.readAsDataURL(file);
    });
  }

  $("form").addEventListener("submit", async function(ev){
    ev.preventDefault();
    if (!vagaAtual) return;
    setMsg("formMsg");

    const d = {
      nome: $("fNome").value.trim(), email: $("fEmail").value.trim(), telefone: $("fTel").value.trim(),
      periodo_curso: $("fPer").value.trim(), previsao_formatura: $("fPrev").value.trim(), obs_geral: $("fObs").value.trim()
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

    $("btnEnviar").disabled = true;
    $("btnEnviar").textContent = "Enviando…";
    loading(true, "Enviando candidatura");

    let res;
    try {
      const pdfBase64 = await lerPdf(file);
      res = await api("inscrever", Object.assign({ vaga_id: vagaAtual.vaga_id, t: vagaAtual.t, pdfBase64: pdfBase64, pdfName: file.name }, d));
    } catch (err) {
      res = { ok: false, erro: err && err.message };
    }
    loading(false);

    if (!res || !res.ok) {
      $("btnEnviar").disabled = false;
      $("btnEnviar").textContent = "Enviar candidatura";
      return erroForm((res && res.erro) || "Não foi possível enviar sua candidatura. Tente novamente.");
    }

    $("form").hidden = true;
    $("formBack").hidden = true;
    $("formDone").hidden = false;
    ultimoTracking = res.tracking_url || null;
    painelDados = null;
    setMsg("formMsg", "ok", "Inscrição enviada",
      "Seu código de candidatura é " + (res.cand_id || "gerado pelo sistema") + ". " +
      (res.conta_nova
        ? "Enviamos para " + d.email + " sua senha de acesso à área Minhas candidaturas, onde você acompanha todas as suas inscrições."
        : "Ela já aparece em Minhas candidaturas. Entre com seu e-mail e a senha que você já recebeu."));
    $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("btnAcompanharNovo").addEventListener("click", function(){
    let p = {};
    try {
      const u = new URL(ultimoTracking);
      p = { vaga_id: u.searchParams.get("vaga_id"), cand_id: u.searchParams.get("cand_id"), t: u.searchParams.get("t") };
    } catch(e) {}
    go("acompanhar", getSessao() ? {} : p);
  });

  /* ---------- Minhas candidaturas ---------- */
  const CHAVE_SESSAO = "innomaker_sessao";
  let painelDados = null;

  function getSessao(){ try { return localStorage.getItem(CHAVE_SESSAO) || ""; } catch(e) { return ""; } }
  function setSessao(v){ try { if (v) localStorage.setItem(CHAVE_SESSAO, v); else localStorage.removeItem(CHAVE_SESSAO); } catch(e) {} }

  function mostrarBox(qual){
    ["boxLogin", "boxEsqueci", "boxPainel", "boxLink"].forEach(id => { $(id).hidden = id !== qual; });
    $("aIntro").hidden = qual === "boxPainel";
  }

  function abrirAcompanhar(p){
    if (p && p.vaga_id && p.cand_id && p.t) return abrirPeloLink(p);
    if (painelDados && getSessao()) { renderPainel(painelDados); mostrarBox("boxPainel"); return carregarPainel(false); }
    if (getSessao()) { mostrarBox("boxPainel"); return carregarPainel(false); }
    abrirLogin();
  }

  function abrirLogin(msgTipo, msgTexto){
    mostrarBox("boxLogin");
    setMsg("loginMsg", msgTipo, null, msgTexto);
    $("btnLogin").disabled = false;
    $("btnLogin").textContent = "Entrar";
  }

  // Link do e-mail de confirmação: mostra a candidatura sem precisar de senha
  function abrirPeloLink(p){
    mostrarBox("boxLink");
    $("linkCand").innerHTML = "";
    setMsg("linkMsg", "info", null, "Carregando sua candidatura…");
    api("acompanhar", { vaga_id: p.vaga_id, cand_id: p.cand_id, t: p.t }).then(res => {
      if (!res || !res.ok) return setMsg("linkMsg", "err", null, (res && res.erro) || "Não foi possível abrir sua candidatura.");
      setMsg("linkMsg");
      $("linkCand").append(cardCandidatura(res.dados, true));
    });
  }

  function carregarPainel(atualizar){
    if (!painelDados) {
      $("pNome").textContent = "";
      $("pEmail").textContent = "";
      $("listaCand").innerHTML = "";
      setMsg("painelMsg", "info", null, "Carregando suas candidaturas…");
    }
    $("btnAtualizar").disabled = true;
    return api("minhas", { sessao: getSessao(), atualizar: !!atualizar }).then(res => {
      $("btnAtualizar").disabled = false;
      if (res && res.sessaoExpirada) { setSessao(""); painelDados = null; return abrirLogin("info", "Sua sessão expirou. Entre novamente."); }
      if (!res || !res.ok) return setMsg("painelMsg", "err", null, (res && res.erro) || "Não foi possível carregar suas candidaturas.");
      painelDados = res;
      renderPainel(res);
    });
  }

  function renderPainel(d){
    const nome = (d.conta && d.conta.nome) ? String(d.conta.nome).trim().split(/\s+/)[0] : "candidato(a)";
    $("pNome").textContent = nome;
    $("pEmail").textContent = d.conta ? d.conta.email : "";
    setMsg("painelMsg");
    const lista = $("listaCand");
    lista.innerHTML = "";
    const cands = d.candidaturas || [];
    if (!cands.length) {
      const vazio = el("div", "empty", "Ainda não encontramos candidaturas para este e-mail.");
      lista.append(vazio);
      return;
    }
    const resumo = el("p", "small", cands.length + (cands.length === 1 ? " candidatura" : " candidaturas") + ", da mais recente para a mais antiga.");
    resumo.style.margin = "0 0 12px";
    lista.append(resumo);
    cands.forEach((c, i) => lista.append(cardCandidatura(c, cands.length === 1)));
  }

  function cardCandidatura(d, aberto){
    const card = el("article", "card cand");
    const top = el("div", "track-top");
    const info = el("div");
    info.append(el("div", "small", "Candidatura " + d.cand_id));
    const h = el("h2", null, d.titulo_vaga || "Vaga");
    h.style.margin = "5px 0 8px";
    info.append(h);
    info.append(el("div", "small", "Inscrição: " + (d.data_inscricao || "-") + " • Última atualização: " + (d.ultima_atualizacao || "-")));
    const st = el("div", "status", d.status_publico || "Em processo");
    if (d.status_publico === "Processo encerrado") st.classList.add("fim");
    if (d.status_publico === "Processo concluído") st.classList.add("ok");
    top.append(info, st);
    card.append(top);

    const cur = el("div", "current");
    const lbl = el("div", "small", "Etapa atual");
    lbl.style.fontWeight = "800";
    cur.append(lbl, el("b", null, d.etapa_atual || d.status_publico || "-"), el("div", "small", d.mensagem || ""));
    card.append(cur);

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
        t.append(el("h3", null, e.nome || "Etapa"), el("p", null, (rot[e.estado] || "Aguardando") + (e.data ? " • " + e.data : "")));
        s.append(t);
        tl.append(s);
      });
      det.append(tl);
      card.append(det);
    }
    return card;
  }

  $("formLogin").addEventListener("submit", function(ev){
    ev.preventDefault();
    const email = $("lEmail").value.trim(), senha = $("lSenha").value.trim();
    if (!email || !senha) return setMsg("loginMsg", "err", null, "Informe seu e-mail e sua senha.");
    setMsg("loginMsg");
    $("btnLogin").disabled = true;
    $("btnLogin").textContent = "Entrando…";
    api("login", { email: email, senha: senha }).then(res => {
      $("btnLogin").disabled = false;
      $("btnLogin").textContent = "Entrar";
      if (!res || !res.ok) return setMsg("loginMsg", "err", null, (res && res.erro) || "Não foi possível entrar.");
      setSessao(res.sessao);
      $("lSenha").value = "";
      painelDados = res;
      renderPainel(res);
      mostrarBox("boxPainel");
    });
  });

  $("btnEsqueci").addEventListener("click", function(){
    $("eEmail").value = $("lEmail").value.trim();
    setMsg("esqueciMsg");
    $("btnEsqueciEnviar").disabled = false;
    mostrarBox("boxEsqueci");
    $("eEmail").focus();
  });
  $("btnVoltarLogin").addEventListener("click", () => abrirLogin());

  $("formEsqueci").addEventListener("submit", function(ev){
    ev.preventDefault();
    const email = $("eEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg("esqueciMsg", "err", null, "Informe um e-mail válido.");
    $("btnEsqueciEnviar").disabled = true;
    setMsg("esqueciMsg", "info", null, "Enviando…");
    api("esqueci", { email: email }).then(res => {
      $("btnEsqueciEnviar").disabled = false;
      if (!res || !res.ok) return setMsg("esqueciMsg", "err", null, (res && res.erro) || "Não foi possível enviar agora.");
      $("lEmail").value = email;
      abrirLogin("ok", res.mensagem);
    });
  });

  $("btnAtualizar").addEventListener("click", () => carregarPainel(true));

  $("btnSair").addEventListener("click", function(){
    setSessao("");
    painelDados = null;
    $("boxTrocar").hidden = true;
    abrirLogin("info", "Você saiu da sua área.");
  });

  $("btnTrocar").addEventListener("click", function(){
    $("boxTrocar").hidden = !$("boxTrocar").hidden;
    setMsg("trocarMsg");
    $("formTrocar").reset();
    if (!$("boxTrocar").hidden) $("sAtual").focus();
  });

  $("formTrocar").addEventListener("submit", function(ev){
    ev.preventDefault();
    const atual = $("sAtual").value.trim(), nova = $("sNova").value.trim(), conf = $("sConf").value.trim();
    if (!atual || !nova) return setMsg("trocarMsg", "err", null, "Preencha a senha atual e a nova senha.");
    if (nova.length < 6) return setMsg("trocarMsg", "err", null, "A nova senha precisa ter pelo menos 6 caracteres.");
    if (nova !== conf) return setMsg("trocarMsg", "err", null, "As duas senhas novas não são iguais.");
    $("btnTrocarSalvar").disabled = true;
    api("trocar_senha", { sessao: getSessao(), atual: atual, nova: nova }).then(res => {
      $("btnTrocarSalvar").disabled = false;
      if (res && res.sessaoExpirada) { setSessao(""); return abrirLogin("info", "Sua sessão expirou. Entre novamente."); }
      if (!res || !res.ok) return setMsg("trocarMsg", "err", null, (res && res.erro) || "Não foi possível trocar a senha.");
      setSessao(res.sessao);
      $("formTrocar").reset();
      setMsg("trocarMsg", "ok", null, "Senha alterada. Use a nova senha nos próximos acessos.");
    });
  });

  $("btnIrLogin").addEventListener("click", () => go("acompanhar", {}));

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
