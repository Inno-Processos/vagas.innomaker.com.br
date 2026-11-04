/************************************************************
 * CODE.GS — WEB APP INNOMAKER (PLANILHA MÃE)
 *
 * O site (HTML) é servido pelo Cloudflare Worker em vagas.innomaker.com.br.
 * Este projeto é a API: lista vagas, recebe inscrições e consultas.
 * - As vagas ficam em cache (CacheService), então a planilha não é lida
 *   a cada acesso.
 * - O fechamento por data não grava mais na planilha a cada visita:
 *   vaga vencida já sai da lista na hora; o gatilho diário grava "Fechada".
 * - Acompanhamento usa um índice (INDICE_CANDIDATOS) em vez de abrir
 *   a planilha de todas as vagas.
 ************************************************************/

// ====== CONFIGURAÇÃO ======
const MAE_SPREADSHEET_ID = "1chGwwKOYtonvj7-cXLckJiKtvOco2K5l_MkKt04AmOw";
const SHEET_VAGAS = "VAGAS";
const SHEET_INDICE = "INDICE_CANDIDATOS";

// ====== ÁREA DO CANDIDATO (login) ======
// Aba com uma linha por candidato (e-mail). A senha NÃO fica visível:
// guardamos só um código (hash) dela. Não reordene as colunas desta aba.
const SHEET_LOGINS = "LOGINS";
const LOGINS_HEADERS = [
  "email", "nome", "telefone", "senha_hash", "salt", "criado_em",
  "ultimo_login", "tentativas_falhas", "bloqueado_ate", "versao_sessao", "senha_enviada_em"
];
const SESSAO_DIAS = 7;          // tempo que o candidato fica logado
const MAX_TENTATIVAS = 5;       // senhas erradas seguidas antes de bloquear
const BLOQUEIO_MIN = 15;        // minutos de bloqueio
const INTERVALO_NOVA_SENHA_SEG = 120; // "Esqueci minha senha": no máximo 1 envio a cada 2 min

const DEFAULT_UPLOAD_ROOT_FOLDER_ID = ""; // opcional
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const ROOT_FOLDER_ID = "1pHL_syzK91WsoNTyhSrPoIuaha3u4DVu";
const TEMPLATE_SHEET_ID = "1jeJYWDqxnDBn9aF2Kym-6mxUbKjHPOQwCr9x1qYfu8o";

// Endereço público do site (Cloudflare Worker). Usado nos e-mails e links das vagas.
const SITE_URL = "https://vagas.innomaker.com.br";

const VAGAS_REQUIRED_COLS = [
  "vaga_id", "titulo_vaga", "status_vaga", "data_limite_inscricao",
  "localidade", "tipo_vaga", "tipo_contratacao",
  "carga_horaria", "remuneracao_bolsa",
  "descricao_geral", "requisitos", "principais_funcoes",
  "planilha_vaga_id", "pasta_vaga_id", "etapas_json"
];
const LOG_HEADERS = ["timestamp", "acao", "vaga_id", "usuario", "obs"];
const CONFIG_HEADERS = ["chave", "valor"];

// Cache das vagas (segundos). Edições na aba VAGAS limpam o cache na hora
// (gatilho aoEditarMae); o tempo abaixo é só a rede de segurança.
const CACHE_KEY_VAGAS = "vagas_todas_v2";
const CACHE_TTL_SEG = 600;


// =================================================================
//  WEB APP
// =================================================================
// O site fica no Cloudflare (vagas.innomaker.com.br). Aqui o Apps Script
// funciona só como API: o Worker busca as vagas e envia inscrições/consultas.
//
// GET  ?api=vagas            → { ok, vagas }
// POST { action:"inscrever" } → { ok, cand_id, tracking_url } | { ok:false, erro }
// POST { action:"acompanhar"} → { ok, dados } | { ok:false, erro }
// POST { action:"login" }       → { ok, sessao, conta, candidaturas }
// POST { action:"minhas" }      → { ok, conta, candidaturas }   (usa a sessão)
// POST { action:"esqueci" }     → { ok, mensagem }              (envia nova senha)
// POST { action:"trocar_senha"} → { ok, sessao, mensagem }
function doGet(e) {
  const p = (e && e.parameter) || {};

  if (p.api === "vagas") {
    try {
      return resposta_({ ok: true, vagas: listOpenVacancies_() });
    } catch (err) {
      Logger.log("api vagas: " + (err.stack || err));
      return resposta_({ ok: false, erro: "Não foi possível carregar as vagas." });
    }
  }

  // Quem abrir o link antigo do script.google.com vai para o site no domínio
  const q = Object.keys(p).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(p[k])).join("&");
  const destino = SITE_URL + (q ? "?" + q : "");
  return HtmlService.createHtmlOutput(
    `<script>window.top.location.href=${JSON.stringify(destino)};</script>` +
    `<p style="font-family:Arial">Abrindo <a href="${escapeHtml_(destino)}" target="_top">${escapeHtml_(SITE_URL)}</a>…</p>`
  ).setTitle("Carreiras — Innomaker");
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) ? e.postData.contents : "{}");
  } catch (err) {
    return resposta_({ ok: false, erro: "Requisição inválida." });
  }

  const acao = String(req.action || "inscrever");

  // Ações do painel interno (RH) — ver Staff.gs
  if (acao.indexOf("staff_") === 0) return resposta_(apiStaff_(req));

  try {
    if (acao === "inscrever") return resposta_(submitApplication_(req));
    if (acao === "acompanhar") return resposta_(carregarAcompanhamento(req));
    if (acao === "login") return resposta_(apiLogin_(req));
    if (acao === "minhas") return resposta_(apiMinhas_(req));
    if (acao === "esqueci") return resposta_(apiEsqueci_(req));
    if (acao === "trocar_senha") return resposta_(apiTrocarSenha_(req));
    return resposta_({ ok: false, erro: "Ação inválida." });
  } catch (err) {
    return resposta_({ ok: false, erro: String(err && err.message ? err.message : err) });
  }
}

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


// =================================================================
//  VAGAS (com cache)
// =================================================================
function getVagasTodas_(fresh) {
  if (!fresh) {
    const cached = cacheGetJson_(CACHE_KEY_VAGAS);
    if (cached) return cached;
  }

  const sh = SpreadsheetApp.openById(MAE_SPREADSHEET_ID).getSheetByName(SHEET_VAGAS);
  if (!sh) throw new Error("Aba VAGAS não encontrada na planilha Mãe.");

  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    cachePutJson_(CACHE_KEY_VAGAS, [], CACHE_TTL_SEG);
    return [];
  }

  const idx = indexMap_(data[0].map(h => String(h).trim()));
  for (const col of VAGAS_REQUIRED_COLS) {
    if (idx[col] === undefined) throw new Error(`Coluna obrigatória ausente em VAGAS: ${col}`);
  }

  const vagas = [];
  for (let r = 1; r < data.length; r++) {
    const v = rowToVacancy_(data[r], idx);
    if (v.vaga_id) vagas.push(v);
  }

  cachePutJson_(CACHE_KEY_VAGAS, vagas, CACHE_TTL_SEG);
  return vagas;
}

function rowToVacancy_(row, idx) {
  const s = k => String(row[idx[k]] == null ? "" : row[idx[k]]).trim();
  const limite = toDateSafe_(row[idx.data_limite_inscricao]);
  if (limite) limite.setHours(0, 0, 0, 0);

  return {
    vaga_id: s("vaga_id"),
    titulo_vaga: s("titulo_vaga"),
    status_vaga: s("status_vaga"),
    data_limite_inscricao: formatarDataPublica_(row[idx.data_limite_inscricao]),
    data_limite_ts: limite ? limite.getTime() : 0,
    localidade: s("localidade"),
    tipo_vaga: s("tipo_vaga"),
    tipo_contratacao: s("tipo_contratacao"),
    carga_horaria: s("carga_horaria"),
    remuneracao_bolsa: s("remuneracao_bolsa"),
    descricao_geral: s("descricao_geral"),
    requisitos: s("requisitos"),
    principais_funcoes: s("principais_funcoes"),
    planilha_vaga_id: s("planilha_vaga_id"),
    pasta_vaga_id: s("pasta_vaga_id"),
    etapas_json: s("etapas_json")
  };
}

// Aberta = status "Aberta" e prazo não vencido (sem depender do gatilho diário)
function vagaAberta_(v) {
  if (!v || String(v.status_vaga).trim() !== "Aberta") return false;
  if (!v.data_limite_ts) return true;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return hoje.getTime() <= v.data_limite_ts;
}

// Versão pública: sem IDs de planilha/pasta/etapas, com token do link
function listOpenVacancies_() {
  return getVagasTodas_(false)
    .filter(vagaAberta_)
    .sort((a, b) => (a.data_limite_ts || 9e15) - (b.data_limite_ts || 9e15))
    .map(v => ({
      vaga_id: v.vaga_id,
      titulo_vaga: v.titulo_vaga,
      data_limite_inscricao: v.data_limite_inscricao,
      localidade: v.localidade,
      tipo_vaga: v.tipo_vaga,
      tipo_contratacao: v.tipo_contratacao,
      carga_horaria: v.carga_horaria,
      remuneracao_bolsa: v.remuneracao_bolsa,
      descricao_geral: v.descricao_geral,
      requisitos: v.requisitos,
      principais_funcoes: v.principais_funcoes,
      t: generateToken_(v.vaga_id)
    }));
}

function getVacancyById_(vagaId, fresh) {
  const id = String(vagaId || "").trim();
  return getVagasTodas_(!!fresh).find(v => v.vaga_id === id) || null;
}

// Gatilho diário (02h): grava "Fechada" nas vagas vencidas
function atualizarStatusVagasPorData() {
  const sh = SpreadsheetApp.openById(MAE_SPREADSHEET_ID).getSheetByName(SHEET_VAGAS);
  if (!sh) return;

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0].map(h => String(h).trim());
  const idxStatus = headers.indexOf("status_vaga");
  const idxData = headers.indexOf("data_limite_inscricao");
  if (idxStatus < 0 || idxData < 0) return;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  let alteradas = 0;

  for (let r = 1; r < data.length; r++) {
    const dt = toDateSafe_(data[r][idxData]);
    if (!dt) continue;
    dt.setHours(0, 0, 0, 0);
    if (hoje > dt && String(data[r][idxStatus] || "").trim() !== "Fechada") {
      sh.getRange(r + 1, idxStatus + 1).setValue("Fechada");
      alteradas++;
    }
  }

  if (alteradas) {
    SpreadsheetApp.flush();
    limparCacheVagas_();
  }
}


// =================================================================
//  CACHE
// =================================================================
function cachePutJson_(key, obj, ttl) {
  try {
    const cache = CacheService.getScriptCache();
    const s = JSON.stringify(obj);
    const tam = 40000; // folga para acentos (limite do cache: 100 KB por chave)
    const n = Math.max(1, Math.ceil(s.length / tam));
    const mapa = {};
    for (let i = 0; i < n; i++) mapa[`${key}_${i}`] = s.slice(i * tam, (i + 1) * tam);
    mapa[`${key}_n`] = String(n);
    cache.putAll(mapa, ttl);
  } catch (e) {
    Logger.log("cachePutJson_: " + e);
  }
}

function cacheGetJson_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(`${key}_n`) || "0", 10);
    if (!n) return null;
    const chaves = [];
    for (let i = 0; i < n; i++) chaves.push(`${key}_${i}`);
    const partes = cache.getAll(chaves);
    let s = "";
    for (const k of chaves) {
      if (partes[k] == null) return null;
      s += partes[k];
    }
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function limparCacheVagas_() {
  try { CacheService.getScriptCache().remove(`${CACHE_KEY_VAGAS}_n`); } catch (e) {}
}

// Gatilho instalável "Ao editar": qualquer mudança na aba VAGAS aparece no site na hora
function aoEditarMae(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === SHEET_VAGAS) limparCacheVagas_();
  } catch (err) {}
}

function menuLimparCache() {
  limparCacheVagas_();
  SpreadsheetApp.getActive().toast("O site já mostra os dados atuais da aba VAGAS.", "Cache limpo ✅", 6);
}


// =================================================================
//  INSCRIÇÃO
// =================================================================
function submitApplication_(payload) {
  const vagaId = String(payload.vaga_id || "").trim();
  const token = String(payload.t || "").trim();
  if (!validateToken_(vagaId, token)) throw new Error("Link da vaga inválido. Abra a vaga pela página de vagas.");

  const vaga = getVacancyById_(vagaId, true);
  if (!vaga || !vagaAberta_(vaga)) throw new Error("As inscrições para esta vaga estão encerradas.");

  const nome = String(payload.nome || "").trim();
  const email = String(payload.email || "").trim();
  const telefone = String(payload.telefone || "").trim();
  if (!nome || !email || !telefone) throw new Error("Preencha nome, e-mail e telefone.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
  if (!payload.pdfBase64) throw new Error("Envie o currículo em PDF.");

  const blob = base64ToBlob_(payload.pdfBase64, "application/pdf", sanitizeFileName_(payload.pdfName || "curriculo.pdf"));
  if (blob.getBytes().length > MAX_PDF_BYTES) throw new Error("O PDF passa de 10 MB.");

  // Upload fora do lock (é a parte mais lenta)
  const folder = getUploadFolderForVacancy_(vaga);
  const file = folder.createFile(blob.setName(`${vagaId}_${sanitizeFileName_(nome)}_${Date.now()}.pdf`));

  let cand;
  let acesso = { nova: false, senha: "" };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    try {
      cand = createCandidateInVacancySheet_(vaga, {
        nome,
        email,
        telefone,
        periodo_curso: payload.periodo_curso || "",
        previsao_formatura: payload.previsao_formatura || "",
        curriculo_link: file.getUrl(),
        score: payload.score || "",
        obs_geral: payload.obs_geral || ""
      });
    } catch (err) {
      try { file.setTrashed(true); } catch (e) {}
      throw err;
    }
    // 1ª inscrição com este e-mail → cria o login e gera a senha
    try { acesso = garantirConta_(email.toLowerCase(), nome, telefone); } catch (e) { Logger.log("conta: " + e); }
  } finally {
    lock.releaseLock();
  }

  try { registrarIndiceCandidato_(cand); } catch (e) { Logger.log("índice: " + e); }
  try { limparCacheCandidaturas_(email); } catch (e) {}
  try { sendEmailConfirmacao_(vaga, cand, acesso); } catch (e) { Logger.log("e-mail: " + e); }

  return {
    ok: true,
    cand_id: cand.cand_id,
    vaga_id: vaga.vaga_id,
    tracking_url: cand.tracking_url,
    conta_nova: !!acesso.nova
  };
}

function createCandidateInVacancySheet_(vaga, input) {
  const ssV = SpreadsheetApp.openById(sheetIdFromAny_(vaga.planilha_vaga_id));
  ensureVacancyTemplateStructure_(ssV);

  setConfigsInVacancy_(ssV, {
    vaga_id: vaga.vaga_id || "",
    titulo_vaga: vaga.titulo_vaga || "",
    tipo_contratacao: vaga.tipo_contratacao || "",
    etapas_json: vaga.etapas_json || ""
  });

  const shC = ssV.getSheetByName("CANDIDATOS");
  const shE = ssV.getSheetByName("ETAPAS");
  const shL = ssV.getSheetByName("LOG");

  const email = String(input.email || "").trim();
  if (existsCandidateEmailTemplate_(shC, email)) {
    logVacancy_(shL, "DUPLICADO_BLOQUEADO", vaga.vaga_id, "", "", "", "", `Inscrição duplicada: ${email}`);
    throw new Error("Já existe uma inscrição com este e-mail para esta vaga.");
  }

  const etapas = parseEtapasJsonToArray_(vaga.etapas_json);
  if (!etapas.length) throw new Error("Esta vaga está sem etapas configuradas. Avise o RH.");

  const candId = nextCandIdInVacancy_(ssV);
  const nomeCandidato = String(input.nome || "").trim();

  shC.appendRow([
    candId,
    nomeCandidato,
    email,
    String(input.telefone || "").trim(),
    String(input.periodo_curso || "").trim(),
    String(input.previsao_formatura || "").trim(),
    String(input.curriculo_link || "").trim(),
    new Date(),
    "Em processo",
    1,
    String(input.score || "").trim(),
    String(input.obs_geral || "").trim()
  ]);

  const rowsEtapas = etapas.map(et => ([
    candId, nomeCandidato, Number(et.ordem) || "", String(et.etapa_nome || "").trim(),
    "Pendente", "", "", "", "", "", "", ""
  ]));
  shE.getRange(shE.getLastRow() + 1, 1, rowsEtapas.length, rowsEtapas[0].length).setValues(rowsEtapas);

  logVacancy_(shL, "CRIAR_CANDIDATO_WEBAPP", vaga.vaga_id, candId, "", "Em processo", "", `Inscrição WebApp: ${email}`);

  return {
    cand_id: candId,
    email,
    nome: nomeCandidato,
    vaga_id: vaga.vaga_id,
    tracking_url: buildCandidateTrackingLink_(vaga.vaga_id, candId, email)
  };
}

function registrarIndiceCandidato_(cand) {
  const ss = SpreadsheetApp.openById(MAE_SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_INDICE) || ss.insertSheet(SHEET_INDICE);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["cand_id", "email", "vaga_id", "data"]);
    sh.getRange(1, 1, 1, 4).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  sh.appendRow([cand.cand_id, String(cand.email).trim().toLowerCase(), cand.vaga_id, new Date()]);
}

function sendEmailConfirmacao_(vaga, cand, acesso) {
  acesso = acesso || { nova: false, senha: "" };
  const nome = String(cand.nome || "").trim() || "Olá";
  const tituloVaga = String(vaga.titulo_vaga || "").trim() || "nossa vaga";
  const candId = String(cand.cand_id || "").trim();
  const trackingUrl = cand.tracking_url || buildCandidateTrackingLink_(vaga.vaga_id, candId, cand.email);

  const textBody =
    `${nome},\n\nRecebemos sua inscrição para a vaga: ${tituloVaga} (${vaga.vaga_id}).\n` +
    `Código da candidatura: ${candId}.\n\nAcompanhe sua candidatura:\n${trackingUrl}\n\n` +
    (acesso.nova
      ? `SEU ACESSO À ÁREA DO CANDIDATO\nE-mail: ${cand.email}\nSenha: ${acesso.senha}\nEntre em: ${getBaseUrl_()}?page=acompanhar\n\n`
      : `Para ver todas as suas candidaturas, entre em ${getBaseUrl_()}?page=acompanhar com seu e-mail e a senha que você já recebeu.\n\n`) +
    `Atenciosamente,\nEquipe Innomaker`;

  const htmlBody = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#efefed;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e5e5;">
      <div style="background:#41a639;padding:28px 20px;text-align:center;">
        <div style="font-weight:800;font-size:28px;letter-spacing:1px;color:#ffffff;">INNOMAKER</div>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 12px;font-size:16px;color:#000;">Olá, <strong>${escapeHtml_(nome)}</strong>!</p>
        <p style="margin:0 0 18px;font-size:14px;color:#333;line-height:1.6;">
          Recebemos sua inscrição para a vaga <strong>${escapeHtml_(tituloVaga)}</strong>.
        </p>
        <div style="padding:16px;background:#efefed;border-left:4px solid #41a639;border-radius:8px;margin-bottom:18px;">
          <div style="font-size:13px;color:#666;margin-bottom:5px;">Código da candidatura</div>
          <div style="font-size:16px;font-weight:800;color:#000;">${escapeHtml_(candId)}</div>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="${escapeHtml_(trackingUrl)}" target="_blank"
             style="display:inline-block;background:#41a639;color:#fff;text-decoration:none;font-weight:800;padding:14px 24px;border-radius:999px;">
            Acompanhar minha candidatura
          </a>
        </div>
        ${blocoAcessoEmail_(cand.email, acesso)}
        <p style="margin-top:22px;font-size:13px;color:#000;">Atenciosamente,<br><strong>Equipe Innomaker</strong></p>
      </div>
      <div style="padding:14px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#777;text-align:center;">
        Este é um e-mail automático. Se você não fez esta inscrição, desconsidere.
      </div>
    </div>
  </div>`;

  MailApp.sendEmail({ to: cand.email, subject: `Inscrição confirmada — ${tituloVaga}`, body: textBody, htmlBody });
}


// =================================================================
//  ACOMPANHAMENTO
// =================================================================
function carregarAcompanhamento(req) {
  req = req || {};
  const vagaId = String(req.vaga_id || "").trim();
  const candId = String(req.cand_id || "").trim();
  const token = String(req.t || "").trim();
  if (!vagaId || !candId || !token) return { ok: false, erro: "Link de acompanhamento incompleto." };

  try {
    const dados = getTrackingData_(vagaId, candId);
    if (!dados) return { ok: false, erro: "Candidatura não encontrada." };
    if (!validateCandidateTrackingToken_(vagaId, candId, dados.email, token)) {
      return { ok: false, erro: "Link de acompanhamento inválido. Consulte pelo código e e-mail." };
    }
    return { ok: true, dados: sanitizarTrackingPublico_(dados) };
  } catch (err) {
    Logger.log("carregarAcompanhamento: " + (err.stack || err));
    return { ok: false, erro: "Não foi possível carregar a candidatura agora. Tente novamente." };
  }
}

// =================================================================
//  ÁREA DO CANDIDATO — login, sessão e senhas
// =================================================================
const LC_ = {};
LOGINS_HEADERS.forEach((h, i) => { LC_[h] = i; });

function contasSheet_() {
  const ss = SpreadsheetApp.openById(MAE_SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_LOGINS);
  if (!sh) sh = ss.insertSheet(SHEET_LOGINS);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, LOGINS_HEADERS.length).setValues([LOGINS_HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function buscarConta_(email) {
  const sh = contasSheet_();
  const last = sh.getLastRow();
  if (last < 2 || !email) return { sh, row: 0, c: null };
  const vals = sh.getRange(2, 1, last - 1, LOGINS_HEADERS.length).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][LC_.email] || "").trim().toLowerCase() === email) {
      const c = {};
      LOGINS_HEADERS.forEach((h, j) => { c[h] = vals[i][j]; });
      return { sh, row: i + 2, c };
    }
  }
  return { sh, row: 0, c: null };
}

function salvarConta_(sh, row, c) {
  const linha = [LOGINS_HEADERS.map(h => (c[h] == null ? "" : c[h]))];
  if (row) sh.getRange(row, 1, 1, LOGINS_HEADERS.length).setValues(linha);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, LOGINS_HEADERS.length).setValues(linha);
}

function gerarSenha_() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // sem l, i, o, 0, 1 (evita confusão)
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Utilities.getUuid());
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[(bytes[i] + 256) % chars.length];
  return s;
}

function novoSalt_() {
  return "s" + Utilities.getUuid().replace(/-/g, "");
}

// Hash com "pimenta" (ATS_SECRET fica nas propriedades do script, fora da planilha)
function hashSenha_(senha, salt) {
  const bytes = Utilities.computeHmacSha256Signature(String(senha).trim() + "|" + salt, getSecret_() + "|senha");
  return "h" + bytes.map(b => ("0" + ((b + 256) % 256).toString(16)).slice(-2)).join("");
}

function dataMs_(v) {
  if (!v) return 0;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Chamada na inscrição (dentro do lock)
function garantirConta_(email, nome, telefone) {
  const a = buscarConta_(email);
  if (a.c) {
    let mudou = false;
    if (!a.c.nome && nome) { a.c.nome = nome; mudou = true; }
    if (!a.c.telefone && telefone) { a.c.telefone = telefone; mudou = true; }
    if (mudou) salvarConta_(a.sh, a.row, a.c);
    return { nova: false, senha: "" };
  }

  const senha = gerarSenha_();
  const salt = novoSalt_();
  const agora = new Date();
  salvarConta_(a.sh, 0, {
    email, nome, telefone,
    senha_hash: hashSenha_(senha, salt), salt,
    criado_em: agora, ultimo_login: "", tentativas_falhas: 0, bloqueado_ate: "",
    versao_sessao: 1, senha_enviada_em: agora
  });
  return { nova: true, senha };
}

// ---------- Sessão (fica salva no navegador do candidato) ----------
function criarSessao_(email, versao) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    e: email, v: Number(versao) || 1, x: Date.now() + SESSAO_DIAS * 86400000
  }));
  return payload + "." + assinarSessao_(payload);
}

function assinarSessao_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, getSecret_() + "|sessao")).replace(/=+$/, "");
}

function validarSessao_(token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 2 || assinarSessao_(partes[0]) !== partes[1]) return null;
  let o;
  try { o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString()); } catch (e) { return null; }
  if (!o || !o.e || Date.now() > Number(o.x)) return null;
  const a = buscarConta_(String(o.e));
  if (!a.c || (Number(a.c.versao_sessao) || 1) !== Number(o.v)) return null; // senha trocada → sessões antigas caem
  return a;
}

const SESSAO_EXPIRADA_ = { ok: false, sessaoExpirada: true, erro: "Sua sessão expirou. Entre novamente." };

// ---------- Ações da API ----------
function apiLogin_(req) {
  const email = String(req.email || "").trim().toLowerCase();
  const senha = String(req.senha || "").trim();
  if (!email || !senha) return { ok: false, erro: "Informe seu e-mail e sua senha." };

  const generico = "E-mail ou senha incorretos.";
  const a = buscarConta_(email);
  if (!a.c) return { ok: false, erro: generico };

  const agora = Date.now();
  const bloqueio = dataMs_(a.c.bloqueado_ate);
  if (bloqueio > agora) {
    return { ok: false, erro: `Muitas tentativas. Tente de novo em ${Math.ceil((bloqueio - agora) / 60000)} min ou use "Esqueci minha senha".` };
  }

  if (hashSenha_(senha, a.c.salt) !== String(a.c.senha_hash)) {
    const t = (Number(a.c.tentativas_falhas) || 0) + 1;
    if (t >= MAX_TENTATIVAS) {
      a.c.tentativas_falhas = 0;
      a.c.bloqueado_ate = new Date(agora + BLOQUEIO_MIN * 60000);
    } else {
      a.c.tentativas_falhas = t;
    }
    salvarConta_(a.sh, a.row, a.c);
    return { ok: false, erro: generico };
  }

  a.c.tentativas_falhas = 0;
  a.c.bloqueado_ate = "";
  a.c.ultimo_login = new Date();
  salvarConta_(a.sh, a.row, a.c);

  return {
    ok: true,
    sessao: criarSessao_(email, a.c.versao_sessao),
    conta: { nome: String(a.c.nome || ""), email },
    candidaturas: listarCandidaturasDoEmail_(email, true)
  };
}

function apiMinhas_(req) {
  const a = validarSessao_(req.sessao);
  if (!a) return SESSAO_EXPIRADA_;
  const email = String(a.c.email).trim().toLowerCase();
  return {
    ok: true,
    conta: { nome: String(a.c.nome || ""), email },
    candidaturas: listarCandidaturasDoEmail_(email, !!req.atualizar)
  };
}

function apiEsqueci_(req) {
  const email = String(req.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, erro: "Informe um e-mail válido." };

  // Mesma resposta exista ou não a conta (não revela quem está inscrito)
  const resp = { ok: true, mensagem: "Se este e-mail tiver inscrição conosco, a nova senha chega em alguns instantes. Confira também a caixa de spam." };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let a = buscarConta_(email);
    if (!a.c) {
      // Inscrição feita antes do sistema de login: cria o acesso agora
      if (!emailTemInscricao_(email)) return resp;
      salvarConta_(a.sh, 0, {
        email, nome: "", telefone: "", senha_hash: "", salt: "", criado_em: new Date(),
        ultimo_login: "", tentativas_falhas: 0, bloqueado_ate: "", versao_sessao: 1, senha_enviada_em: ""
      });
      a = buscarConta_(email);
    }
    if (Date.now() - dataMs_(a.c.senha_enviada_em) < INTERVALO_NOVA_SENHA_SEG * 1000) return resp;
    redefinirSenha_(a);
    return resp;
  } finally {
    lock.releaseLock();
  }
}

function apiTrocarSenha_(req) {
  const a = validarSessao_(req.sessao);
  if (!a) return SESSAO_EXPIRADA_;

  const atual = String(req.atual || "").trim();
  const nova = String(req.nova || "").trim();
  if (hashSenha_(atual, a.c.salt) !== String(a.c.senha_hash)) return { ok: false, erro: "A senha atual está incorreta." };
  if (nova.length < 6) return { ok: false, erro: "A nova senha precisa ter pelo menos 6 caracteres." };

  a.c.salt = novoSalt_();
  a.c.senha_hash = hashSenha_(nova, a.c.salt);
  a.c.versao_sessao = (Number(a.c.versao_sessao) || 1) + 1;
  salvarConta_(a.sh, a.row, a.c);

  return { ok: true, sessao: criarSessao_(String(a.c.email).trim().toLowerCase(), a.c.versao_sessao), mensagem: "Senha alterada." };
}

// Gera nova senha, invalida sessões antigas e envia por e-mail
function redefinirSenha_(a) {
  const senha = gerarSenha_();
  a.c.salt = novoSalt_();
  a.c.senha_hash = hashSenha_(senha, a.c.salt);
  a.c.versao_sessao = (Number(a.c.versao_sessao) || 1) + 1;
  a.c.tentativas_falhas = 0;
  a.c.bloqueado_ate = "";
  a.c.senha_enviada_em = new Date();
  salvarConta_(a.sh, a.row, a.c);
  enviarEmailSenha_(String(a.c.email).trim(), String(a.c.nome || ""), senha);
}

function emailTemInscricao_(email) {
  const sh = SpreadsheetApp.openById(MAE_SPREADSHEET_ID).getSheetByName(SHEET_INDICE);
  if (!sh || sh.getLastRow() < 2) return false;
  return sh.getRange(2, 2, sh.getLastRow() - 1, 1).getDisplayValues()
    .some(r => String(r[0]).trim().toLowerCase() === email);
}

// ---------- Candidaturas do candidato (todas as vagas) ----------
function chaveCacheCandidaturas_(email) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(email).trim().toLowerCase());
  return "cands_" + d.map(b => ("0" + ((b + 256) % 256).toString(16)).slice(-2)).join("");
}

function limparCacheCandidaturas_(email) {
  CacheService.getScriptCache().remove(chaveCacheCandidaturas_(email) + "_n");
}

function listarCandidaturasDoEmail_(email, fresh) {
  const chave = chaveCacheCandidaturas_(email);
  if (!fresh) {
    const c = cacheGetJson_(chave);
    if (c) return c;
  }

  const sh = SpreadsheetApp.openById(MAE_SPREADSHEET_ID).getSheetByName(SHEET_INDICE);
  const out = [];
  if (sh && sh.getLastRow() >= 2) {
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues();
    const vistos = new Set();
    vals.forEach(r => {
      if (String(r[1]).trim().toLowerCase() !== email) return;
      const candId = String(r[0]).trim();
      const vagaId = String(r[2]).trim();
      const k = vagaId + "|" + candId.toUpperCase();
      if (!candId || !vagaId || vistos.has(k)) return;
      vistos.add(k);
      try {
        const d = getTrackingData_(vagaId, candId);
        if (!d || String(d.email).trim().toLowerCase() !== email) return;
        const pub = sanitizarTrackingPublico_(d);
        const v = getVacancyById_(vagaId, false);
        pub.vaga_aberta = v ? vagaAberta_(v) : false;
        out.push(pub);
      } catch (e) {
        Logger.log(`candidatura ${vagaId}/${candId}: ${e}`);
      }
    });
  }

  const ms = s => { const d = toDateSafe_(s); return d ? d.getTime() : 0; };
  out.sort((a, b) => ms(b.data_inscricao) - ms(a.data_inscricao));
  cachePutJson_(chave, out, 300);
  return out;
}

// ---------- E-mails de acesso ----------
function blocoAcessoEmail_(email, acesso) {
  const link = `${getBaseUrl_()}?page=acompanhar`;
  if (acesso && acesso.nova) {
    return `
        <div style="padding:16px;border:2px solid rgba(65,166,57,.35);background:rgba(65,166,57,.06);border-radius:10px;margin:0 0 18px;">
          <div style="font-size:15px;font-weight:800;color:#000;margin-bottom:8px;">Seu acesso à área do candidato</div>
          <div style="font-size:14px;color:#333;line-height:1.7;">
            E-mail: <strong>${escapeHtml_(email)}</strong><br>
            Senha: <strong style="font-family:Consolas,monospace;font-size:16px;letter-spacing:1px;">${escapeHtml_(acesso.senha)}</strong>
          </div>
          <div style="font-size:12px;color:#666;margin-top:8px;line-height:1.6;">
            Com ela você acompanha todas as vagas em que se inscrever. Guarde este e-mail; você pode trocar a senha depois de entrar.
          </div>
        </div>
        <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
          Entre em <a href="${escapeHtml_(link)}" style="color:#2f8a28;font-weight:700;">Minhas candidaturas</a> para ver a etapa atual de cada processo.
        </p>`;
  }
  return `
        <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
          Esta candidatura já aparece em <a href="${escapeHtml_(link)}" style="color:#2f8a28;font-weight:700;">Minhas candidaturas</a>.
          Entre com seu e-mail e a senha que você já recebeu. Se não lembrar, use "Esqueci minha senha".
        </p>`;
}

function enviarEmailSenha_(email, nome, senha) {
  const link = `${getBaseUrl_()}?page=acompanhar`;
  const ola = nome ? `Olá, ${String(nome).trim().split(/\s+/)[0]}!` : "Olá!";

  const htmlBody = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#efefed;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e5e5;">
      <div style="background:#41a639;padding:24px 20px;text-align:center;">
        <div style="font-weight:800;font-size:24px;letter-spacing:1px;color:#fff;">INNOMAKER</div>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 12px;font-size:16px;color:#000;">${escapeHtml_(ola)}</p>
        <p style="margin:0 0 18px;font-size:14px;color:#333;line-height:1.6;">Esta é a sua nova senha para a área do candidato:</p>
        <div style="padding:16px;background:#efefed;border-left:4px solid #41a639;border-radius:8px;margin-bottom:18px;">
          <div style="font-size:13px;color:#666;">E-mail: <strong style="color:#000;">${escapeHtml_(email)}</strong></div>
          <div style="font-size:18px;font-weight:800;color:#000;font-family:Consolas,monospace;letter-spacing:1px;margin-top:6px;">${escapeHtml_(senha)}</div>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="${escapeHtml_(link)}" target="_blank" style="display:inline-block;background:#41a639;color:#fff;text-decoration:none;font-weight:800;padding:14px 24px;border-radius:999px;">Ver minhas candidaturas</a>
        </div>
        <p style="margin:0;font-size:12px;color:#777;line-height:1.6;">A senha anterior deixou de funcionar. Se você não pediu uma nova senha, ignore este e-mail.</p>
      </div>
    </div>
  </div>`;

  MailApp.sendEmail({
    to: email,
    subject: "Sua senha — Área do candidato Innomaker",
    body: `${ola}\n\nSua nova senha da área do candidato:\nE-mail: ${email}\nSenha: ${senha}\n\nEntre em: ${link}\n\nA senha anterior deixou de funcionar.`,
    htmlBody
  });
}

// Menu: selecione uma linha da aba LOGINS e envie uma nova senha ao candidato
function menuNovaSenhaCandidato() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET_LOGINS) { ui.alert(`Abra a aba ${SHEET_LOGINS} e selecione a linha do candidato.`); return; }
  const row = sh.getActiveRange() ? sh.getActiveRange().getRow() : 0;
  if (row < 2) { ui.alert("Selecione a linha de um candidato (não o cabeçalho)."); return; }

  const email = String(sh.getRange(row, LC_.email + 1).getValue() || "").trim().toLowerCase();
  if (!email) { ui.alert("Esta linha não tem e-mail."); return; }
  if (ui.alert("Enviar nova senha", `Gerar uma nova senha e enviar para ${email}?\nA senha atual deixa de funcionar.`, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const a = buscarConta_(email);
  if (!a.c) { ui.alert("Conta não encontrada."); return; }
  redefinirSenha_(a);
  SpreadsheetApp.getActive().toast(`Nova senha enviada para ${email}.`, "Área do candidato ✅", 6);
}

function getTrackingData_(vagaId, candId) {
  const vaga = getVacancyById_(vagaId, false);
  if (!vaga || !vaga.planilha_vaga_id) return null;

  const ssV = SpreadsheetApp.openById(sheetIdFromAny_(vaga.planilha_vaga_id));
  const shC = ssV.getSheetByName("CANDIDATOS");
  const shE = ssV.getSheetByName("ETAPAS");
  if (!shC || !shE) return null;

  const cValues = shC.getDataRange().getValues();
  if (cValues.length < 2) return null;
  const ci = indexMap_(cValues[0].map(h => String(h || "").trim()));

  let candidato = null;
  for (let r = 1; r < cValues.length; r++) {
    if (String(cValues[r][ci.cand_id] || "").trim().toUpperCase() === String(candId).toUpperCase()) {
      candidato = cValues[r];
      break;
    }
  }
  if (!candidato) return null;

  const eValues = shE.getDataRange().getValues();
  const ei = indexMap_((eValues[0] || []).map(h => String(h || "").trim()));
  const etapas = [];
  for (let r = 1; r < eValues.length; r++) {
    if (String(eValues[r][ei.cand_id] || "").trim().toUpperCase() !== String(candId).toUpperCase()) continue;
    etapas.push({
      ordem: Number(eValues[r][ei.ordem]) || 0,
      nome: String(eValues[r][ei.etapa_nome] || "").trim(),
      resultado: String(eValues[r][ei.resultado] || "Pendente").trim(),
      data_prevista: formatarDataPublica_(eValues[r][ei.data_prevista]),
      data_realizada: formatarDataPublica_(eValues[r][ei.data_realizada])
    });
  }
  etapas.sort((a, b) => a.ordem - b.ordem);

  const estado = calcularEstadoPublicoEtapas_(etapas);
  const dataInscricao = ci.data_inscricao !== undefined ? candidato[ci.data_inscricao] : "";

  return {
    vaga_id: vaga.vaga_id,
    titulo_vaga: vaga.titulo_vaga,
    cand_id: String(candidato[ci.cand_id] || candId).trim(),
    nome: ci.nome !== undefined ? String(candidato[ci.nome] || "").trim() : "",
    email: ci.email !== undefined ? String(candidato[ci.email] || "").trim() : "",
    data_inscricao: formatarDataPublica_(dataInscricao),
    status_publico: estado.status,
    etapa_atual: estado.etapaAtual,
    mensagem: estado.mensagem,
    ultima_atualizacao: calcularUltimaAtualizacao_(etapas, dataInscricao),
    etapas: estado.etapas
  };
}

function calcularEstadoPublicoEtapas_(etapas) {
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const aprovados = ["aprovado", "aprovada", "concluido", "concluida", "classificado", "classificada", "ok", "sim"];
  const reprovados = ["reprovado", "reprovada", "nao aprovado", "nao aprovada", "eliminado", "eliminada", "nao selecionado", "nao selecionada"];

  let encerrado = false;
  let etapaAtual = "";
  let achouAtual = false;

  const publicas = etapas.map(et => {
    const r = norm(et.resultado);
    let estado = "pendente";
    if (reprovados.some(x => r === x || r.indexOf(x) >= 0)) { estado = "encerrada"; encerrado = true; }
    else if (aprovados.some(x => r === x || r.indexOf(x) >= 0)) { estado = "concluida"; }
    else if (!achouAtual && !encerrado) { estado = "atual"; etapaAtual = et.nome; achouAtual = true; }
    return { ordem: et.ordem, nome: et.nome, estado, data: et.data_realizada || et.data_prevista || "" };
  });

  if (encerrado) {
    return {
      status: "Processo encerrado", etapaAtual: "",
      mensagem: "Agradecemos sua participação. Neste momento, sua candidatura não seguirá para as próximas etapas.",
      etapas: publicas
    };
  }
  if (publicas.length && publicas.every(e => e.estado === "concluida")) {
    return {
      status: "Processo concluído", etapaAtual: "Processo concluído",
      mensagem: "Você concluiu todas as etapas do processo seletivo. O RH entrará em contato sobre os próximos passos.",
      etapas: publicas
    };
  }
  return {
    status: "Em processo",
    etapaAtual: etapaAtual || (publicas[0] ? publicas[0].nome : "Triagem"),
    mensagem: "Sua candidatura continua em análise.",
    etapas: publicas
  };
}

function calcularUltimaAtualizacao_(etapas, dataInscricao) {
  const datas = [];
  const di = toDateSafe_(dataInscricao);
  if (di) datas.push(di);
  etapas.forEach(et => [et.data_realizada, et.data_prevista].forEach(v => { const d = toDateSafe_(v); if (d) datas.push(d); }));
  if (!datas.length) return formatarDataPublica_(new Date());
  datas.sort((a, b) => b.getTime() - a.getTime());
  return formatarDataPublica_(datas[0]);
}

function sanitizarTrackingPublico_(d) {
  return {
    vaga_id: d.vaga_id, titulo_vaga: d.titulo_vaga, cand_id: d.cand_id, nome: d.nome,
    data_inscricao: d.data_inscricao, status_publico: d.status_publico, etapa_atual: d.etapa_atual,
    mensagem: d.mensagem, ultima_atualizacao: d.ultima_atualizacao, etapas: d.etapas
  };
}


// =================================================================
//  SEGURANÇA E LINKS
// =================================================================
let SECRET_MEMO_ = "";
let BASE_URL_MEMO_ = "";

function getSecret_() {
  if (SECRET_MEMO_) return SECRET_MEMO_;
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty("ATS_SECRET");
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty("ATS_SECRET", secret);
  }
  SECRET_MEMO_ = secret;
  return secret;
}

function getBaseUrl_() {
  if (!BASE_URL_MEMO_) BASE_URL_MEMO_ = SITE_URL || ScriptApp.getService().getUrl();
  return BASE_URL_MEMO_;
}

function generateToken_(vagaId) {
  const secret = getSecret_();
  const bytes = Utilities.computeHmacSha256Signature(`${vagaId}|${secret}`, secret);
  return Utilities.base64EncodeWebSafe(bytes).slice(0, 32);
}

function validateToken_(vagaId, token) {
  return !!vagaId && token === generateToken_(vagaId);
}

function buildPublicVagaLink_(vagaId) {
  return `${getBaseUrl_()}?page=vaga&vaga_id=${encodeURIComponent(vagaId)}&t=${encodeURIComponent(generateToken_(vagaId))}`;
}

function generateCandidateTrackingToken_(vagaId, candId, email) {
  const secret = getSecret_();
  const raw = `${String(vagaId).trim()}|${String(candId).trim()}|${String(email).trim().toLowerCase()}`;
  const bytes = Utilities.computeHmacSha256Signature(raw, secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "").slice(0, 40);
}

function validateCandidateTrackingToken_(vagaId, candId, email, token) {
  if (!vagaId || !candId || !email || !token) return false;
  return String(token).trim() === generateCandidateTrackingToken_(vagaId, candId, email);
}

function buildCandidateTrackingLink_(vagaId, candId, email) {
  const t = generateCandidateTrackingToken_(vagaId, candId, email);
  return `${getBaseUrl_()}?page=acompanhar&vaga_id=${encodeURIComponent(vagaId)}&cand_id=${encodeURIComponent(candId)}&t=${encodeURIComponent(t)}`;
}


// =================================================================
//  PLANILHA DA VAGA (template)
// =================================================================
function ensureVacancyTemplateStructure_(ssV) {
  const need = (name, header) => {
    let sh = ssV.getSheetByName(name);
    if (!sh) sh = ssV.insertSheet(name);
    const a1 = sh.getLastRow() >= 1 ? String(sh.getRange(1, 1).getValue() || "").trim() : "";
    if (!a1) {
      sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
  };

  need("CONFIG", ["chave", "valor"]);
  need("CANDIDATOS", [
    "cand_id", "nome", "email", "telefone", "periodo_curso", "previsao_formatura",
    "curriculo_link", "data_inscricao", "status", "etapa_atual", "score", "obs_geral"
  ]);
  need("ETAPAS", [
    "cand_id", "nome", "ordem", "etapa_nome", "resultado", "motivo", "responsavel",
    "data_prevista", "data_realizada", "obs", "mensagem_email", "Notificação"
  ]);
  need("LOG", ["timestamp", "acao", "vaga_id", "cand_id", "de", "para", "usuario", "obs"]);
}

function getConfigMapVacancy_(ssV) {
  const values = ssV.getSheetByName("CONFIG").getDataRange().getValues();
  const map = {};
  for (let i = 1; i < values.length; i++) {
    const k = String(values[i][0] || "").trim();
    if (k) map[k] = String(values[i][1] || "").trim();
  }
  return map;
}

function setConfigInVacancy_(ssV, key, value) {
  const o = {};
  o[key] = value;
  setConfigsInVacancy_(ssV, o);
}

// Grava várias chaves lendo a aba CONFIG uma vez só
function setConfigsInVacancy_(ssV, obj) {
  const sh = ssV.getSheetByName("CONFIG") || ssV.insertSheet("CONFIG");
  if (sh.getLastRow() === 0) sh.appendRow(["chave", "valor"]);

  const values = sh.getDataRange().getValues();
  const pos = {};
  for (let i = 1; i < values.length; i++) {
    const k = String(values[i][0] || "").trim();
    if (k) pos[k] = i;
  }

  const novos = [];
  Object.keys(obj).forEach(k => {
    const v = String(obj[k] == null ? "" : obj[k]);
    if (pos[k] !== undefined) {
      if (String(values[pos[k]][1]) !== v) sh.getRange(pos[k] + 1, 2).setValue(v);
    } else {
      novos.push([k, v]);
    }
  });
  if (novos.length) sh.getRange(sh.getLastRow() + 1, 1, novos.length, 2).setValues(novos);
}

function nextCandIdInVacancy_(ssV) {
  const ano = new Date().getFullYear();
  const key = `cand_seq_${ano}`;
  const seq = parseInt(getConfigMapVacancy_(ssV)[key] || "1", 10) || 1;
  setConfigInVacancy_(ssV, key, String(seq + 1));
  return `CAN-${ano}-${String(seq).padStart(6, "0")}`;
}

function existsCandidateEmailTemplate_(shC, email) {
  const lastRow = shC.getLastRow();
  if (lastRow < 2) return false;
  const header = shC.getRange(1, 1, 1, shC.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const iEmail = header.indexOf("email");
  if (iEmail < 0) return false;
  const alvo = String(email || "").trim().toLowerCase();
  return shC.getRange(2, iEmail + 1, lastRow - 1, 1).getValues()
    .some(r => String(r[0] || "").trim().toLowerCase() === alvo);
}

function logVacancy_(shL, acao, vagaId, candId, de, para, usuario, obs) {
  shL.appendRow([new Date(), acao || "", vagaId || "", candId || "", de || "", para || "", usuario || "", obs || ""]);
}

function parseEtapasJsonToArray_(etapasJson) {
  try {
    const arr = JSON.parse(String(etapasJson || "").trim());
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (e) {}
  return [];
}

function getUploadFolderForVacancy_(vaga) {
  try {
    const folder = DriveApp.getFolderById(folderIdFromAny_(vaga.pasta_vaga_id));
    return getOrCreateSubfolderByName_(folder, "CURRICULOS");
  } catch (e) {
    if (DEFAULT_UPLOAD_ROOT_FOLDER_ID) {
      try { return DriveApp.getFolderById(DEFAULT_UPLOAD_ROOT_FOLDER_ID); } catch (_) {}
    }
    return DriveApp.getRootFolder();
  }
}


// =================================================================
//  CRIAÇÃO DE VAGAS (Form 1 → VAGAS)
// =================================================================
function onForm1Submit(e) {
  try {
    if (!e || !e.range) throw new Error("Evento de envio inválido.");

    const shForm = e.range.getSheet();
    const rowForm = e.range.getRow();
    const nomeAba = String(shForm.getName() || "").trim();
    if (nomeAba !== "FORM1_RESPOSTAS" && nomeAba.toLowerCase().indexOf("form1") < 0) return;

    const ss = SpreadsheetApp.openById(MAE_SPREADSHEET_ID);
    const shVagas = ss.getSheetByName(SHEET_VAGAS);
    if (!shVagas) throw new Error("Aba VAGAS não encontrada.");

    ensureVagasHeaders_(shVagas);
    garantirColunaVagaIdForm_(shForm);

    if (String(shForm.getRange(rowForm, 19).getDisplayValue() || "").trim()) return;

    const lastCol = shForm.getLastColumn();
    const headers = shForm.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    const values = shForm.getRange(rowForm, 1, 1, lastCol).getDisplayValues()[0];
    const payload = rowToObjectByHeaders_(headers, values);
    const p = normalizarPayloadForm_(payload);

    const titulo = valorPayloadForm_(p, "Título da vaga", "Titulo da vaga", "Título do Cargo", "Titulo do Cargo");
    if (!titulo) throw new Error(`Título da vaga não encontrado na linha ${rowForm}.`);

    const carimbo = valorPayloadForm_(p, "Carimbo de data/hora", "Timestamp") || String(values[0] || "").trim();
    const formKey = `${carimbo}|${titulo}`;

    const vIdx = indexMap_(shVagas.getRange(1, 1, 1, shVagas.getLastColumn()).getValues()[0].map(h => String(h || "").trim()));

    if (vIdx.form1_key !== undefined && shVagas.getLastRow() >= 2) {
      const keys = shVagas.getRange(2, vIdx.form1_key + 1, shVagas.getLastRow() - 1, 1).getDisplayValues().map(r => String(r[0] || "").trim());
      const pos = keys.indexOf(formKey);
      if (pos >= 0) {
        const existente = String(shVagas.getRange(pos + 2, vIdx.vaga_id + 1).getDisplayValue() || "").trim();
        if (existente) shForm.getRange(rowForm, 19).setValue(existente);
        return;
      }
    }

    const result = criarVagaFromFormPayload_(payload, {
      shVagas, vIdx,
      root: DriveApp.getFolderById(ROOT_FOLDER_ID),
      templateFile: DriveApp.getFileById(TEMPLATE_SHEET_ID),
      formKey
    });

    shForm.getRange(rowForm, 19).setValue(result.vaga_id);
    SpreadsheetApp.flush();
  } catch (err) {
    Logger.log("ERRO onForm1Submit: " + (err.stack || err.message || err));
    throw err;
  }
}

function gerarVagasFaltantesDoForm1() {
  const ss = SpreadsheetApp.openById(MAE_SPREADSHEET_ID);
  const shForm = ss.getSheetByName("FORM1_RESPOSTAS") || findFormResponsesSheet_(ss);
  if (!shForm) throw new Error("Não encontrei a aba FORM1_RESPOSTAS.");
  const shVagas = ss.getSheetByName(SHEET_VAGAS);
  if (!shVagas) throw new Error("Aba VAGAS não encontrada.");

  ensureVagasHeaders_(shVagas);
  garantirColunaVagaIdForm_(shForm);

  const vagasData = shVagas.getDataRange().getValues();
  const vIdx = indexMap_((vagasData[0] || []).map(h => String(h || "").trim()));

  const lastRow = shForm.getLastRow();
  const lastCol = shForm.getLastColumn();
  if (lastRow < 2) {
    SpreadsheetApp.getActive().toast("FORM1_RESPOSTAS ainda não tem linhas.", "ATS", 6);
    return;
  }

  const formHeaders = shForm.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const formValues = shForm.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

  const imported = new Set();
  if (vIdx.form1_key !== undefined) {
    for (let r = 1; r < vagasData.length; r++) {
      const k = String(vagasData[r][vIdx.form1_key] || "").trim();
      if (k) imported.add(k);
    }
  }

  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const templateFile = DriveApp.getFileById(TEMPLATE_SHEET_ID);
  let created = 0, skipped = 0, errors = 0;

  for (let i = 0; i < formValues.length; i++) {
    const sheetRow = i + 2;
    const row = formValues[i];
    if (String(row[18] || "").trim()) { skipped++; continue; } // coluna S = vaga_id

    const payload = rowToObjectByHeaders_(formHeaders, row);
    const p = normalizarPayloadForm_(payload);
    const titulo = valorPayloadForm_(p, "Título da vaga", "Titulo da vaga", "Título do Cargo", "Titulo do Cargo");
    if (!titulo) { skipped++; continue; }

    const carimbo = valorPayloadForm_(p, "Carimbo de data/hora", "Timestamp") || String(row[0] || "").trim();
    const formKey = `${carimbo}|${titulo}`;
    if (imported.has(formKey)) { skipped++; continue; }

    try {
      const result = criarVagaFromFormPayload_(payload, { shVagas, vIdx, root, templateFile, formKey });
      shForm.getRange(sheetRow, 19).setValue(result.vaga_id);
      imported.add(formKey);
      created++;
    } catch (err) {
      errors++;
      Logger.log(`Erro ao importar linha ${sheetRow}: ${err.stack || err.message || err}`);
    }
  }

  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast(`Importação concluída ✅\nCriadas: ${created}\nIgnoradas: ${skipped}\nErros: ${errors}`, "ATS", 10);
}

function garantirColunaVagaIdForm_(shForm) {
  if (shForm.getMaxColumns() < 19) shForm.insertColumnsAfter(shForm.getMaxColumns(), 19 - shForm.getMaxColumns());
  if (String(shForm.getRange(1, 19).getValue()).trim() !== "vaga_id") shForm.getRange(1, 19).setValue("vaga_id");
}

function criarVagaFromFormPayload_(payload, ctx) {
  const { shVagas, vIdx, root, templateFile, formKey } = ctx;
  const p = normalizarPayloadForm_(payload);
  const pegar = (...nomes) => valorPayloadForm_(p, ...nomes);

  const titulo = pegar("Título da vaga", "Titulo da vaga", "Título do Cargo", "Titulo do Cargo");
  if (!titulo) throw new Error("Não encontrei o título da vaga no FORM1_RESPOSTAS.");

  const dataLimite = pegar("Data limite de inscrição", "Data limite de inscricao");
  const localidade = pegar("Localidade");
  const tipoVaga = pegar("Tipo da vaga", "Modalidade", "Modalidade de trabalho", "Tipo de trabalho");
  const carga = pegar("Carga horária", "Carga horaria");
  const remuneracao = pegar("Remuneração / Bolsa", "Remuneracao / Bolsa", "Remuneração", "Bolsa");
  const descricao = pegar("Descrição geral da oportunidade", "Descrição geral");
  const requisitos = pegar("Requisitos da vaga", "Habilidades Técnicas Necessárias");
  const funcoes = pegar("Principais funções/atividades", "Principais funcoes/atividades");
  const tipoContratacao = pegar("Tipo de contratação", "Tipo de Contrato", "Tipo do Contrato");
  const status = pegar("Status da vaga", "Status") || "Aberta";

  const ano = new Date().getFullYear();
  const vagaId = `VAG-${ano}-${String(nextMaeSequence_(`vaga_seq_${ano}`)).padStart(4, "0")}`;

  const pastaSem = getOrCreateSubfolderByName_(root, `${ano} - ${definirSemestre_(dataLimite)}`);
  const pastaVaga = pastaSem.createFolder(`${vagaId} - ${sanitizeName_(titulo, 60)} - ${sanitizeName_(tipoContratacao || "TIPO", 20)}`);
  const novaPlanilha = templateFile.makeCopy(`ATS - ${vagaId} - ${sanitizeName_(titulo, 70)}`, pastaVaga);

  const etapas = [{ ordem: 1, etapa_nome: "Triagem", tipo: "Triagem" }];
  ["Etapa 02", "Etapa 03", "Etapa 04", "Etapa 05", "Etapa 06"]
    .map(n => pegar(n))
    .filter(Boolean)
    .forEach((nm, i) => etapas.push({ ordem: i + 2, etapa_nome: nm, tipo: guessTipoEtapa_(nm) }));

  const rowOut = new Array(shVagas.getLastColumn()).fill("");
  rowOut[vIdx.vaga_id] = vagaId;
  rowOut[vIdx.titulo_vaga] = titulo;
  rowOut[vIdx.status_vaga] = status;
  rowOut[vIdx.data_limite_inscricao] = dataLimite;
  rowOut[vIdx.localidade] = localidade;
  rowOut[vIdx.tipo_vaga] = tipoVaga;
  rowOut[vIdx.tipo_contratacao] = tipoContratacao;
  rowOut[vIdx.carga_horaria] = carga;
  rowOut[vIdx.remuneracao_bolsa] = remuneracao;
  rowOut[vIdx.descricao_geral] = descricao;
  rowOut[vIdx.requisitos] = requisitos;
  rowOut[vIdx.principais_funcoes] = funcoes;
  rowOut[vIdx.planilha_vaga_id] = novaPlanilha.getUrl();
  rowOut[vIdx.pasta_vaga_id] = pastaVaga.getUrl();
  rowOut[vIdx.etapas_json] = JSON.stringify(etapas);
  if (vIdx.form1_key !== undefined) rowOut[vIdx.form1_key] = formKey || "";

  shVagas.appendRow(rowOut);
  limparCacheVagas_(); // a vaga nova aparece no site na hora

  return { vaga_id: vagaId, planilha_url: novaPlanilha.getUrl(), pasta_url: pastaVaga.getUrl() };
}

function verificarEGerarVagasFaltantes() {
  const sh = SpreadsheetApp.openById(MAE_SPREADSHEET_ID).getSheetByName(SHEET_VAGAS);
  if (!sh) throw new Error("Aba VAGAS não encontrada.");

  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    SpreadsheetApp.getActive().toast("Sem vagas para verificar.", "ATS", 5);
    return;
  }

  const idx = indexMap_(data[0].map(h => String(h || "").trim()));
  ["vaga_id", "titulo_vaga", "planilha_vaga_id", "pasta_vaga_id"].forEach(c => {
    if (idx[c] === undefined) throw new Error("Coluna obrigatória ausente em VAGAS: " + c);
  });

  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const templateFile = DriveApp.getFileById(TEMPLATE_SHEET_ID);
  let fixed = 0, skipped = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const vagaId = String(row[idx.vaga_id] || "").trim();
    const titulo = String(row[idx.titulo_vaga] || "").trim();
    if (!vagaId || !titulo) { skipped++; continue; }

    const pastaAtual = String(row[idx.pasta_vaga_id] || "").trim();
    const planilhaAtual = String(row[idx.planilha_vaga_id] || "").trim();
    if (pastaAtual && planilhaAtual) { skipped++; continue; }

    const ano = extrairAnoDaVagaId_(vagaId) || new Date().getFullYear();
    const semestre = definirSemestre_(idx.data_limite_inscricao !== undefined ? row[idx.data_limite_inscricao] : null);
    const pastaSem = getOrCreateSubfolderByName_(root, `${ano} - ${semestre}`);

    let pastaVaga;
    if (!pastaAtual) {
      const tipo = idx.tipo_contratacao !== undefined ? String(row[idx.tipo_contratacao] || "").trim() : "";
      pastaVaga = pastaSem.createFolder(`${vagaId} - ${sanitizeName_(titulo, 60)} - ${sanitizeName_(tipo || "TIPO", 20)}`);
      sh.getRange(r + 1, idx.pasta_vaga_id + 1).setValue(pastaVaga.getUrl());
    } else {
      pastaVaga = DriveApp.getFolderById(folderIdFromAny_(pastaAtual));
    }

    if (!planilhaAtual) {
      const copia = templateFile.makeCopy(`ATS - ${vagaId} - ${sanitizeName_(titulo, 70)}`, pastaVaga);
      sh.getRange(r + 1, idx.planilha_vaga_id + 1).setValue(copia.getUrl());
    }

    if (idx.etapas_json !== undefined && !String(row[idx.etapas_json] || "").trim()) {
      sh.getRange(r + 1, idx.etapas_json + 1).setValue(JSON.stringify([
        { ordem: 1, etapa_nome: "Triagem", tipo: "Triagem" },
        { ordem: 2, etapa_nome: "Entrevista", tipo: "Entrevista" }
      ]));
    }
    fixed++;
  }

  SpreadsheetApp.flush();
  limparCacheVagas_();
  SpreadsheetApp.getActive().toast(`Reconciliação concluída ✅\nGeradas/ajustadas: ${fixed}\nSem ação: ${skipped}`, "ATS", 8);
}

function ensureVagasHeaders_(shVagas) {
  const required = VAGAS_REQUIRED_COLS.concat(["form1_key"]);
  if (shVagas.getLastRow() === 0) {
    shVagas.appendRow(required);
    shVagas.getRange(1, 1, 1, required.length).setFontWeight("bold");
    shVagas.setFrozenRows(1);
    return;
  }
  const cur = shVagas.getRange(1, 1, 1, shVagas.getLastColumn()).getValues()[0].map(h => String(h || "").trim());
  const faltando = required.filter(c => cur.indexOf(c) < 0);
  if (faltando.length) {
    const all = cur.concat(faltando);
    shVagas.getRange(1, 1, 1, all.length).setValues([all]).setFontWeight("bold");
    shVagas.setFrozenRows(1);
  }
}

function nextMaeSequence_(key) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(MAE_SPREADSHEET_ID);
    const sh = ss.getSheetByName("CONFIG") || ss.insertSheet("CONFIG");
    if (sh.getLastRow() === 0) {
      sh.appendRow(["chave", "valor"]);
      sh.getRange(1, 1, 1, 2).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
    const data = sh.getDataRange().getValues();
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][0] || "").trim() === key) {
        const cur = parseInt(String(data[r][1] || "1"), 10) || 1;
        sh.getRange(r + 1, 2).setValue(String(cur + 1));
        return cur;
      }
    }
    sh.appendRow([key, "2"]);
    return 1;
  } finally {
    lock.releaseLock();
  }
}

function findFormResponsesSheet_(ss) {
  return ss.getSheets().find(s => {
    const n = String(s.getName() || "").toLowerCase();
    return n.indexOf("respostas") >= 0 || n.indexOf("responses") >= 0 || n.indexOf("form") >= 0;
  }) || null;
}

function rowToObjectByHeaders_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { const k = String(h || "").trim(); if (k) obj[k] = row[i]; });
  return obj;
}

function normalizarCabecalhoForm_(texto) {
  return String(texto == null ? "" : texto)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[\u00A0]/g, " ")
    .replace(/[.:;!?]+$/g, "").replace(/\s+/g, " ").trim();
}

function normalizarPayloadForm_(payload) {
  const out = {};
  Object.keys(payload || {}).forEach(chave => {
    const k = normalizarCabecalhoForm_(chave);
    if (!k) return;
    const bruto = payload[chave];
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    out[k] = String(valor == null ? "" : valor).trim();
  });
  return out;
}

function valorPayloadForm_(p, ...nomes) {
  for (const nome of nomes) {
    const v = p[normalizarCabecalhoForm_(nome)];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function guessTipoEtapa_(nomeEtapa) {
  const n = String(nomeEtapa || "").toLowerCase().trim();
  if (!n) return "Etapa";
  if (n.includes("triagem")) return "Triagem";
  if (n.includes("técnic") || n.includes("tecnic")) return "Entrevista Técnica";
  if (n.includes("entrevista")) return "Entrevista";
  if (n.includes("prova") || n.includes("teste")) return "Teste";
  if (n.includes("case")) return "Case";
  if (n.includes("dinâmica") || n.includes("dinamica")) return "Dinâmica";
  if (n.includes("avaliação") || n.includes("avaliacao")) return "Avaliação";
  if (n.includes("final")) return "Etapa Final";
  return "Etapa";
}


// =================================================================
//  MENU / ADMIN
// =================================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu("🚀 Sistema de Vagas")
    .addItem("🔧 Configurar Planilha (Setup Inicial)", "setupMae")
    .addItem("⚙️ Instalar Gatilhos Automáticos", "installMaeTriggers")
    .addSeparator()
    .addItem("📥 Importar Vagas do Form 1 (Faltantes)", "gerarVagasFaltantesDoForm1")
    .addItem("🧩 Verificar e Gerar Estrutura Faltante", "verificarEGerarVagasFaltantes")
    .addSeparator()
    .addItem("🔄 Atualizar Status das Vagas", "atualizarStatusVagasPorData")
    .addItem("🧹 Atualizar site agora (limpar cache)", "menuLimparCache")
    .addItem("🔗 Gerar Link Público da Vaga Selecionada", "menuGerarLinkVaga")
    .addItem("🗂️ Reconstruir índice de candidatos", "reconstruirIndiceCandidatos")
    .addItem("🔑 Enviar nova senha (linha selecionada em LOGINS)", "menuNovaSenhaCandidato")
    .addSeparator()
    .addItem("📊 Ver Status do Sistema", "showMaeStatus")
    .addItem("🔐 Testar Token da Vaga Selecionada", "menuTestarToken")
    .addSeparator()
    .addItem("📘 Abrir Manual da Planilha Mãe", "abrirManualMae")
    .addItem("ℹ️ Sobre o Sistema", "menuSobreATS")
    .addToUi();
}

function setupMae() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureHeadersMae_(getOrCreateSheet_(ss, SHEET_VAGAS), VAGAS_REQUIRED_COLS);
  ensureHeadersMae_(getOrCreateSheet_(ss, "LOG"), LOG_HEADERS);
  ensureHeadersMae_(getOrCreateSheet_(ss, "CONFIG"), CONFIG_HEADERS);
  ensureHeadersMae_(getOrCreateSheet_(ss, SHEET_INDICE), ["cand_id", "email", "vaga_id", "data"]);
  contasSheet_();
  SpreadsheetApp.getUi().alert("Setup concluído ✅\n\nAbas garantidas: VAGAS, CONFIG, LOG, INDICE_CANDIDATOS e LOGINS.");
}

function installMaeTriggers() {
  const nomes = ["onForm1Submit", "atualizarStatusVagasPorData", "aoEditarMae"];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (nomes.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });

  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger("onForm1Submit").forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger("atualizarStatusVagasPorData").timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger("aoEditarMae").forSpreadsheet(ss).onEdit().create();

  ss.toast("Gatilhos instalados ✅\n- onForm1Submit\n- atualizarStatusVagasPorData (02h)\n- aoEditarMae (atualiza o site)", "ATS Mãe", 8);
}

function showMaeStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const faltando = [SHEET_VAGAS, "CONFIG", "LOG"].filter(n => !ss.getSheetByName(n));
  if (faltando.length) {
    SpreadsheetApp.getUi().alert("Status do ATS Mãe ⚠️\n\nFaltando abas: " + faltando.join(", ") + "\n\nRode o Setup Inicial.");
    return;
  }

  const shV = ss.getSheetByName(SHEET_VAGAS);
  const shI = ss.getSheetByName(SHEET_INDICE);
  const triggers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  const ok = fn => triggers.indexOf(fn) >= 0 ? "OK" : "NÃO instalado";
  let abertas = "?";
  try { abertas = listOpenVacancies_().length; } catch (e) {}

  SpreadsheetApp.getUi().alert(
    "Status do ATS Mãe ✅\n\n" +
    `• Vagas cadastradas: ${Math.max(0, shV.getLastRow() - 1)} (abertas no site: ${abertas})\n` +
    `• Índice de candidatos: ${shI ? Math.max(0, shI.getLastRow() - 1) + " registros" : "ainda não criado"}\n` +
    `• ATS_SECRET: ${PropertiesService.getScriptProperties().getProperty("ATS_SECRET") ? "OK" : "PENDENTE"}\n\n` +
    "Gatilhos:\n" +
    `• onForm1Submit: ${ok("onForm1Submit")}\n` +
    `• atualizarStatusVagasPorData: ${ok("atualizarStatusVagasPorData")}\n` +
    `• aoEditarMae: ${ok("aoEditarMae")}`
  );
}

function menuGerarLinkVaga() {
  const vagaId = vagaIdDaLinhaSelecionada_();
  if (!vagaId) return;
  const sh = SpreadsheetApp.getActiveSheet();
  const link = buildPublicVagaLink_(vagaId);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h || "").trim());
  const idxPublic = headers.indexOf("public_link");
  if (idxPublic >= 0) sh.getRange(sh.getActiveRange().getRow(), idxPublic + 1).setValue(link);
  SpreadsheetApp.getUi().alert("Link público gerado ✅\n\nVaga: " + vagaId + "\n\n" + link);
}

function menuTestarToken() {
  const vagaId = vagaIdDaLinhaSelecionada_();
  if (!vagaId) return;
  const token = generateToken_(vagaId);
  SpreadsheetApp.getUi().alert(
    "Teste de Token 🔐\n\nVaga ID: " + vagaId + "\n\nToken:\n" + token +
    "\n\nValidação: " + (validateToken_(vagaId, token) ? "OK ✅" : "FALHOU ❌")
  );
}

function vagaIdDaLinhaSelecionada_() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET_VAGAS) { ui.alert("Abra a aba VAGAS e selecione a linha da vaga."); return ""; }
  const range = sh.getActiveRange();
  if (!range || range.getRow() < 2) { ui.alert("Selecione uma linha de vaga (não o cabeçalho)."); return ""; }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h || "").trim());
  const idx = headers.indexOf("vaga_id");
  if (idx < 0) { ui.alert("Coluna 'vaga_id' não encontrada."); return ""; }
  const vagaId = String(sh.getRange(range.getRow(), idx + 1).getValue() || "").trim();
  if (!vagaId) ui.alert("Esta linha não tem vaga_id preenchido.");
  return vagaId;
}

// Varre as planilhas das vagas e monta o índice (rode uma vez para inscrições antigas)
function reconstruirIndiceCandidatos() {
  const ss = SpreadsheetApp.openById(MAE_SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_INDICE) || ss.insertSheet(SHEET_INDICE);
  const linhas = [];

  getVagasTodas_(true).forEach(v => {
    if (!v.planilha_vaga_id) return;
    try {
      const shC = SpreadsheetApp.openById(sheetIdFromAny_(v.planilha_vaga_id)).getSheetByName("CANDIDATOS");
      if (!shC || shC.getLastRow() < 2) return;
      const vals = shC.getDataRange().getValues();
      const ci = indexMap_(vals[0].map(h => String(h || "").trim()));
      for (let r = 1; r < vals.length; r++) {
        const id = String(vals[r][ci.cand_id] || "").trim();
        const em = String(vals[r][ci.email] || "").trim().toLowerCase();
        if (id && em) linhas.push([id, em, v.vaga_id, vals[r][ci.data_inscricao] || ""]);
      }
    } catch (e) {
      Logger.log(`Índice: falha na vaga ${v.vaga_id}: ${e}`);
    }
  });

  sh.clear();
  sh.getRange(1, 1, 1, 4).setValues([["cand_id", "email", "vaga_id", "data"]]).setFontWeight("bold");
  sh.setFrozenRows(1);
  if (linhas.length) sh.getRange(2, 1, linhas.length, 4).setValues(linhas);
  SpreadsheetApp.getActive().toast(`Índice reconstruído ✅\n${linhas.length} candidatura(s).`, "ATS", 8);
}

function menuSobreATS() {
  const triggers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  SpreadsheetApp.getUi().alert(
    "ATS Innomaker — Sistema de Recrutamento\n\nVersão: 2.0\n\n" +
    "✔ Site em página única (carregamento rápido)\n✔ Cache de vagas\n✔ Token seguro por vaga\n" +
    "✔ Upload de PDF com limite\n✔ Planilha ATS por vaga\n✔ Índice de candidatos\n\n" +
    "Fechamento automático diário: " + (triggers.indexOf("atualizarStatusVagasPorData") >= 0 ? "Sim ✅" : "Não ⚠️")
  );
}

function abrirManualMae() {
  const tpl = HtmlService.createTemplateFromFile("ManualMae");
  tpl.data = {
    spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
    rootFolderId: ROOT_FOLDER_ID,
    templateSheetId: TEMPLATE_SHEET_ID
  };
  SpreadsheetApp.getUi().showModalDialog(
    tpl.evaluate().setTitle("Manual ATS Mãe").setWidth(900).setHeight(600),
    "Manual de Instruções"
  );
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function ensureHeadersMae_(sh, headers) {
  const vazia = sh.getLastRow() === 0 ||
    !sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].some(x => String(x || "").trim());
  if (!vazia) return;
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, headers.length);
}


// =================================================================
//  UTILITÁRIOS
// =================================================================
function getOrCreateSubfolderByName_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function base64ToBlob_(base64, mimeType, fileName) {
  const cleaned = base64.indexOf(",") >= 0 ? base64.split(",").pop() : base64;
  return Utilities.newBlob(Utilities.base64Decode(cleaned), mimeType, fileName);
}

function indexMap_(headers) {
  const m = {};
  headers.forEach((h, i) => { if (h) m[h] = i; });
  return m;
}

function toDateSafe_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === "[object Date]") return isNaN(v.getTime()) ? null : new Date(v.getTime());
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatarDataPublica_(v) {
  if (!v) return "";
  const d = toDateSafe_(v);
  if (!d) return String(v).trim();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy");
}

function definirSemestre_(dataLimiteRaw) {
  const dt = toDateSafe_(dataLimiteRaw) || new Date();
  return dt.getMonth() + 1 <= 6 ? "S1" : "S2";
}

function extrairAnoDaVagaId_(vagaId) {
  const m = String(vagaId).match(/VAG-(\d{4})-/i);
  return m ? parseInt(m[1], 10) : null;
}

function sanitizeFileName_(name) {
  return String(name || "arquivo").replace(/[\\/:*?"<>|]/g, "-");
}

function sanitizeName_(s, maxLen) {
  const t = String(s || "").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen).trim() : t;
}

function sheetIdFromAny_(value) {
  const s = String(value || "").trim();
  const m1 = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]key=([a-zA-Z0-9-_]+)/);
  return m2 ? m2[1] : s;
}

function folderIdFromAny_(value) {
  const s = String(value || "").trim();
  const m1 = s.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  return m2 ? m2[1] : s;
}

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
