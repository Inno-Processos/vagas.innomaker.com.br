/* Site público — Vagas.Innomaker (vagas.innomaker.com.br) */
/* global BOOT */
(function(){
  const $ = id => document.getElementById(id);
  const VAGAS = BOOT.vagas || [];
  const MAX_PDF = 10 * 1024 * 1024;
  let vagaAtual = null;
  const URL_INICIAL = new URLSearchParams(location.search); // origem/indicação do link (a navegação limpa a URL)
  if (BOOT.params && BOOT.params.vaga_id) URL_INICIAL.set("vaga_id", BOOT.params.vaga_id);
  const slug = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
  function caminhoDe(page, vagaId){
    if (page === "central") return "/vagas";
    if (page === "acompanhar") return "/area-do-candidato";
    if (page === "vaga" && vagaId) {
      const v = VAGAS.find(x => x.vaga_id === vagaId);
      return "/vagas/" + [slug(v && v.titulo_vaga), vagaId.toLowerCase()].filter(Boolean).join("-");
    }
    if (page === "msg") return location.pathname;
    return "/";
  }
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
    .then(r => (r.headers.get("content-type") || "").indexOf("application/json") >= 0
      ? r.json()
      : { ok: false, erro: "O sistema está sendo atualizado. Aguarde alguns segundos e tente de novo." })
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
    // origem/indicação ficam no endereço da vaga (para o link copiado continuar valendo)
    const extra = new URLSearchParams();
    if (page === "vaga" && URL_INICIAL.get("vaga_id") === estado.vaga_id) ["origem", "ind"].forEach(k => { if (URL_INICIAL.get(k)) extra.set(k, URL_INICIAL.get(k)); });
    const url = caminhoDe(page, estado.vaga_id) + (extra.toString() ? "?" + extra.toString() : "");
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
      prepararOrigem(v.vaga_id);
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

  // Origem da inscrição: link de indicação (?origem=indicacao&ind=Nome) ou convite do banco de talentos (?origem=talentos)
  // Chamado ao abrir a vaga (depois do reset do formulário); só vale para a vaga do link.
  function prepararOrigem(vagaId){
    const q = new URLSearchParams(location.search);
    if (!q.get("origem")) q.set("origem", URL_INICIAL.get("vaga_id") === vagaId ? URL_INICIAL.get("origem") || "" : "");
    if (!q.get("ind") && URL_INICIAL.get("vaga_id") === vagaId && URL_INICIAL.get("ind")) q.set("ind", URL_INICIAL.get("ind"));
    const o = String(q.get("origem") || "").replace(/[^a-z]/g, "");
    const opcao = o ? $("fOrigem").querySelector("option[value=" + o + "]") : null;
    $("fOrigem").querySelector("option[value=talentos]").hidden = o !== "talentos";
    if (opcao) $("fOrigem").value = o;
    if (q.get("ind")) $("fIndicado").value = q.get("ind").slice(0, 150);
    $("campoIndicado").hidden = $("fOrigem").value !== "indicacao";
  }
  $("fOrigem").addEventListener("change", () => { $("campoIndicado").hidden = $("fOrigem").value !== "indicacao"; });

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
    if ($("fOrigem").value === "indicacao" && !$("fIndicado").value.trim()) return erroForm("Informe o nome de quem indicou você.");
    if (!$("fAceite").checked) return erroForm("Para se inscrever, leia e aceite a Política de privacidade.");

    const fd = new FormData();
    fd.append("vaga_id", vagaAtual.vaga_id);
    Object.keys(d).forEach(k => fd.append(k, d[k]));
    fd.append("curriculo", file);
    fd.append("origem", $("fOrigem").value);
    fd.append("indicado_por", $("fOrigem").value === "indicacao" ? $("fIndicado").value.trim() : "");
    fd.append("aceite_privacidade", $("fAceite").checked ? "1" : "");
    fd.append("banco_talentos", $("fBanco").checked ? "1" : "");

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

    const s = secao("Minhas candidaturas");
    const cands = d.candidaturas || [];
    if (!cands.length) s.append(el("div", "empty", "Você ainda não tem candidaturas."));
    cands.forEach((c, i) => s.append(cardCandidatura(c, cands.length === 1)));
    box.append(s);
    if (d.privacidade) box.append(secaoPrivacidade(d.privacidade));
  }

  // ---------- Privacidade (LGPD): banco de talentos e exclusão dos dados ----------
  function secaoPrivacidade(p){
    const s = secao("Privacidade e meus dados", "Seus direitos pela LGPD. Veja na Política de privacidade como usamos seus dados.");
    const card = el("article", "card cand");
    const lb = el("label", "check-linha");
    const ck = document.createElement("input");
    ck.type = "checkbox";
    ck.checked = !!p.banco_talentos;
    lb.append(ck, el("span", null, "Quero ficar no banco de talentos da Innomaker e ser chamado(a) para outras vagas."));
    const st = el("p", "small", "");
    const pintar = () => { st.textContent = ck.checked ? "Autorizado" + (p.banco_talentos_em ? " em " + fmtData(p.banco_talentos_em) : "") + ". Desmarque para retirar a autorização." : "Você não está no banco de talentos."; };
    pintar();
    ck.addEventListener("change", async function(){
      ck.disabled = true;
      const r = await api("privacidade", { banco_talentos: ck.checked });
      ck.disabled = false;
      if (r.sessaoExpirada) { logado = false; return abrirLogin("info", "Sua sessão expirou. Entre novamente."); }
      if (!r.ok) { ck.checked = !ck.checked; return alert(r.erro || "Não foi possível salvar."); }
      p.banco_talentos = r.banco_talentos;
      p.banco_talentos_em = r.banco_talentos ? new Date().toISOString() : "";
      pintar();
    });
    card.append(lb, st);

    const acoes = el("div", "privacidade-acoes");
    const pol = el("a", "btn-line", "Política de privacidade");
    pol.href = "/privacidade"; pol.target = "_blank"; pol.rel = "noopener";
    const bt = el("button", "btn-perigo", "Excluir meus dados");
    bt.type = "button";
    acoes.append(pol, bt);
    card.append(acoes);
    const area = el("div");
    card.append(area);
    bt.addEventListener("click", function(){
      area.innerHTML = "";
      if (p.motivoNaoExclui) { area.append(caixa("warn", "Não é possível excluir por aqui", p.motivoNaoExclui)); return; }
      const f = document.createElement("form");
      f.noValidate = true;
      f.style.marginTop = "14px";
      f.append(caixa("warn", "Isso não pode ser desfeito", "Vamos apagar sua conta, seus currículos e todas as suas candidaturas. Se houver entrevista marcada, ela será cancelada."));
      const campo = (rot, tipo, id, auto) => { const d = el("div", "field"); const l = el("label", null, rot); l.htmlFor = id; const i = document.createElement("input"); i.className = "input"; i.type = tipo; i.id = id; i.autocomplete = auto; d.append(l, i); return d; };
      f.append(campo("Digite EXCLUIR para confirmar", "text", "exConf", "off"), campo("Sua senha", "password", "exSenha", "current-password"));
      const m = el("div"); f.append(m);
      const ok = el("button", "btn-perigo", "Excluir definitivamente"); ok.type = "submit";
      const cancelar = el("button", "btn-line", "Cancelar"); cancelar.type = "button";
      cancelar.addEventListener("click", () => { area.innerHTML = ""; });
      const linha = el("div", "privacidade-acoes"); linha.append(ok, cancelar); f.append(linha);
      f.addEventListener("submit", async function(ev){
        ev.preventDefault();
        m.innerHTML = "";
        ok.disabled = true;
        const r = await api("excluir", { confirmacao: $("exConf").value, senha: $("exSenha").value });
        ok.disabled = false;
        if (r.sessaoExpirada) { logado = false; return abrirLogin("info", "Sua sessão expirou. Entre novamente."); }
        if (!r.ok) return m.append(caixa("err", null, r.erro || "Não foi possível excluir."));
        logado = false; areaDados = null; BOOT.candidato = null;
        abrirLogin("ok", "Seus dados foram excluídos. Enviamos uma confirmação para o seu e-mail.");
      });
      area.append(f);
      $("exConf").focus();
    });
    s.append(card);
    return s;
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
      if (d.marcada) {
        const m = d.marcada;
        const ag = el("div", "agenda-cand");
        ag.append(el("span", null, "📅 ", el("b", null, "Marcada para " + fmtData(m.data) + (m.hora ? " às " + m.hora : "")), m.local ? " — " + m.local : ""));
        cur.append(ag);
      }
      if (d.agenda) {
        const ag = el("div", "agenda-cand");
        const h = d.agenda.horario;
        ag.append(el("span", "small", h ? (d.agenda.passou ? "Seu horário foi em " : "Seu horário: ") + fmtData(h.slice(0, 10)) + " às " + h.slice(11, 16) : "Escolha o horário da etapa " + d.agenda.etapa + "."));
        if (!d.agenda.passou) {
          const a = el("a", h ? "btn-line" : "btn", h ? "Ver ou trocar horário" : "Escolher horário");
          a.href = d.agenda.url;
          ag.append(a);
        }
        cur.append(ag);
      }
      const desistir = el("button", "link-btn", "Desistir da candidatura");
      desistir.type = "button";
      desistir.style.margin = "10px 0 0";
      desistir.onclick = async () => {
        const motivo = prompt("Desistir da candidatura para " + d.titulo_vaga + "?\nO RH será avisado. Se quiser, escreva o motivo:");
        if (motivo === null) return;
        const r = await api("desistir", { candidatura_id: d.id, motivo });
        if (r.sessaoExpirada) { logado = false; return abrirLogin("info", "Sua sessão expirou. Entre novamente."); }
        if (!r.ok) return alert(r.erro || "Não foi possível registrar.");
        areaDados = null;
        carregarArea();
      };
      cur.append(desistir);
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
        t.append(el("h3", null, e.nome || "Etapa"), el("p", null, (rot[e.estado] || "Aguardando") + (e.data ? " • " + fmtData(e.data) + (e.hora ? " às " + e.hora : "") : "")));
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
      APROVADA: ["Admissão aprovada", "ok"], PROPOSTA_RECUSADA: ["Proposta recusada", "fim"], RECUSADA: ["Não aprovada", "fim"],
      PROPOSTA_EXPIRADA: ["Prazo vencido", "fim"], CANCELADA: ["Cancelada", "fim"]
    };
    const r = rotulos[a.status] || [a.status, ""];
    top.append(info, el("div", "status " + r[1], r[0]));
    card.append(top);

    const resumo = dl([
      ["Contratação", p.tipo_contratacao], ["Cargo", p.cargo], ["Função", p.funcao], ["Departamento", p.departamento],
      ["Setor", p.setor], ["Horário", p.horario_trabalho],
      ...(p.bolsa_innomaker ? [["Bolsa Innomaker", p.bolsa_innomaker],
        ...(p.tem_outra_bolsa ? [["Outra bolsa", p.bolsa_valor + (p.entidade_vinculada ? " (" + p.entidade_vinculada + ")" : "")],
          ["Período da outra bolsa", [fmtData(p.data_inicial_bolsa), fmtData(p.data_final_bolsa)].filter(Boolean).join(" até ")]] : []),
        ["Salário bruto", p.salario_bruto]] : [["Bolsa / remuneração", p.bolsa_valor]]),
      ["Auxílio", p.auxilio],
      ["Início", fmtData(p.data_inicio)], ["Fim do contrato", fmtData(p.data_fim_contrato || (p.bolsa_innomaker ? "" : p.data_final_bolsa))], ["Local", p.localidade]
    ]);

    if (a.status === "PROPOSTA_ENVIADA") {
      const alt = (a.alteracoes || []).slice(-1)[0];
      if (alt) card.append(caixa("warn", "A proposta foi atualizada em " + fmtData(alt.quando), alt.texto.split("; ").join("\n")));
      card.append(el("p", null, "Parabéns! Você concluiu o processo seletivo e recebeu esta proposta. Confira as condições:"));
      if (a.prazo_resposta) card.append(caixa("info", null, "Responda até " + fmtData(a.prazo_resposta) + ". Depois dessa data a proposta deixa de valer."));
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
      const opcoes = p.opcoes_inicio || [];
      let horaEscolhida = "";
      if (opcoes.length) {
        const box = el("div", "inicio-escolha");
        box.append(el("b", null, "Em que horário você começa no dia " + fmtData(p.data_inicio) + "?"),
          el("p", "small", "Seu primeiro dia é o onboarding" + (p.local_inicio ? ", em " + p.local_inicio : "") + ". Escolha um horário para aceitar a proposta."));
        const linha = el("div", "inicio-horas");
        opcoes.forEach(h => {
          const b = el("button", "horario-inicio", h);
          b.type = "button";
          b.onclick = () => { horaEscolhida = h; linha.querySelectorAll("button").forEach(x => x.classList.toggle("sel", x === b)); };
          linha.append(b);
        });
        box.append(linha);
        card.append(box);
      }
      const btA = el("button", "btn", "Aceitar proposta");
      const btR = el("button", "btn-line", "Recusar");
      const responder = async decisao => {
        if (decisao === "aceitar" && opcoes.length && !horaEscolhida) { msgBox.innerHTML = ""; msgBox.append(caixa("err", null, "Escolha o horário em que você vai começar.")); return; }
        btA.disabled = btR.disabled = true;
        const res = await api("proposta", { admissao_id: a.id, decisao, motivo: motivo.value.trim(), hora_inicio: horaEscolhida });
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

    if (["COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA", "AGUARDANDO_APROVACAO", "APROVADA"].indexOf(a.status) >= 0 && p.data_inicio) card.append(primeiroDia(a, p));

    if (a.status === "COMPLETANDO_CADASTRO" || a.status === "CORRECAO_SOLICITADA") {
      if (d.links && d.links.cartilha && a.status === "COMPLETANDO_CADASTRO") {
        const c = caixa("info", "Antes de começar", "Leia a Cartilha do Colaborador: ");
        const l = el("a", null, "abrir cartilha");
        l.href = d.links.cartilha; l.target = "_blank"; l.rel = "noopener";
        c.append(l);
        card.append(c);
      }
      card.append(assistenteCadastro(a, d));
      return card;
    }

    if (a.status === "PROPOSTA_EXPIRADA") { card.append(caixa("warn", "O prazo para responder terminou", "Esta proposta não está mais valendo. Se ainda tiver interesse, fale com o RH.")); return card; }
    if (a.status === "CANCELADA") { card.append(caixa("warn", "Proposta cancelada pelo RH", a.recusa || "")); return card; }
    card.append(resumo);
    if (a.status === "AGUARDANDO_APROVACAO") card.append(caixa("info", null, "Recebemos seu cadastro. O RH está conferindo seus dados e documentos. Você recebe um e-mail com a decisão."));
    if (a.status === "APROVADA") {
      card.append(caixa("ok", "Bem-vindo(a) à Innomaker!", "Seu cadastro foi aprovado. Seu onboarding será no primeiro dia, " + fmtData(p.data_inicio) + (p.hora_inicio ? " às " + p.hora_inicio : "") + "."));
    }
    if (a.status === "RECUSADA" && a.recusa) card.append(caixa("warn", "Justificativa do RH", a.recusa));
    return card;
  }

  // Primeiro dia (onboarding): dia definido pelo RH e horário escolhido pelo candidato; pode mudar até 24 h antes
  function primeiroDia(a, p){
    const box = el("div", "agenda-cand");
    box.append(el("span", null, "📅 Primeiro dia (onboarding): ", el("b", null, fmtData(p.data_inicio) + (p.hora_inicio ? " às " + p.hora_inicio : "")),
      p.local_inicio ? " — " + p.local_inicio : ""));
    if (p.pode_mudar_inicio && (p.opcoes_inicio || []).length > 1) {
      const sel = document.createElement("select");
      sel.className = "input";
      sel.style.width = "auto";
      p.opcoes_inicio.forEach(h => sel.append(new Option(h, h, false, h === p.hora_inicio)));
      const bt = el("button", "btn-line", "Mudar horário");
      bt.type = "button";
      bt.onclick = async () => {
        bt.disabled = true;
        const r = await api("hora_inicio", { admissao_id: a.id, hora_inicio: sel.value });
        bt.disabled = false;
        if (!r.ok) return alert(r.erro || "Não foi possível mudar.");
        areaDados = null; carregarArea();
      };
      const lado = el("span", "inicio-mudar");
      lado.append(sel, bt);
      box.append(lado);
    }
    return box;
  }

  // ---------- Cadastro de admissão em etapas (salva sozinho) ----------
  // [campo, rótulo, tipo, obrigatório, etapa, opções]
  const CAD_CAMPOS = [
    ["nome", "Nome completo", "text", 1, "pessoais", { largo: 1, auto: "name" }], ["cpf", "CPF", "text", 1, "pessoais", { ph: "000.000.000-00", modo: "numeric" }],
    ["data_nascimento", "Data de nascimento", "date", 1, "pessoais"],
    ["sexo", "Sexo", "select", 0, "pessoais", { op: ["Feminino", "Masculino", "Prefiro não informar"] }],
    ["rg", "RG", "text", 1, "pessoais"], ["rg_orgao", "Órgão expedidor/UF do RG", "text", 1, "pessoais", { ph: "Ex.: DETRAN/RJ" }],
    ["cnh", "CNH", "text", 0, "pessoais"], ["cnh_orgao", "Órgão expedidor/UF da CNH", "text", 0, "pessoais", { ph: "Ex.: DETRAN/RJ" }],
    ["ctps", "CTPS", "text", 0, "pessoais"], ["ctps_orgao", "Órgão expedidor/UF da CTPS", "text", 0, "pessoais", { ph: "Ex.: MTE/RJ" }],
    ["telefone", "Telefone / WhatsApp", "tel", 1, "pessoais", { auto: "tel" }], ["email_pessoal", "E-mail pessoal", "email", 1, "pessoais", { dica: "Pode ser o IdUFF (@id.uff.br).", auto: "email" }],
    ["curriculo_lattes", "Link do Currículo Lattes", "url", 0, "pessoais", { largo: 1 }],
    ["cep", "CEP", "text", 1, "endereco", { modo: "numeric", auto: "postal-code", dica: "O endereço é preenchido sozinho pelo CEP." }],
    ["endereco", "Endereço (rua, número, complemento)", "text", 1, "endereco", { largo: 1, auto: "street-address" }],
    ["bairro", "Bairro", "text", 1, "endereco"], ["cidade", "Cidade", "text", 1, "endereco"], ["estado", "UF", "text", 1, "endereco", { max: 2 }],
    ["nome_emergencia", "Contato de emergência (nome)", "text", 1, "endereco"], ["telefone_emergencia", "Telefone do contato de emergência", "tel", 1, "endereco"],
    ["grau_instrucao", "Grau de instrução", "select", 1, "formacao", { op: ["Graduando", "Graduado", "Mestrando", "Mestre", "Doutorando", "Doutor"] }],
    ["area_formacao", "Curso / área de formação", "text", 1, "formacao"], ["instituicao_ensino", "Instituição de ensino", "text", 1, "formacao"],
    ["matricula_uff", "Matrícula UFF", "text", 0, "formacao", { dica: "Obrigatória para estágio ou bolsa vinculados à UFF." }], ["cr", "CR acadêmico", "text", 0, "formacao"],
    ["email_innomaker", "E-mail Innomaker", "email", 0, "formacao", { largo: 1, dica: "Se já tiver: nomesobrenome.innomaker@gmail.com." }],
    ["resumo", "Resumo sobre você", "textarea", 1, "formacao", { largo: 1, max: 2000, ph: "Ex.: Estudante de Engenharia Mecânica (6º período) na UFF, com experiência em modelagem 3D e interesse em manufatura.",
      dica: "Conte em poucas linhas quem você é: profissão ou curso, experiências e interesses." }],
    ["pix_numero", "Chave PIX", "text", 0, "banco", { largo: 1, dica: "Informe a chave PIX ou banco, agência e conta." }], ["pix_banco", "Banco do PIX", "text", 0, "banco"],
    ["banco", "Banco", "text", 0, "banco"], ["agencia", "Agência", "text", 0, "banco"], ["conta", "Conta", "text", 0, "banco"],
    ["tipo_conta", "Tipo de conta", "select", 0, "banco", { op: ["Corrente", "Poupança", "Pagamento"] }]
  ];
  const CAD_ETAPAS = [["pessoais", "Dados pessoais"], ["endereco", "Endereço e emergência"], ["formacao", "Formação"], ["banco", "Dados bancários"],
    ["documentos", "Documentos"], ["revisar", "Revisar e enviar"]];
  const etapaDoCampo = k => { const c = CAD_CAMPOS.find(x => x[0] === k); return c ? c[4] : "documentos"; };

  function assistenteCadastro(a, d){
    const v = Object.assign({ nome: d.conta.nome, email_pessoal: d.conta.email }, a.cadastro || {});
    let arqs = (a.arquivos || []).slice();
    const corr = a.correcoes && a.correcoes.itens ? a.correcoes : null;
    const apontado = new Map((corr ? corr.itens : []).map(i => [i.chave, i]));
    const exigidos = a.documentos_exigidos || [];
    const caixaW = el("div", "assistente");
    let etapa = corr && corr.itens.length ? etapaDoCampo(corr.itens[0].chave) : "pessoais";
    const marcadosErro = new Set();

    // Rascunho: salva 1,2 s depois de parar de digitar
    const estado = el("span", "small salvo");
    let timer = null, salvando = Promise.resolve();
    const salvar = () => {
      clearTimeout(timer);
      estado.textContent = "Salvando…";
      salvando = api("rascunho", { admissao_id: a.id, dados: v }).then(r => {
        estado.textContent = r && r.ok ? "Rascunho salvo às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Não foi possível salvar o rascunho. Verifique sua internet.";
      });
      return salvando;
    };
    const agendarSalvar = () => { clearTimeout(timer); estado.textContent = "Alterações não salvas…"; timer = setTimeout(salvar, 1200); };

    if (corr) {
      const box = caixa("warn", "O RH pediu ajustes", corr.itens.length ? "Corrija os itens abaixo (eles aparecem destacados no formulário):" : "");
      if (corr.itens.length) {
        const ul = el("ul", "lista-ajustes");
        corr.itens.forEach(i => {
          const li = el("li");
          const bt = el("button", "link-btn", i.rotulo);
          bt.type = "button";
          bt.onclick = () => { etapa = etapaDoCampo(i.chave); desenhar(); };
          li.append(bt, document.createTextNode(": " + i.comentario));
          ul.append(li);
        });
        box.append(ul);
      }
      if (corr.texto) box.append(el("p", "small", corr.texto));
      caixaW.append(box);
    }

    const passos = el("ol", "passos-cad");
    const corpo = el("div", "passo-cad-corpo");
    const msgBox = el("div");
    const rodape = el("div", "passo-cad-rodape");
    caixaW.append(passos, corpo, msgBox, rodape);

    const faltandoNaEtapa = et => {
      const f = CAD_CAMPOS.filter(c => c[4] === et && c[3] && !String(v[c[0]] || "").trim()).map(c => c[0]);
      if (et === "banco" && !String(v.pix_numero || "").trim() && !(v.banco && v.agencia && v.conta)) f.push("pix_numero", "banco", "agencia", "conta");
      if (et === "documentos") {
        docsFaltando().forEach(x => f.push(x.id));
        // documento apontado pelo RH precisa de arquivo novo
        if (corr) corr.itens.filter(i => i.tipo === "arquivo" && !docNovo(i.chave) && f.indexOf(i.chave) < 0).forEach(i => f.push(i.chave));
      }
      return f;
    };
    const docsFaltando = () => {
      const tem = new Set(arqs.map(x => x.categoria));
      return exigidos.filter(x => x.obrigatorio && !tem.has(x.id) && !(tem.has("doc_pessoais") && ["doc_rg", "doc_cpf", "doc_comprovante"].indexOf(x.id) >= 0));
    };
    const docNovo = id => !corr || !apontado.has(id) || arqs.some(x => x.categoria === id && x.criado_em > corr.em);

    function desenhar(){
      passos.innerHTML = "";
      CAD_ETAPAS.forEach(([id, nome], i) => {
        const li = el("li", "passo-cad" + (id === etapa ? " atual" : "") + (id !== "revisar" && !faltandoNaEtapa(id).length ? " ok" : "")
          + (corr && corr.itens.some(x => etapaDoCampo(x.chave) === id) ? " ajuste" : ""));
        const bt = el("button", null, null);
        bt.type = "button";
        bt.append(el("span", "passo-num", String(i + 1)), el("span", "passo-nome", nome));
        bt.onclick = () => { etapa = id; desenhar(); };
        if (id === etapa) bt.setAttribute("aria-current", "step");
        li.append(bt);
        passos.append(li);
      });
      corpo.innerHTML = "";
      msgBox.innerHTML = "";
      if (etapa === "documentos") desenharDocumentos();
      else if (etapa === "revisar") desenharRevisao();
      else desenharCampos(etapa);
      rodape.innerHTML = "";
      const i = CAD_ETAPAS.findIndex(x => x[0] === etapa);
      if (i > 0) { const b = el("button", "btn-line", "Voltar"); b.type = "button"; b.onclick = () => { etapa = CAD_ETAPAS[i - 1][0]; desenhar(); scrollTopo(); }; rodape.append(b); }
      if (etapa !== "revisar") {
        const b = el("button", "btn", "Salvar e continuar"); b.type = "button";
        b.onclick = async () => {
          const f = faltandoNaEtapa(etapa);
          if (f.length) return marcarErros(corpo, msgBox, f, etapa === "documentos" ? "Envie os documentos obrigatórios marcados." : etapa === "banco" ? "Informe a chave PIX ou banco, agência e conta." : "Preencha os campos obrigatórios marcados.");
          if (etapa !== "documentos") await salvar();
          etapa = CAD_ETAPAS[i + 1][0]; desenhar(); scrollTopo();
        };
        rodape.append(b);
      }
      rodape.append(estado);
    }
    const scrollTopo = () => caixaW.scrollIntoView({ behavior: "smooth", block: "start" });

    function desenharCampos(et){
      const g = el("div", "cad-grid");
      CAD_CAMPOS.filter(c => c[4] === et).forEach(([nome, rotulo, tipo, obrig, , o]) => {
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
        } else if (tipo === "textarea") {
          inp = el("textarea", "input");
          inp.rows = 5;
          if (o.ph) inp.placeholder = o.ph;
          if (o.max) inp.maxLength = o.max;
          inp.value = v[nome] || "";
        } else {
          inp = el("input", "input");
          inp.type = tipo;
          if (o.ph) inp.placeholder = o.ph;
          if (o.modo) inp.inputMode = o.modo;
          if (o.max) inp.maxLength = o.max;
          if (o.auto) inp.autocomplete = o.auto;
          inp.value = v[nome] || "";
        }
        inp.id = "cad_" + nome;
        inp.name = nome;
        inp.addEventListener(tipo === "select" ? "change" : "input", () => { v[nome] = inp.value; w.classList.remove("erro"); agendarSalvar(); });
        w.append(lab, inp);
        const aj = apontado.get(nome);
        if (aj) { w.classList.add("ajuste"); w.append(el("p", "hint ajuste-txt", "RH: " + aj.comentario)); }
        if (o.dica) w.append(el("p", "hint", o.dica));
        g.append(w);
      });
      corpo.append(g);
      if (et === "endereco") {
        const cep = corpo.querySelector("[name=cep]");
        cep.addEventListener("blur", async () => {
          const n = cep.value.replace(/\D/g, "");
          if (n.length !== 8) return;
          try {
            const r = await (await fetch("https://viacep.com.br/ws/" + n + "/json/")).json();
            if (r.erro) return;
            [["endereco", r.logradouro], ["bairro", r.bairro], ["cidade", r.localidade], ["estado", r.uf]].forEach(([k, val]) => {
              const i = corpo.querySelector("[name=" + k + "]");
              if (i && !i.value && val) { i.value = val; v[k] = val; }
            });
            agendarSalvar();
          } catch (e) { /* preenchimento manual */ }
        });
      }
    }

    function desenharDocumentos(){
      corpo.append(el("p", "hint", "PDF, JPG ou PNG, até 10 MB cada. Cada documento é salvo assim que você escolhe o arquivo. Os itens sem * só são necessários se você tiver."));
      corpo.append(blocoFoto());
      const lista = exigidos.slice();
      // envios antigos (documentos pessoais juntos) continuam aparecendo
      if (arqs.some(x => x.categoria === "doc_pessoais")) lista.unshift({ id: "doc_pessoais", nome: "Documentos pessoais (enviados antes)", obrigatorio: false, antigo: true });
      lista.forEach(doc => {
        const w = el("div", "field doc-cand");
        w.dataset.campo = doc.id;
        const meus = arqs.filter(x => x.categoria === doc.id);
        const ok = meus.length && docNovo(doc.id);
        w.append(el("div", "doc-cand-topo", null));
        w.firstChild.append(el("b", null, doc.nome + (doc.obrigatorio ? " *" : "")), el("span", "status " + (ok ? "ok" : doc.obrigatorio ? "pend" : ""), ok ? "Enviado" : doc.obrigatorio ? "Falta" : "Opcional"));
        const aj = apontado.get(doc.id);
        if (aj) { w.classList.add("ajuste"); w.append(el("p", "hint ajuste-txt", "RH: " + aj.comentario + (docNovo(doc.id) ? " (arquivo novo enviado)" : " — envie um arquivo novo."))); }
        if (meus.length) {
          const ul = el("ul", "arq-lista");
          meus.forEach(x => {
            const li = el("li");
            const link = el("a", null, x.nome);
            link.href = "/arquivo/" + x.id; link.target = "_blank"; link.rel = "noopener";
            const rem = el("button", "link-btn", "remover");
            rem.type = "button";
            rem.onclick = async () => {
              rem.disabled = true;
              const res = await api("desanexar", { admissao_id: a.id, arquivo_id: x.id });
              if (!res.ok) { rem.disabled = false; return alert(res.erro || "Não foi possível remover."); }
              arqs = arqs.filter(y => y.id !== x.id);
              desenhar();
            };
            li.append(link, rem);
            ul.append(li);
          });
          w.append(ul);
        }
        if (!doc.antigo) {
          const inp = el("input", "input");
          inp.type = "file"; inp.multiple = true; inp.id = "arq_" + doc.id;
          inp.accept = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";
          inp.setAttribute("aria-label", "Enviar " + doc.nome);
          const st = el("p", "hint");
          inp.addEventListener("change", async () => {
            const files = [...inp.files];
            if (!files.length) return;
            const grande = files.find(f => f.size > MAX_PDF);
            if (grande) { st.textContent = '"' + grande.name + '" passa de 10 MB.'; inp.value = ""; return; }
            inp.disabled = true;
            st.textContent = "Enviando " + files.length + " arquivo(s)…";
            const fd = new FormData();
            fd.append("admissao_id", a.id); fd.append("categoria", doc.id);
            files.forEach(f => fd.append("arquivo", f));
            const res = await api("anexar", fd);
            inp.disabled = false; inp.value = "";
            if (!res.ok) { st.textContent = res.erro || "Não foi possível enviar."; return; }
            const agora = new Date().toISOString();
            res.arquivos.forEach(x => arqs.push({ id: x.id, nome: x.nome, categoria: doc.id, criado_em: x.criado_em || agora }));
            desenhar();
          });
          w.append(inp, st);
        }
        corpo.append(w);
      });
    }

    // Foto 3x4 (opcional): JPG ou PNG, uma só; a nova substitui a anterior
    function blocoFoto(){
      const w = el("div", "field doc-cand foto-cand");
      w.dataset.campo = "foto";
      const atual = arqs.filter(x => x.categoria === "foto").slice(-1)[0];
      const ok = atual && docNovo("foto");
      w.append(el("div", "doc-cand-topo", null));
      w.firstChild.append(el("b", null, "Foto 3x4"), el("span", "status " + (ok ? "ok" : ""), ok ? "Enviada" : "Opcional"));
      const aj = apontado.get("foto");
      if (aj) { w.classList.add("ajuste"); w.append(el("p", "hint ajuste-txt", "RH: " + aj.comentario + (docNovo("foto") ? " (foto nova enviada)" : " — envie uma foto nova."))); }
      const linha = el("div", "foto-linha");
      if (atual) {
        const img = el("img", "foto-3x4"); img.src = "/arquivo/" + atual.id; img.alt = "Sua foto 3x4";
        linha.append(img);
      }
      const txt = el("div");
      txt.append(el("p", "hint", "Uma foto bonita, de rosto, com fundo claro e boa luz (como em documento). JPG ou PNG, até 10 MB."));
      const inp = el("input", "input");
      inp.type = "file"; inp.accept = "image/jpeg,image/png,.jpg,.jpeg,.png"; inp.id = "arq_foto";
      inp.setAttribute("aria-label", atual ? "Trocar a foto 3x4" : "Enviar foto 3x4");
      const st = el("p", "hint");
      inp.addEventListener("change", async () => {
        const f = inp.files[0];
        if (!f) return;
        if (f.size > MAX_PDF) { st.textContent = '"' + f.name + '" passa de 10 MB.'; inp.value = ""; return; }
        inp.disabled = true; st.textContent = "Enviando…";
        const fd = new FormData();
        fd.append("admissao_id", a.id); fd.append("categoria", "foto"); fd.append("arquivo", f);
        const res = await api("anexar", fd);
        inp.disabled = false; inp.value = "";
        if (!res.ok) { st.textContent = res.erro || "Não foi possível enviar."; return; }
        arqs = arqs.filter(x => x.categoria !== "foto");
        res.arquivos.forEach(x => arqs.push({ id: x.id, nome: x.nome, categoria: "foto", criado_em: x.criado_em || new Date().toISOString() }));
        desenhar();
      });
      txt.append(inp, st);
      linha.append(txt);
      w.append(linha);
      return w;
    }

    function desenharRevisao(){
      corpo.append(el("p", null, "Confira tudo antes de enviar. Depois do envio, o RH confere e você recebe um e-mail com a decisão."));
      CAD_ETAPAS.filter(x => x[0] !== "revisar").forEach(([id, nome]) => {
        const sec = el("div", "rev-secao");
        const cab = el("div", "rev-cab");
        const f = faltandoNaEtapa(id);
        cab.append(el("h3", "cad-titulo", nome), el("span", "status " + (f.length ? "pend" : "ok"), f.length ? "Falta preencher" : "Completo"));
        const ed = el("button", "link-btn", "Editar");
        ed.type = "button";
        ed.onclick = () => { etapa = id; desenhar(); scrollTopo(); };
        cab.append(ed);
        sec.append(cab);
        if (id === "documentos") {
          const ul = el("ul", "rev-docs");
          exigidos.filter(x => x.obrigatorio || arqs.some(y => y.categoria === x.id)).forEach(x => {
            const n = arqs.filter(y => y.categoria === x.id).length;
            ul.append(el("li", n ? "ok" : "falta", (n ? "✓ " : "✕ ") + x.nome + (n ? " (" + n + ")" : x.obrigatorio ? " — falta" : "")));
          });
          if (arqs.some(y => y.categoria === "foto")) ul.append(el("li", "ok", "✓ Foto 3x4"));
          sec.append(ul);
        } else {
          sec.append(dl(CAD_CAMPOS.filter(c => c[4] === id).map(c => [c[1], c[2] === "date" ? fmtData(v[c[0]]) : v[c[0]]])));
        }
        corpo.append(sec);
      });
      const bt = el("button", "btn", a.status === "CORRECAO_SOLICITADA" ? "Enviar correções ao RH" : "Enviar cadastro ao RH");
      bt.type = "button";
      bt.style.marginTop = "8px";
      bt.onclick = async () => {
        msgBox.innerHTML = "";
        clearTimeout(timer);
        await salvando;
        bt.disabled = true; bt.textContent = "Enviando…";
        loading(true, "Enviando cadastro");
        const res = await api("cadastro", { admissao_id: a.id, dados: v });
        loading(false);
        bt.disabled = false; bt.textContent = a.status === "CORRECAO_SOLICITADA" ? "Enviar correções ao RH" : "Enviar cadastro ao RH";
        if (res.sessaoExpirada) { logado = false; return abrirLogin("info", "Sua sessão expirou. Entre novamente (seu rascunho está salvo)."); }
        if (!res.ok) {
          const campos = res.campos || [];
          if (campos.length) { etapa = etapaDoCampo(campos[0]); desenhar(); return marcarErros(corpo, msgBox, campos, res.erro || "Confira os itens marcados."); }
          return msgBox.append(caixa("err", null, res.erro || "Não foi possível enviar."));
        }
        areaDados = null;
        await carregarArea();
        setMsg("areaMsg", "ok", "Cadastro enviado", "O RH vai conferir seus dados e documentos. Você recebe um e-mail com a decisão.");
        window.scrollTo(0, 0);
      };
      corpo.append(bt);
    }

    desenhar();
    estado.textContent = Object.keys(a.cadastro || {}).length ? "Seu rascunho está salvo: continue de onde parou." : "";
    return caixaW;
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
