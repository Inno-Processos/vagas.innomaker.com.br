/************************************************************
 * API.GS — Painel interno → Solicitações de Contratação
 *
 * Chamado pelo Cloudflare Worker (vagas.innomaker.com.br/painel).
 * O Worker já confere o login no Authelia e o papel (gerente/RH).
 * Aqui conferimos a chave compartilhada:
 *   Configurações do projeto → Propriedades do script → STAFF_API_KEY
 *
 * Ações:
 *   opcoes    (gerente, RH) listas para o formulário
 *   solicitar (gerente, RH) cria a solicitação e envia para aprovação
 *   minhas    (gerente, RH) solicitações feitas com o e-mail do usuário
 *   listar    (RH)          todas as solicitações
 *   decidir   (RH)          aprovar ou pedir reajustes
 ************************************************************/

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) ? e.postData.contents : "{}");
  } catch (err) {
    return solResp_({ ok: false, erro: "Requisição inválida." });
  }

  const chave = PropertiesService.getScriptProperties().getProperty("STAFF_API_KEY");
  if (!chave || String(req.key || "") !== chave) {
    return solResp_({ ok: false, status: 403, erro: "Acesso negado: chave do painel inválida (STAFF_API_KEY)." });
  }

  const ator = req.ator || {};
  try {
    switch (req.action) {
      case "opcoes": return solResp_(solOpcoes_());
      case "solicitar": return solResp_(solCriar_(req.dados || {}, ator));
      case "minhas": return solResp_(solListar_(String(ator.email || "").trim().toLowerCase() || "__sem_email__"));
      case "listar": return solResp_(solListar_(null));
      case "decidir": return solResp_(solDecidir_(req, ator));
      default: return solResp_({ ok: false, erro: "Ação desconhecida." });
    }
  } catch (err) {
    Logger.log("Api doPost: " + (err.stack || err));
    return solResp_({ ok: false, erro: "Erro no Apps Script (solicitações): " + err.message });
  }
}

function solResp_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// chave do campo (CAMPOS_* do Codigo.gs) → índice da coluna na aba de respostas
function solMapaColunas_(headers) {
  const mapa = {};
  CAMPOS_SOLICITANTE.concat(CAMPOS_VAGA).forEach(([key, , aliases]) => {
    const alvos = aliases.map(normalizar_);
    for (let c = 0; c < Math.min(headers.length, ULTIMA_COL_FORM); c++) {
      if (alvos.indexOf(normalizar_(headers[c])) >= 0) { mapa[key] = c; break; }
    }
  });
  return mapa;
}

function solOpcoes_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_NOTIFICACOES);
  const deps = new Set();
  const shE = ss.getSheetByName(SHEET_EMAIL_ADM);
  if (shE && shE.getLastRow() >= 2) {
    shE.getRange(2, EMAIL_COL_DEPARTAMENTO, shE.getLastRow() - 1, 1).getDisplayValues()
      .forEach(r => { const d = String(r[0]).trim(); if (d) deps.add(d); });
  }

  const distintos = { localidade: new Set(), tipoContrato: new Set(), tipoContratacao: new Set(), cargaHoraria: new Set() };
  const sh = getSheetRespostas_();
  if (sh.getLastRow() >= 2) {
    const mapa = solMapaColunas_(sh.getRange(1, 1, 1, ULTIMA_COL_FORM).getDisplayValues()[0]);
    sh.getRange(2, 1, sh.getLastRow() - 1, ULTIMA_COL_FORM).getDisplayValues().forEach(r => {
      Object.keys(distintos).forEach(k => {
        if (mapa[k] == null) return;
        const v = String(r[mapa[k]] || "").trim();
        if (v && v.length <= 80) distintos[k].add(v);
      });
    });
  }

  const ord = s => Array.from(s).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    ok: true,
    departamentos: ord(deps),
    localidades: ord(distintos.localidade),
    tiposContrato: ord(distintos.tipoContrato),
    tiposContratacao: ord(distintos.tipoContratacao),
    cargasHorarias: ord(distintos.cargaHoraria)
  };
}

function solCriar_(d, ator) {
  const t = k => String(d[k] == null ? "" : d[k]).trim();
  const obrig = {
    departamento: "Departamento", tituloCargo: "Título do cargo", quantidadeVagas: "Quantidade de vagas",
    dataLimite: "Data limite de inscrição", localidade: "Localidade", tipoContrato: "Tipo de contrato",
    tipoContratacao: "Tipo de contratação", cargaHoraria: "Carga horária", remuneracao: "Remuneração / Bolsa",
    descricao: "Descrição", habilidadesObrigatorias: "Habilidades obrigatórias", principaisFuncoes: "Principais funções",
    motivoSolicitacao: "Motivo da solicitação", gestorResponsavel: "Gestor responsável"
  };
  const faltando = Object.keys(obrig).filter(k => !t(k)).map(k => obrig[k]);
  if (faltando.length) return { ok: false, erro: "Preencha: " + faltando.join(", ") + "." };
  if (d.concordancia !== true) return { ok: false, erro: "Confirme a declaração de concordância." };

  const email = String(ator.email || "").trim().toLowerCase();
  if (!emailValido_(email)) return { ok: false, erro: "Sua conta no Authelia não tem e-mail cadastrado. Peça ao RH para incluir, pois as respostas chegam por e-mail." };

  const m = t("dataLimite").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { ok: false, erro: "Data limite inválida." };
  const dataLimite = new Date(+m[1], +m[2] - 1, +m[3]);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (dataLimite < hoje) return { ok: false, erro: "A data limite de inscrição já passou." };

  const qtd = parseInt(t("quantidadeVagas"), 10);
  if (!(qtd >= 1)) return { ok: false, erro: "Quantidade de vagas inválida." };

  let habilidades = "Obrigatórias:\n" + t("habilidadesObrigatorias");
  if (t("habilidadesDiferenciais")) habilidades += "\n\nDiferenciais:\n" + t("habilidadesDiferenciais");

  const obs = [
    t("urgencia") ? "Urgência: " + t("urgencia") : "",
    t("observacoes"),
    "Enviada pelo painel interno por " + (ator.login || email) + "."
  ].filter(Boolean).join("\n");

  const valores = {
    ts: new Date(),
    requesterEmail: email,
    nome: ator.nome || ator.login || email,
    concordancia: "Sim — declaro que as informações são verdadeiras (painel interno)",
    departamento: t("departamento"),
    quantidadeVagas: qtd,
    tituloCargo: t("tituloCargo"),
    dataLimite,
    localidade: t("localidade"),
    tipoContrato: t("tipoContrato"),
    cargaHoraria: t("cargaHoraria"),
    remuneracao: t("remuneracao"),
    descricao: t("descricao"),
    habilidades,
    principaisFuncoes: t("principaisFuncoes"),
    tipoContratacao: t("tipoContratacao"),
    gestorResponsavel: t("gestorResponsavel"),
    motivoSolicitacao: t("motivoSolicitacao"),
    competencias: t("competencias"),
    observacoes: obs
  };

  const solicId = generateSolicitacaoId_(); // usa a própria trava
  const sh = getSheetRespostas_();
  let row;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    garantirColunasControle_(sh);
    const mapa = solMapaColunas_(sh.getRange(1, 1, 1, ULTIMA_COL_FORM).getDisplayValues()[0]);
    const linha = new Array(ULTIMA_COL_FORM).fill("");
    Object.keys(valores).forEach(k => { if (mapa[k] != null) linha[mapa[k]] = valores[k]; });
    row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, ULTIMA_COL_FORM).setValues([linha]);
    sh.getRange(row, COL_SOLIC_ID).setValue(solicId);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  try {
    const r = enviarParaAprovacao_(sh, row, "EMAIL ENVIADO (PAINEL)");
    return { ok: true, id: solicId, enviadoPara: r.para };
  } catch (err) {
    Logger.log("solCriar_ e-mail: " + err);
    return {
      ok: true, id: solicId,
      aviso: "A solicitação foi registrada, mas o e-mail de aprovação não saiu (" + err.message + "). O RH pode reenviar pelo menu da planilha."
    };
  }
}

// emailFiltro = null → todas (RH). Caso contrário, só as do e-mail informado.
function solListar_(emailFiltro) {
  const sh = getSheetRespostas_();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, itens: [] };

  garantirColunasControle_(sh);
  const mapa = solMapaColunas_(sh.getRange(1, 1, 1, ULTIMA_COL_FORM).getDisplayValues()[0]);
  const vals = sh.getRange(2, 1, last - 1, ULTIMA_COL_CONTROLE).getDisplayValues();
  const url = getWebAppUrl_();
  const base = url ? url + (url.indexOf("?") >= 0 ? "&" : "?") : "";
  const ehRH = !emailFiltro;

  const itens = [];
  vals.forEach((r, i) => {
    const col = n => String(r[n - 1] || "").trim();
    const dados = {};
    CAMPOS_SOLICITANTE.concat(CAMPOS_VAGA).forEach(([k]) => { dados[k] = mapa[k] != null ? String(r[mapa[k]] || "").trim() : ""; });
    const id = col(COL_SOLIC_ID);
    if (!id && !dados.tituloCargo) return;
    if (!ehRH && String(dados.requesterEmail).toLowerCase() !== emailFiltro) return;

    const status = col(COL_APROV_STATUS).toUpperCase();
    const vagaCriada = col(COL_VAGA);
    const token = col(COL_TOKEN);
    const item = {
      id, status, vagaCriada, dados,
      decididoPor: col(COL_DECISAO_POR),
      dataDecisao: col(COL_DECISAO_DATA),
      comentarios: col(COL_COMENTARIO)
    };
    if (ehRH) {
      item.enviadoPara = col(COL_DESTINATARIOS);
      item.planilhaUrl = LINK_PLANILHA_SOLICITACOES;
      if (status === STATUS.APROVADO && !vagaCriada && FORM_ID_VAGAS && base && token && id) {
        item.linkVaga = base + "acao=vaga&id=" + encodeURIComponent(id) + "&token=" + token;
      }
    }
    itens.push(item);
  });

  return { ok: true, itens: itens.reverse() };
}

function solDecidir_(req, ator) {
  const id = String(req.id || "").trim();
  const decisao = String(req.decisao || "");
  const comentario = String(req.comentario || "").trim().slice(0, 3000);
  if (["aprovar", "reajuste"].indexOf(decisao) < 0) return { ok: false, erro: "Decisão inválida." };
  if (decisao === "reajuste" && comentario.length < 5) return { ok: false, erro: "Descreva os reajustes necessários." };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, erro: "O sistema está ocupado. Tente novamente em alguns segundos." };
  try {
    const sh = getSheetRespostas_();
    const row = encontrarLinhaPorId_(sh, id);
    if (!row) return { ok: false, erro: "Solicitação " + id + " não encontrada." };

    const d = montarDados_(sh, row);
    if (d.statusAprovacao === STATUS.APROVADO) return { ok: false, erro: "Esta solicitação já foi aprovada." };

    const quem = (ator.nome || ator.login || "RH") + (ator.email ? " <" + ator.email + ">" : "") + " (painel)";
    const res = registrarDecisao_(sh, row, d, decisao, comentario, quem);

    if (res.ok && decisao === "aprovar" && FORM_ID_VAGAS) {
      let token = d.token;
      if (!token) {
        token = Utilities.getUuid().replace(/-/g, "");
        sh.getRange(row, COL_TOKEN).setValue(token);
      }
      const url = getWebAppUrl_();
      if (url) res.linkVaga = url + (url.indexOf("?") >= 0 ? "&" : "?") + "acao=vaga&id=" + encodeURIComponent(d.solicId) + "&token=" + token;
    }
    return res;
  } finally {
    lock.releaseLock();
  }
}
