/************************************************************
 * STAFF.GS — API do painel interno (RH) — planilha Mãe
 *
 * Chamado pelo Cloudflare Worker (vagas.innomaker.com.br/painel)
 * através do doPost do Code.gs, com action começando por "staff_".
 *
 * Segurança: o Worker confere o login no Authelia e o papel (RH)
 * antes de chamar. Aqui conferimos a chave compartilhada:
 * Configurações do projeto → Propriedades do script → STAFF_API_KEY
 * (o mesmo valor do secret STAFF_API_KEY do Worker).
 ************************************************************/

const STATUS_VAGA_PERMITIDOS = ["Aberta", "Pausada", "Fechada"];

function apiStaff_(req) {
  const chave = PropertiesService.getScriptProperties().getProperty("STAFF_API_KEY");
  if (!chave || String(req.key || "") !== chave) {
    return { ok: false, status: 403, erro: "Acesso negado: chave do painel inválida (STAFF_API_KEY)." };
  }
  const ator = req.ator || {};

  try {
    switch (req.action) {
      case "staff_vagas":
        return { ok: true, statusOpcoes: STATUS_VAGA_PERMITIDOS, vagas: staffListarVagas_() };
      case "staff_vaga_atualizar":
        return staffAtualizarVaga_(req, ator);
      case "staff_candidatos":
        return staffCandidatos_(String(req.vaga_id || "").trim());
      default:
        return { ok: false, erro: "Ação desconhecida." };
    }
  } catch (err) {
    Logger.log("apiStaff_: " + (err.stack || err));
    return { ok: false, erro: "Erro no Apps Script (planilha Mãe): " + err.message };
  }
}

// ---------- Vagas ----------
function staffContarInscritos_() {
  const contagem = {};
  const sh = SpreadsheetApp.openById(MAE_SPREADSHEET_ID).getSheetByName(SHEET_INDICE);
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 3, sh.getLastRow() - 1, 1).getDisplayValues().forEach(r => {
      const k = String(r[0]).trim();
      if (k) contagem[k] = (contagem[k] || 0) + 1;
    });
  }
  return contagem;
}

function staffListarVagas_() {
  const contagem = staffContarInscritos_();
  return getVagasTodas_(true).map(v => staffVagaPublica_(v, contagem[v.vaga_id] || 0)).reverse();
}

function staffVagaPublica_(v, inscritos) {
  return {
    vaga_id: v.vaga_id,
    titulo: v.titulo_vaga,
    status: v.status_vaga,
    prazo: v.data_limite_inscricao,
    prazo_iso: v.data_limite_ts ? Utilities.formatDate(new Date(v.data_limite_ts), Session.getScriptTimeZone(), "yyyy-MM-dd") : "",
    localidade: v.localidade,
    tipo_contratacao: v.tipo_contratacao,
    inscritos: inscritos || 0,
    aberta_site: vagaAberta_(v),
    link_publico: buildPublicVagaLink_(v.vaga_id),
    planilha_url: staffUrlPlanilha_(v.planilha_vaga_id),
    pasta_url: staffUrlPasta_(v.pasta_vaga_id)
  };
}

function staffUrlPlanilha_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return /^https?:\/\//.test(s) ? s : "https://docs.google.com/spreadsheets/d/" + s + "/edit";
}

function staffUrlPasta_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return /^https?:\/\//.test(s) ? s : "https://drive.google.com/drive/folders/" + s;
}

function staffAtualizarVaga_(req, ator) {
  const vagaId = String(req.vaga_id || "").trim();
  if (!vagaId) return { ok: false, erro: "Informe a vaga." };

  const mudancas = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.openById(MAE_SPREADSHEET_ID).getSheetByName(SHEET_VAGAS);
    const data = sh.getDataRange().getValues();
    const idx = indexMap_(data[0].map(h => String(h).trim()));

    let row = 0;
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][idx.vaga_id] || "").trim() === vagaId) { row = r + 1; break; }
    }
    if (!row) return { ok: false, erro: "Vaga " + vagaId + " não encontrada na aba VAGAS." };

    if (req.status_vaga != null && String(req.status_vaga).trim() !== "") {
      const st = String(req.status_vaga).trim();
      if (STATUS_VAGA_PERMITIDOS.indexOf(st) < 0) return { ok: false, erro: "Status inválido: " + st };
      const atual = String(data[row - 1][idx.status_vaga] || "").trim();
      if (st !== atual) {
        sh.getRange(row, idx.status_vaga + 1).setValue(st);
        mudancas.push("status: " + (atual || "(vazio)") + " → " + st);
      }
    }

    if (req.data_limite_inscricao != null) {
      const s = String(req.data_limite_inscricao).trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (s && !m) return { ok: false, erro: "Data inválida." };
      const atualD = toDateSafe_(data[row - 1][idx.data_limite_inscricao]);
      const atualIso = atualD ? Utilities.formatDate(atualD, Session.getScriptTimeZone(), "yyyy-MM-dd") : "";
      if (s !== atualIso) {
        sh.getRange(row, idx.data_limite_inscricao + 1).setValue(m ? new Date(+m[1], +m[2] - 1, +m[3]) : "");
        mudancas.push("prazo: " + (atualIso || "(vazio)") + " → " + (s || "(vazio)"));
      }
    }

    if (mudancas.length) {
      SpreadsheetApp.flush();
      limparCacheVagas_();
      staffLog_("PAINEL_ATUALIZAR_VAGA", vagaId, ator, mudancas.join("; "));
    }
  } finally {
    lock.releaseLock();
  }

  const v = getVacancyById_(vagaId, true);
  return { ok: true, mudancas, vaga: staffVagaPublica_(v, staffContarInscritos_()[vagaId] || 0) };
}

// ---------- Candidatos de uma vaga (somente leitura) ----------
function staffCandidatos_(vagaId) {
  const v = getVacancyById_(vagaId, true);
  if (!v) return { ok: false, erro: "Vaga não encontrada." };
  if (!v.planilha_vaga_id) return { ok: true, candidatos: [] };

  const ssV = SpreadsheetApp.openById(sheetIdFromAny_(v.planilha_vaga_id));
  const shC = ssV.getSheetByName("CANDIDATOS");
  const shE = ssV.getSheetByName("ETAPAS");
  if (!shC || shC.getLastRow() < 2) return { ok: true, candidatos: [] };

  const etapasPorCand = {};
  if (shE && shE.getLastRow() >= 2) {
    const eVals = shE.getDataRange().getValues();
    const ei = indexMap_(eVals[0].map(h => String(h || "").trim()));
    for (let r = 1; r < eVals.length; r++) {
      const id = String(eVals[r][ei.cand_id] || "").trim().toUpperCase();
      if (!id) continue;
      (etapasPorCand[id] = etapasPorCand[id] || []).push({
        ordem: Number(eVals[r][ei.ordem]) || 0,
        nome: String(eVals[r][ei.etapa_nome] || "").trim(),
        resultado: String(eVals[r][ei.resultado] || "Pendente").trim(),
        data_prevista: formatarDataPublica_(eVals[r][ei.data_prevista]),
        data_realizada: formatarDataPublica_(eVals[r][ei.data_realizada])
      });
    }
  }

  const cVals = shC.getDataRange().getValues();
  const ci = indexMap_(cVals[0].map(h => String(h || "").trim()));
  const col = (r, k) => ci[k] !== undefined ? String(cVals[r][ci[k]] == null ? "" : cVals[r][ci[k]]).trim() : "";

  const candidatos = [];
  for (let r = 1; r < cVals.length; r++) {
    const id = col(r, "cand_id");
    if (!id) continue;
    const etapas = (etapasPorCand[id.toUpperCase()] || []).sort((a, b) => a.ordem - b.ordem);
    const est = calcularEstadoPublicoEtapas_(etapas);
    candidatos.push({
      cand_id: id,
      nome: col(r, "nome"),
      email: col(r, "email"),
      telefone: col(r, "telefone"),
      periodo_curso: col(r, "periodo_curso"),
      previsao_formatura: col(r, "previsao_formatura"),
      curriculo_link: col(r, "curriculo_link"),
      data_inscricao: ci.data_inscricao !== undefined ? formatarDataPublica_(cVals[r][ci.data_inscricao]) : "",
      status: col(r, "status"),
      etapa_atual: est.etapaAtual,
      status_publico: est.status
    });
  }
  return { ok: true, candidatos: candidatos.reverse() };
}

function staffLog_(acao, vagaId, ator, obs) {
  try {
    const ss = SpreadsheetApp.openById(MAE_SPREADSHEET_ID);
    const sh = ss.getSheetByName("LOG") || ss.insertSheet("LOG");
    if (sh.getLastRow() === 0) sh.appendRow(LOG_HEADERS);
    sh.appendRow([new Date(), acao, vagaId, (ator && (ator.email || ator.login)) || "", obs || ""]);
  } catch (e) {
    Logger.log("staffLog_: " + e);
  }
}
