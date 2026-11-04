/*******************************************************************
 *  ATS Innomaker — Solicitações de Contratação
 *
 *  Fluxo:
 *  1. Formulário enviado → gera ID (SOL-ANO-000001)
 *  2. Busca o gestor do Departamento na aba EMAIL e envia o e-mail
 *     de aprovação (RH em cópia) com os botões APROVAR / SOLICITAR REAJUSTES
 *  3. Gestor clica → página do App da Web (Decisao.html) confirma a decisão
 *  4. APROVADO  → linha é copiada para a planilha de vagas (FORM1_RESPOSTAS)
 *     REAJUSTE  → solicitante e RH recebem o que precisa ser ajustado
 *******************************************************************/

// ===================== CONFIGURAÇÃO =====================
const SPREADSHEET_ID_NOTIFICACOES = "1RNcqDM8dHZCjg6lVNn8ZLmwY16KOeZgNNE0Yk8rrAJg";
const SHEET_FORM_RESPONSES = "Respostas ao formulário 1";
const SHEET_EMAIL_ADM = "EMAIL";

// Aba EMAIL → A: Departamento | B: Gestor | C: Email do Gestor
const EMAIL_COL_DEPARTAMENTO = 1;
const EMAIL_COL_GESTOR = 2;
const EMAIL_COL_EMAIL = 3;

// Destino das solicitações APROVADAS
const SPREADSHEET_ID_DESTINO = "1chGwwKOYtonvj7-cXLckJiKtvOco2K5l_MkKt04AmOw";
const SHEET_DESTINO = "FORM1_RESPOSTAS";

// Se algum cabeçalho do destino tiver nome diferente da origem, mapeie aqui:
// { "Cabeçalho no destino": "Cabeçalho na origem" }
const DE_PARA_DESTINO = {
  // "Cargo": "Título do Cargo:",
};

// false = a vaga entra na FORM1_RESPOSTAS pelo formulário de vagas (abaixo), sem cópia direta.
// Use true só se a FORM1_RESPOSTAS NÃO for a aba de respostas desse formulário.
const COPIAR_DIRETO_PARA_DESTINO = false;

// ===================== FORMULÁRIO DE CRIAÇÃO DE VAGA =====================
// Abra o formulário em modo EDIÇÃO e copie o ID da URL:
// https://docs.google.com/forms/d/ >>> ESTE_TRECHO <<< /edit
const FORM_ID_VAGAS = "";
const LINK_FORM_VAGAS = "https://forms.gle/p8hWd9t6YTcULo996";

// Pergunta do formulário de vaga → campo da solicitação usado no pré-preenchimento.
// A comparação ignora acentos, maiúsculas e ":" / "." no final.
const MAPA_PREFILL_VAGA = {
  "Título da vaga": "tituloCargo",
  "Data limite de inscrição": "dataLimite",
  "Localidade": "localidade",
  "Tipo da vaga": "tipoContrato",
  "Carga horária": "cargaHoraria",
  "Remuneração / Bolsa": "remuneracao",
  "Descrição geral da oportunidade": "descricao",
  "Requisitos da vaga": "habilidades",
  "Principais funções/atividades": "principaisFuncoes",
  "Tipo de contratação": "tipoContratacao",
  "Gestor responsável": "gestorResponsavel",
  "Status da vaga": "statusVagaPadrao",
  "ID da Solicitação": "solicId" // se criar essa pergunta no formulário, ela já vem preenchida
};

// Status inicial sugerido (precisa existir como opção no formulário). Ex.: "Aberta"
const STATUS_VAGA_PADRAO = "";

const FROM_NAME_ADM = "Innomaker — Recrutamento";
const EMAIL_RH = "ainnomaker@gmail.com";
const RH_EM_COPIA = true; // RH recebe cópia de todo e-mail de aprovação

// Cole aqui a URL /exec da implantação do App da Web (Implantar > Gerenciar implantações)
const WEBAPP_URL = "";

const LINK_PLANILHA_SOLICITACOES =
  "https://docs.google.com/spreadsheets/d/1RNcqDM8dHZCjg6lVNn8ZLmwY16KOeZgNNE0Yk8rrAJg/edit?resourcekey=&gid=51270359#gid=51270359";

// ===================== COLUNAS DE CONTROLE (U → AB) =====================
const COL_SOLIC_ID = 21;       // U
const COL_EMAIL_STATUS = 22;   // V
const COL_APROV_STATUS = 23;   // W
const COL_DECISAO_POR = 24;    // X
const COL_DECISAO_DATA = 25;   // Y
const COL_COMENTARIO = 26;     // Z
const COL_DESTINATARIOS = 27;  // AA
const COL_TOKEN = 28;          // AB
const COL_VAGA = 29;           // AC
const ULTIMA_COL_FORM = COL_SOLIC_ID - 1; // T
const ULTIMA_COL_CONTROLE = COL_VAGA;

const CONTROL_HEADERS = [
  "ID da Solicitação",
  "Status do E-mail",
  "Status da Aprovação",
  "Decidido por",
  "Data da Decisão",
  "Comentários / Reajustes",
  "Enviado para (Gestor)",
  "Token (não editar)",
  "Vaga Criada"
];

const STATUS = {
  PENDENTE: "PENDENTE",
  APROVADO: "APROVADO",
  REAJUSTE: "REAJUSTE SOLICITADO"
};

// [chave, rótulo no e-mail, possíveis cabeçalhos no formulário]
// A comparação ignora acentos, maiúsculas e ":" / "." no final.
const CAMPOS_SOLICITANTE = [
  ["ts", "Carimbo de data/hora", ["Carimbo de data/hora", "Timestamp"]],
  ["requesterEmail", "E-mail do solicitante", ["Endereço de e-mail", "Email", "E-mail"]],
  ["nome", "Nome completo", ["Nome Completo", "Nome"]],
  ["concordancia", "Declaração de concordância", ["Declaração de Concordância"]]
];

const CAMPOS_VAGA = [
  ["departamento", "Departamento", ["Departamento"]],
  ["quantidadeVagas", "Quantidade de vagas", ["Quantidade de Vagas"]],
  ["tituloCargo", "Título do cargo", ["Título do Cargo"]],
  ["dataLimite", "Data limite de inscrição", ["Data limite de inscrição"]],
  ["localidade", "Localidade", ["Localidade"]],
  ["tipoContrato", "Tipo de contrato", ["Tipo da Contrato", "Tipo do Contrato", "Tipo de Contrato"]],
  ["cargaHoraria", "Carga horária", ["Carga horária"]],
  ["remuneracao", "Remuneração / Bolsa", ["Remuneração / Bolsa"]],
  ["descricao", "Descrição geral da oportunidade", ["Descrição geral da oportunidade"]],
  ["habilidades", "Habilidades técnicas necessárias", ["Habilidades Técnicas Necessárias"]],
  ["principaisFuncoes", "Principais funções/atividades", ["Principais funções/atividades"]],
  ["tipoContratacao", "Tipo de contratação", ["Tipo de contratação"]],
  ["gestorResponsavel", "Gestor responsável", ["Gestor responsável"]],
  ["motivoSolicitacao", "Motivo da solicitação", ["Motivo da Solicitação"]],
  ["competencias", "Competências comportamentais desejadas", ["Competências Comportamentais Desejadas"]],
  ["observacoes", "Observações gerais", ["Observações Gerais"]]
];


// =================================================================
//  TRIGGER — Ao enviar formulário (gatilho instalável)
// =================================================================
function onForm1Submit(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== SHEET_FORM_RESPONSES) return;

  const row = e.range.getRow();
  if (row < 2) return;

  const sh = getSheetRespostas_();
  garantirColunasControle_(sh);

  const statusEmail = String(sh.getRange(row, COL_EMAIL_STATUS).getValue() || "").trim().toUpperCase();
  if (statusEmail.startsWith("EMAIL ENVIADO")) return;

  enviarParaAprovacao_(sh, row, "EMAIL ENVIADO");
}


// =================================================================
//  ENVIO DO E-MAIL DE APROVAÇÃO
// =================================================================
function enviarParaAprovacao_(sh, row, prefixoStatus) {
  const url = getWebAppUrl_();
  if (!url) {
    throw new Error(
      "App da Web não implantado. Vá em Implantar > Nova implantação > App da Web " +
      "e cole a URL /exec na constante WEBAPP_URL."
    );
  }

  // ID
  const idCell = sh.getRange(row, COL_SOLIC_ID);
  let solicId = String(idCell.getValue() || "").trim();
  if (!solicId) {
    solicId = generateSolicitacaoId_();
    idCell.setValue(solicId);
  }

  // Novo token (invalida links de envios anteriores) e status PENDENTE
  const token = Utilities.getUuid().replace(/-/g, "");
  sh.getRange(row, COL_APROV_STATUS, 1, 3).setValues([[STATUS.PENDENTE, "", ""]]);
  sh.getRange(row, COL_TOKEN).setValue(token);
  SpreadsheetApp.flush();

  const d = montarDados_(sh, row);
  const gestores = getGestoresPorDepartamento_(d.departamento);

  let to = gestores.map(g => g.email);
  let cc = [];
  if (!to.length) {
    to = [EMAIL_RH];
  } else if (RH_EM_COPIA && !to.some(e => e.toLowerCase() === EMAIL_RH.toLowerCase())) {
    cc = [EMAIL_RH];
  }

  const base = url + (url.indexOf("?") >= 0 ? "&" : "?");
  const links = {
    aprovar: `${base}acao=aprovar&id=${encodeURIComponent(solicId)}&token=${token}`,
    reajuste: `${base}acao=reajuste&id=${encodeURIComponent(solicId)}&token=${token}`
  };

  const semGestor = gestores.length === 0;
  const subject =
    `${semGestor ? "[SEM GESTOR] " : ""}📩 Aprovação necessária: ` +
    `${d.tituloCargo || "Nova solicitação de contratação"} (${solicId})`;

  const textBody =
`Nova solicitação de contratação (${solicId}) aguardando aprovação.

APROVAR:
${links.aprovar}

SOLICITAR REAJUSTES:
${links.reajuste}

${textoCampos_(d)}

Planilha de solicitações:
${LINK_PLANILHA_SOLICITACOES}
`;

  const opcoes = {
    to: to.join(","),
    subject,
    htmlBody: buildAprovacaoEmailHtml_(d, links, gestores),
    body: textBody,
    name: FROM_NAME_ADM,
    replyTo: EMAIL_RH
  };
  if (cc.length) opcoes.cc = cc.join(",");

  MailApp.sendEmail(opcoes);

  const ts = formatarData_(new Date());
  sh.getRange(row, COL_DESTINATARIOS).setValue(semGestor ? `${EMAIL_RH} (sem gestor cadastrado)` : to.join(", "));
  sh.getRange(row, COL_EMAIL_STATUS).setValue(`${prefixoStatus} - ${ts}`);

  return { solicId, para: opcoes.to };
}


// =================================================================
//  APP DA WEB — página de decisão (botões do e-mail)
// =================================================================
function doGet(e) {
  const p = (e && e.parameter) || {};
  const acao = ["aprovar", "reajuste", "vaga"].indexOf(p.acao) >= 0 ? p.acao : "";
  const id = String(p.id || "").trim();
  const token = String(p.token || "").trim();

  let info;
  try {
    info = carregarParaDecisao_(id, token);
  } catch (err) {
    info = { ok: false, erro: "Erro ao carregar a solicitação: " + err.message };
  }

  const tpl = HtmlService.createTemplateFromFile("Decisao");
  tpl.dataJson = JSON.stringify(Object.assign({ acao, id, token }, info)).replace(/</g, "\\u003c");

  return tpl.evaluate()
    .setTitle(id ? `Solicitação ${id} — Innomaker` : "Solicitação — Innomaker")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function carregarParaDecisao_(id, token) {
  if (!id || !token) {
    return { ok: false, erro: "Link incompleto. Abra a página pelo botão do e-mail original." };
  }

  const sh = getSheetRespostas_();
  const row = encontrarLinhaPorId_(sh, id);
  if (!row) return { ok: false, erro: `A solicitação ${id} não foi encontrada na planilha.` };

  const d = montarDados_(sh, row);
  if (!d.token || d.token !== token) {
    return {
      ok: false,
      erro: "Este link não é mais válido. A solicitação foi reenviada depois deste e-mail; use o botão do e-mail mais recente."
    };
  }

  return {
    ok: true,
    status: d.statusAprovacao || STATUS.PENDENTE,
    decididoPor: d.decididoPor,
    dataDecisao: d.dataDecisao,
    vagaCriada: d.vagaCriada,
    formConfigurado: !!FORM_ID_VAGAS,
    resumo: [
      ["Cargo", d.tituloCargo],
      ["Departamento", d.departamento],
      ["Quantidade de vagas", d.quantidadeVagas],
      ["Tipo de contratação", d.tipoContratacao],
      ["Remuneração / Bolsa", d.remuneracao],
      ["Localidade", d.localidade],
      ["Solicitante", d.nome],
      ["Gestor responsável", d.gestorResponsavel],
      ["Motivo", d.motivoSolicitacao]
    ].filter(r => r[1])
  };
}

// Chamada pela página Decisao.html (google.script.run) — por isso sem "_" no nome.
function processarDecisao(req) {
  req = req || {};
  const acao = String(req.acao || "");
  const id = String(req.id || "").trim();
  const token = String(req.token || "").trim();
  const comentario = String(req.comentario || "").trim().slice(0, 3000);

  if (["aprovar", "reajuste"].indexOf(acao) < 0) return { ok: false, erro: "Ação inválida." };
  if (acao === "reajuste" && comentario.length < 5) {
    return { ok: false, erro: "Descreva o que precisa ser ajustado antes de enviar." };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, erro: "O sistema está ocupado. Tente novamente em alguns segundos." };

  try {
    const sh = getSheetRespostas_();
    const row = encontrarLinhaPorId_(sh, id);
    if (!row) return { ok: false, erro: `A solicitação ${id} não foi encontrada.` };

    const d = montarDados_(sh, row);
    if (!d.token || d.token !== token) {
      return { ok: false, erro: "Este link não é mais válido. Use o botão do e-mail mais recente." };
    }
    if (d.statusAprovacao && d.statusAprovacao !== STATUS.PENDENTE) {
      return {
        ok: false,
        jaDecidido: true,
        erro: `Esta solicitação já foi decidida: ${d.statusAprovacao}` +
              (d.decididoPor ? ` por ${d.decididoPor}` : "") +
              (d.dataDecisao ? ` em ${d.dataDecisao}` : "") + "."
      };
    }

    return registrarDecisao_(sh, row, d, acao, comentario, identificarDecisor_(d));
  } catch (err) {
    Logger.log("processarDecisao: " + err.stack);
    return { ok: false, erro: "Não foi possível registrar a decisão: " + err.message };
  } finally {
    lock.releaseLock();
  }
}

function identificarDecisor_(d) {
  let email = "";
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  if (email) return email;
  return d.destinatarios ? `${d.destinatarios} (via link do e-mail)` : "Link do e-mail";
}


// =================================================================
//  REGISTRO DA DECISÃO (usado pelo Web App e pelo menu)
// =================================================================
function registrarDecisao_(sh, row, d, acao, comentario, quem) {
  const ts = formatarData_(new Date());
  let avisoEmail = "";

  if (acao === "aprovar") {
    // Cópia direta (opcional). Se falhar, a solicitação continua PENDENTE.
    const copia = COPIAR_DIRETO_PARA_DESTINO ? copiarParaDestino_(sh, row, d, quem, ts) : null;

    sh.getRange(row, COL_APROV_STATUS, 1, 3).setValues([[STATUS.APROVADO, quem, ts]]);
    if (comentario) acrescentarComentario_(sh, row, `[${ts}] APROVADO: ${comentario}`);

    try { enviarEmailDecisao_(d, "aprovar", comentario, quem, ts); }
    catch (err) { avisoEmail = " (Atenção: o e-mail de aviso não pôde ser enviado.)"; Logger.log(err); }

    let mensagem = `A solicitação ${d.solicId} foi aprovada. O solicitante e o RH foram avisados por e-mail.`;
    if (copia) mensagem += copia.duplicada ? " Ela já estava na planilha de vagas." : " Ela foi copiada para a planilha de vagas.";
    if (FORM_ID_VAGAS) mensagem += " Agora confira os dados da vaga e clique em Criar vaga.";

    return { ok: true, status: STATUS.APROVADO, mensagem: mensagem + avisoEmail };
  }

  sh.getRange(row, COL_APROV_STATUS, 1, 3).setValues([[STATUS.REAJUSTE, quem, ts]]);
  acrescentarComentario_(sh, row, `[${ts}] REAJUSTE: ${comentario}`);

  try { enviarEmailDecisao_(d, "reajuste", comentario, quem, ts); }
  catch (err) { avisoEmail = " (Atenção: o e-mail de aviso não pôde ser enviado.)"; Logger.log(err); }

  return {
    ok: true,
    status: STATUS.REAJUSTE,
    mensagem: `Os ajustes da solicitação ${d.solicId} foram enviados ao solicitante e ao RH.` + avisoEmail
  };
}

function acrescentarComentario_(sh, row, texto) {
  const cell = sh.getRange(row, COL_COMENTARIO);
  const atual = String(cell.getValue() || "").trim();
  cell.setValue(atual ? `${atual}\n${texto}` : texto);
}


// =================================================================
//  CÓPIA PARA A PLANILHA DE VAGAS (FORM1_RESPOSTAS)
// =================================================================
function copiarParaDestino_(sh, row, d, quem, ts) {
  const shDest = SpreadsheetApp.openById(SPREADSHEET_ID_DESTINO).getSheetByName(SHEET_DESTINO);
  if (!shDest) throw new Error(`Aba '${SHEET_DESTINO}' não encontrada na planilha de destino.`);

  const srcHeaders = sh.getRange(1, 1, 1, ULTIMA_COL_FORM).getDisplayValues()[0];
  const srcValues = sh.getRange(row, 1, 1, ULTIMA_COL_FORM).getValues()[0];

  const extras = [
    ["ID da Solicitação", d.solicId],
    ["Status da Aprovação", STATUS.APROVADO],
    ["Aprovado por", quem],
    ["Data da Aprovação", ts]
  ];

  // valor por cabeçalho normalizado
  const mapa = {};
  srcHeaders.forEach((h, i) => {
    const k = normalizar_(h);
    if (k && !(k in mapa)) mapa[k] = srcValues[i];
  });
  extras.forEach(([h, v]) => { mapa[normalizar_(h)] = v; });

  const dePara = {};
  Object.keys(DE_PARA_DESTINO).forEach(k => { dePara[normalizar_(k)] = normalizar_(DE_PARA_DESTINO[k]); });

  // Cabeçalhos do destino
  let destHeaders;
  if (shDest.getLastRow() === 0) {
    destHeaders = srcHeaders.filter(h => String(h).trim()).concat(extras.map(x => x[0]));
    shDest.getRange(1, 1, 1, destHeaders.length).setValues([destHeaders]);
  } else {
    destHeaders = shDest.getRange(1, 1, 1, shDest.getLastColumn()).getDisplayValues()[0];
    const existentes = new Set(destHeaders.map(normalizar_));
    const faltantes = extras.map(x => x[0]).filter(h => !existentes.has(normalizar_(h)));
    if (faltantes.length) {
      const inicio = destHeaders.length + 1;
      const fim = inicio + faltantes.length - 1;
      if (shDest.getMaxColumns() < fim) {
        shDest.insertColumnsAfter(shDest.getMaxColumns(), fim - shDest.getMaxColumns());
      }
      shDest.getRange(1, inicio, 1, faltantes.length).setValues([faltantes]);
      destHeaders = destHeaders.concat(faltantes);
    }
  }

  // Não duplica: se o ID já existe no destino, não copia de novo
  const idxId = destHeaders.map(normalizar_).indexOf(normalizar_("ID da Solicitação"));
  const lastRow = shDest.getLastRow();
  if (idxId >= 0 && lastRow >= 2) {
    const ids = shDest.getRange(2, idxId + 1, lastRow - 1, 1).getDisplayValues().map(r => String(r[0]).trim());
    const pos = ids.indexOf(d.solicId);
    if (pos >= 0) return { duplicada: true, linha: pos + 2 };
  }

  const linha = destHeaders.map(h => {
    const k = normalizar_(h);
    const origem = dePara[k] || k;
    return origem in mapa ? mapa[origem] : "";
  });

  shDest.appendRow(linha);
  return { duplicada: false, linha: shDest.getLastRow() };
}


// =================================================================
//  E-MAILS
// =================================================================
function buildAprovacaoEmailHtml_(d, links, gestores) {
  const nomes = gestores.map(g => g.nome || g.email).join(", ");

  const aviso = gestores.length ? "" : `
    <div style="padding:18px 26px 0;">
      <div style="background:#FFF7E6; border:1px solid #F5C26B; border-radius:12px; padding:12px 14px; font-size:13px; color:#7A4B00; line-height:1.6;">
        <strong>Atenção, RH:</strong> não há gestor cadastrado na aba EMAIL para o departamento
        "${escapeHtml_(d.departamento || "(vazio)")}". Este e-mail foi enviado só para o RH.
        Cadastre o gestor e use o menu “Enviar/Reenviar para aprovação”, ou decida por aqui mesmo.
      </div>
    </div>`;

  const intro =
    (nomes ? `Olá, ${escapeHtml_(nomes)}. ` : "") +
    `Uma nova solicitação de contratação para <strong>${escapeHtml_(d.tituloCargo || "cargo não informado")}</strong> ` +
    `aguarda sua aprovação. Revise os dados e escolha uma opção.`;

  const conteudo =
    aviso +
    blocoBotoesAprovacao_(links) +
    secaoTabela_("Dados do solicitante", linhasDe_(CAMPOS_SOLICITANTE, d)) +
    secaoTabela_("Dados da vaga", linhasDe_(CAMPOS_VAGA, d)) +
    blocoBotoesAprovacao_(links) +
    `<div style="padding:4px 26px 8px; font-size:12px; line-height:1.6; color:#6B6B6B;">
       Planilha de solicitações (RH):
       <a href="${escapeHtml_(LINK_PLANILHA_SOLICITACOES)}" target="_blank" style="color:#2F8A28;">abrir planilha</a>
     </div>`;

  return emailShell_({
    kicker: "Innomaker • ATS • Aprovação",
    titulo: "Nova solicitação de contratação",
    badge: `ID ${escapeHtml_(d.solicId)}`,
    intro,
    conteudo
  });
}

function blocoBotoesAprovacao_(links) {
  return `
  <div style="padding:18px 26px 8px;">
    <div style="border:2px solid rgba(65,166,57,.35); background:rgba(65,166,57,.06); border-radius:16px; padding:18px;">
      <div style="font-size:16px; font-weight:800; color:#242122; margin-bottom:4px;">Sua decisão</div>
      <div style="font-size:13px; color:#6B6B6B; line-height:1.6; margin-bottom:14px;">
        Você confirma a decisão na página que abrir.
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:0 10px 8px 0;">
            <a href="${escapeHtml_(links.aprovar)}" target="_blank"
               style="display:inline-block; background:#41A639; color:#FFFFFF; text-decoration:none; font-weight:800; font-size:15px; padding:14px 24px; border-radius:999px;">
              ✅ Aprovar
            </a>
          </td>
          <td style="padding:0 0 8px 0;">
            <a href="${escapeHtml_(links.reajuste)}" target="_blank"
               style="display:inline-block; background:#FFFFFF; color:#9A5B00; text-decoration:none; font-weight:800; font-size:15px; padding:12px 22px; border-radius:999px; border:2px solid #E8A33D;">
              ✏️ Solicitar reajustes
            </a>
          </td>
        </tr>
      </table>
    </div>
  </div>`;
}

function enviarEmailDecisao_(d, acao, comentario, quem, ts) {
  const aprovado = acao === "aprovar";
  const to = emailValido_(d.requesterEmail) ? d.requesterEmail : EMAIL_RH;
  const cc = to.toLowerCase() === EMAIL_RH.toLowerCase() ? "" : EMAIL_RH;
  const ola = `Olá${d.nome ? ", " + escapeHtml_(primeiroNome_(d.nome)) : ""}!`;

  const titulo = aprovado ? "Solicitação aprovada" : "Reajustes solicitados";
  const subject = `${aprovado ? "✅" : "✏️"} ${titulo} (${d.solicId}) — ${d.tituloCargo || "Solicitação de contratação"}`;

  const intro = aprovado
    ? `${ola} Sua solicitação de contratação foi <strong>aprovada</strong> e seguiu para a abertura da vaga com o RH.`
    : `${ola} Sua solicitação de contratação foi analisada e precisa de <strong>alguns ajustes</strong> antes da aprovação.`;

  const caixa = comentario ? `
    <div style="padding:18px 26px 0;">
      <div style="background:${aprovado ? "rgba(65,166,57,.08)" : "#FFF7E6"}; border:1px solid ${aprovado ? "rgba(65,166,57,.30)" : "#F5C26B"}; border-radius:14px; padding:14px 16px;">
        <div style="font-size:13px; font-weight:800; color:#6B6B6B; margin-bottom:6px;">
          ${aprovado ? "Observação do gestor" : "O que precisa ser ajustado"}
        </div>
        <div style="font-size:14px; line-height:1.7; color:#242122;">${escapeHtml_(comentario).replace(/\n/g, "<br>")}</div>
      </div>
    </div>` : "";

  const proximo = aprovado
    ? "O RH dará sequência à criação da vaga."
    : "Responda este e-mail ao RH com as correções. Depois de ajustada, a solicitação será reenviada para aprovação.";

  const url = getWebAppUrl_();
  const botaoVaga = (aprovado && FORM_ID_VAGAS && url && d.token) ? `
    <div style="padding:16px 26px 0;">
      <a href="${escapeHtml_(url + (url.indexOf("?") >= 0 ? "&" : "?") + "acao=vaga&id=" + encodeURIComponent(d.solicId) + "&token=" + d.token)}" target="_blank"
         style="display:inline-block; background:#41A639; color:#FFFFFF; text-decoration:none; font-weight:800; font-size:15px; padding:14px 24px; border-radius:999px;">
        📝 Criar a vaga (formulário pré-preenchido)
      </a>
      <div style="margin-top:8px; font-size:12px; color:#6B6B6B; line-height:1.6;">
        Se a vaga já tiver sido criada, a página mostra isso e não deixa duplicar.
      </div>
    </div>` : "";

  const conteudo =
    caixa +
    botaoVaga +
    secaoTabela_("Resumo", [
      ["ID", d.solicId],
      ["Cargo", d.tituloCargo],
      ["Departamento", d.departamento],
      ["Quantidade de vagas", d.quantidadeVagas],
      ["Decidido por", quem],
      ["Data", ts]
    ]) +
    `<div style="padding:12px 26px 8px; font-size:14px; line-height:1.7; color:#242122;">
       <strong>Próximo passo:</strong> ${proximo}
     </div>`;

  const body =
`${titulo} (${d.solicId})

Cargo: ${d.tituloCargo || "-"}
Departamento: ${d.departamento || "-"}
Decidido por: ${quem}
Data: ${ts}
${comentario ? `\n${aprovado ? "Observação" : "Ajustes solicitados"}:\n${comentario}\n` : ""}
Próximo passo: ${proximo}
`;

  const opcoes = {
    to,
    subject,
    htmlBody: emailShell_({
      kicker: "Innomaker • ATS • Solicitações",
      titulo,
      badge: `ID ${escapeHtml_(d.solicId)}`,
      intro,
      conteudo
    }),
    body,
    name: FROM_NAME_ADM,
    replyTo: EMAIL_RH
  };
  if (cc) opcoes.cc = cc;

  MailApp.sendEmail(opcoes);
}

// Estrutura visual comum a todos os e-mails (textos já escapados)
function emailShell_(o) {
  const dark = "#242122";
  const muted = "#6B6B6B";
  const border = "rgba(36,33,34,.10)";

  return `
  <div style="margin:0; padding:28px 12px; background:#EEF2EF; font-family:Arial, Helvetica, sans-serif;">
    <div style="max-width:760px; margin:0 auto; background:#FFFFFF; border:1px solid ${border}; border-radius:18px; overflow:hidden;">
      <div style="background:${dark}; padding:22px 26px;">
        <div style="font-size:12px; letter-spacing:.06em; color:rgba(255,255,255,.70); font-weight:700;">${o.kicker}</div>
        <div style="margin-top:8px; font-size:24px; line-height:1.25; color:#FFFFFF; font-weight:800;">${o.titulo}</div>
        ${o.badge ? `<div style="margin-top:10px; display:inline-block; padding:7px 12px; border-radius:999px; background:rgba(65,166,57,.22); color:#CFEBCB; font-size:12px; font-weight:800;">${o.badge}</div>` : ""}
      </div>
      ${o.intro ? `<div style="padding:22px 26px 4px;"><p style="margin:0; font-size:14px; line-height:1.7; color:${muted};">${o.intro}</p></div>` : ""}
      ${o.conteudo || ""}
      <div style="padding:8px 26px 22px; font-size:12px; color:${muted};">
        Enviado automaticamente pelo sistema ATS Innomaker.
      </div>
    </div>
  </div>`;
}

function secaoTabela_(titulo, linhas) {
  const rows = linhas.map(([label, valor]) => `
    <tr>
      <td style="padding:9px 12px 9px 0; width:210px; color:#6B6B6B; font-weight:700; vertical-align:top; font-size:13px;">${escapeHtml_(label)}</td>
      <td style="padding:9px 0; color:#242122; vertical-align:top; font-size:14px; line-height:1.5;">${escapeHtml_(valor || "(não informado)").replace(/\n/g, "<br>")}</td>
    </tr>`).join("");

  return `
  <div style="padding:16px 26px 6px;">
    <div style="font-size:15px; font-weight:800; color:#242122; margin-bottom:10px;">${escapeHtml_(titulo)}</div>
    <div style="background:#F7F8F7; border:1px solid rgba(36,33,34,.10); border-radius:14px; padding:8px 16px;">
      <table role="presentation" style="width:100%; border-collapse:collapse;">${rows}</table>
    </div>
  </div>`;
}

function linhasDe_(campos, d) {
  return campos.map(([k, label]) => [label, d[k]]);
}

function textoCampos_(d) {
  const bloco = campos => campos.map(([k, l]) => `${l}: ${d[k] || "(não informado)"}`).join("\n");
  return `DADOS DO SOLICITANTE\n${bloco(CAMPOS_SOLICITANTE)}\n\nDADOS DA VAGA\n${bloco(CAMPOS_VAGA)}`;
}


// =================================================================
//  LEITURA DE DADOS
// =================================================================
function getSheetRespostas_() {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID_NOTIFICACOES).getSheetByName(SHEET_FORM_RESPONSES);
  if (!sh) throw new Error(`Aba '${SHEET_FORM_RESPONSES}' não encontrada.`);
  return sh;
}

function montarDados_(sh, row) {
  const lastCol = Math.max(sh.getLastColumn(), ULTIMA_COL_CONTROLE);
  const headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const valores = sh.getRange(row, 1, 1, lastCol).getDisplayValues()[0];

  const porHeader = {};
  for (let c = 0; c < ULTIMA_COL_FORM; c++) {
    const k = normalizar_(headers[c]);
    if (k && !(k in porHeader)) porHeader[k] = String(valores[c] || "").trim();
  }

  const d = { row };
  CAMPOS_SOLICITANTE.concat(CAMPOS_VAGA).forEach(([key, , aliases]) => {
    d[key] = "";
    for (const a of aliases) {
      const v = porHeader[normalizar_(a)];
      if (v) { d[key] = v; break; }
    }
  });

  const col = n => String(valores[n - 1] || "").trim();
  d.solicId = col(COL_SOLIC_ID);
  d.statusEmail = col(COL_EMAIL_STATUS);
  d.statusAprovacao = col(COL_APROV_STATUS).toUpperCase();
  d.decididoPor = col(COL_DECISAO_POR);
  d.dataDecisao = col(COL_DECISAO_DATA);
  d.destinatarios = col(COL_DESTINATARIOS);
  d.token = col(COL_TOKEN);
  d.vagaCriada = col(COL_VAGA);
  return d;
}

function encontrarLinhaPorId_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return 0;
  const ids = sh.getRange(2, COL_SOLIC_ID, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return i + 2;
  }
  return 0;
}

// Aba EMAIL: aceita vários gestores por departamento (várias linhas,
// ou vários e-mails na mesma célula separados por vírgula/ponto e vírgula)
function getGestoresPorDepartamento_(departamento) {
  const alvo = normalizar_(departamento);
  if (!alvo) return [];

  const sh = SpreadsheetApp.openById(SPREADSHEET_ID_NOTIFICACOES).getSheetByName(SHEET_EMAIL_ADM);
  if (!sh) throw new Error(`Aba '${SHEET_EMAIL_ADM}' não encontrada.`);

  const last = sh.getLastRow();
  if (last < 2) return [];

  const nCols = Math.max(EMAIL_COL_DEPARTAMENTO, EMAIL_COL_GESTOR, EMAIL_COL_EMAIL);
  const valores = sh.getRange(2, 1, last - 1, nCols).getDisplayValues();

  const out = [];
  const vistos = new Set();
  valores.forEach(r => {
    if (normalizar_(r[EMAIL_COL_DEPARTAMENTO - 1]) !== alvo) return;
    const nome = String(r[EMAIL_COL_GESTOR - 1] || "").trim();
    String(r[EMAIL_COL_EMAIL - 1] || "")
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(emailValido_)
      .forEach(email => {
        const k = email.toLowerCase();
        if (!vistos.has(k)) { vistos.add(k); out.push({ nome, email }); }
      });
  });
  return out;
}


// =================================================================
//  CRIAÇÃO DA VAGA — formulário de vagas pré-preenchido
// =================================================================
function validarAcesso_(id, token) {
  if (!id || !token) return { erro: "Link incompleto. Abra a página pelo botão do e-mail." };
  const sh = getSheetRespostas_();
  const row = encontrarLinhaPorId_(sh, id);
  if (!row) return { erro: `A solicitação ${id} não foi encontrada.` };
  const d = montarDados_(sh, row);
  if (!d.token || d.token !== token) return { erro: "Este link não é mais válido. Use o botão do e-mail mais recente." };
  return { sh, row, d };
}

function getFormVagas_() {
  if (!FORM_ID_VAGAS) throw new Error("Formulário de vagas não configurado (constante FORM_ID_VAGAS vazia).");
  return FormApp.openById(FORM_ID_VAGAS);
}

// Chamada pela página (google.script.run): devolve as perguntas do formulário já preenchidas
function carregarFormularioVaga(req) {
  req = req || {};
  try {
    const a = validarAcesso_(String(req.id || "").trim(), String(req.token || "").trim());
    if (a.erro) return { ok: false, erro: a.erro };
    if (a.d.statusAprovacao !== STATUS.APROVADO) {
      return { ok: false, erro: "A vaga só pode ser criada depois que a solicitação for aprovada." };
    }
    if (a.d.vagaCriada) return { ok: false, jaCriada: true, erro: `A vaga desta solicitação já foi criada (${a.d.vagaCriada}).` };

    const form = getFormVagas_();
    const gestores = getGestoresPorDepartamento_(a.d.departamento);
    const fonte = Object.assign({}, a.d, { statusVagaPadrao: STATUS_VAGA_PADRAO });

    const campos = lerItensFormVaga_(form).map(c => {
      if (c.tipo !== "SECAO" && c.tipo !== "NAO_SUPORTADO") c.valor = valorPrefill_(c, fonte, gestores);
      return c;
    });

    return { ok: true, titulo: form.getTitle(), campos, linkPreenchido: gerarLinkPreenchido_(form, campos) };
  } catch (err) {
    Logger.log("carregarFormularioVaga: " + err.stack);
    return { ok: false, erro: "Não foi possível carregar o formulário da vaga: " + err.message };
  }
}

// Chamada pela página (google.script.run): envia a resposta ao formulário de vagas
function criarVaga(req) {
  req = req || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, erro: "O sistema está ocupado. Tente novamente em alguns segundos." };

  try {
    const a = validarAcesso_(String(req.id || "").trim(), String(req.token || "").trim());
    if (a.erro) return { ok: false, erro: a.erro };
    if (a.d.statusAprovacao !== STATUS.APROVADO) return { ok: false, erro: "A solicitação ainda não foi aprovada." };
    if (a.d.vagaCriada) return { ok: false, jaCriada: true, erro: `A vaga desta solicitação já foi criada (${a.d.vagaCriada}).` };

    const form = getFormVagas_();
    const respostas = req.respostas || {};
    const resposta = form.createResponse();
    const faltando = [];
    const invalidos = [];
    let tituloVaga = "";

    form.getItems().forEach(item => {
      const v = respostas[String(item.getId())];
      if (vazio_(v)) {
        if (itemObrigatorio_(item)) faltando.push(item.getTitle());
        return;
      }
      try {
        const ir = criarItemResponse_(item, v);
        if (ir) resposta.withItemResponse(ir);
        if (!tituloVaga && normalizar_(item.getTitle()).indexOf("titulo da vaga") === 0) tituloVaga = String(v);
      } catch (e) {
        invalidos.push(`${item.getTitle()} (${e.message})`);
      }
    });

    if (faltando.length) return { ok: false, erro: "Preencha os campos obrigatórios: " + faltando.join(", ") + "." };
    if (invalidos.length) return { ok: false, erro: "Revise estes campos: " + invalidos.join("; ") + "." };

    resposta.submit();

    let quem = "";
    try { quem = Session.getActiveUser().getEmail(); } catch (e) {}
    const ts = formatarData_(new Date());
    a.sh.getRange(a.row, COL_VAGA).setValue(`VAGA CRIADA - ${ts}${quem ? " - " + quem : ""}`);

    return {
      ok: true,
      mensagem: `A vaga "${tituloVaga || a.d.tituloCargo || a.d.solicId}" foi enviada pelo formulário de vagas ` +
                `e registrada na solicitação ${a.d.solicId}.`
    };
  } catch (err) {
    Logger.log("criarVaga: " + err.stack);
    return { ok: false, erro: "Não foi possível criar a vaga: " + err.message };
  } finally {
    lock.releaseLock();
  }
}

function lerItensFormVaga_(form) {
  const T = FormApp.ItemType;
  return form.getItems().map(item => {
    const t = item.getType();
    const c = {
      id: String(item.getId()),
      titulo: item.getTitle() || "",
      ajuda: item.getHelpText() || "",
      obrigatorio: false,
      opcoes: [],
      outro: false
    };

    if (t == T.TEXT) { c.tipo = "TEXT"; c.obrigatorio = item.asTextItem().isRequired(); }
    else if (t == T.PARAGRAPH_TEXT) { c.tipo = "PARAGRAPH"; c.obrigatorio = item.asParagraphTextItem().isRequired(); }
    else if (t == T.MULTIPLE_CHOICE) {
      const it = item.asMultipleChoiceItem();
      c.tipo = "MULTIPLE_CHOICE"; c.obrigatorio = it.isRequired();
      c.opcoes = it.getChoices().map(x => x.getValue()); c.outro = it.hasOtherOption();
    }
    else if (t == T.LIST) {
      const it = item.asListItem();
      c.tipo = "LIST"; c.obrigatorio = it.isRequired();
      c.opcoes = it.getChoices().map(x => x.getValue());
    }
    else if (t == T.CHECKBOX) {
      const it = item.asCheckboxItem();
      c.tipo = "CHECKBOX"; c.obrigatorio = it.isRequired();
      c.opcoes = it.getChoices().map(x => x.getValue()); c.outro = it.hasOtherOption();
    }
    else if (t == T.DATE) { c.tipo = "DATE"; c.obrigatorio = item.asDateItem().isRequired(); }
    else if (t == T.SECTION_HEADER || t == T.PAGE_BREAK) { c.tipo = "SECAO"; }
    else { c.tipo = "NAO_SUPORTADO"; }

    return c;
  });
}

function itemObrigatorio_(item) {
  const T = FormApp.ItemType;
  const t = item.getType();
  if (t == T.TEXT) return item.asTextItem().isRequired();
  if (t == T.PARAGRAPH_TEXT) return item.asParagraphTextItem().isRequired();
  if (t == T.MULTIPLE_CHOICE) return item.asMultipleChoiceItem().isRequired();
  if (t == T.LIST) return item.asListItem().isRequired();
  if (t == T.CHECKBOX) return item.asCheckboxItem().isRequired();
  if (t == T.DATE) return item.asDateItem().isRequired();
  return false;
}

function criarItemResponse_(item, v) {
  const T = FormApp.ItemType;
  const t = item.getType();
  if (t == T.TEXT) return item.asTextItem().createResponse(String(v));
  if (t == T.PARAGRAPH_TEXT) return item.asParagraphTextItem().createResponse(String(v));
  if (t == T.MULTIPLE_CHOICE) return item.asMultipleChoiceItem().createResponse(String(v));
  if (t == T.LIST) return item.asListItem().createResponse(String(v));
  if (t == T.CHECKBOX) return item.asCheckboxItem().createResponse([].concat(v).map(String));
  if (t == T.DATE) {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error("data inválida");
    return item.asDateItem().createResponse(new Date(+m[1], +m[2] - 1, +m[3], 12));
  }
  return null;
}

function valorPrefill_(c, fonte, gestores) {
  const t = normalizar_(c.titulo);
  let chave = "";
  Object.keys(MAPA_PREFILL_VAGA).some(k => {
    const nk = normalizar_(k);
    if (t === nk || t.indexOf(nk) === 0) { chave = MAPA_PREFILL_VAGA[k]; return true; }
    return false;
  });

  let valor = chave ? String(fonte[chave] || "").trim() : "";
  if (!valor && chave === "gestorResponsavel" && gestores.length) valor = gestores[0].nome || "";
  if (!valor) return c.tipo === "CHECKBOX" ? [] : "";

  if (c.tipo === "DATE") return paraIsoData_(valor);
  if (c.tipo === "MULTIPLE_CHOICE" || c.tipo === "LIST") return casarOpcao_(valor, c.opcoes) || (c.outro ? valor : "");
  if (c.tipo === "CHECKBOX") {
    const nv = normalizar_(valor);
    return c.opcoes.filter(o => nv.indexOf(normalizar_(o)) >= 0);
  }
  return valor;
}

function casarOpcao_(valor, opcoes) {
  const v = normalizar_(valor);
  if (!v) return "";
  return opcoes.find(o => normalizar_(o) === v) ||
         opcoes.find(o => { const n = normalizar_(o); return n && (n.indexOf(v) >= 0 || v.indexOf(n) >= 0); }) ||
         "";
}

function paraIsoData_(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function gerarLinkPreenchido_(form, campos) {
  try {
    const r = form.createResponse();
    campos.forEach(c => {
      if (vazio_(c.valor)) return;
      try {
        const ir = criarItemResponse_(form.getItemById(Number(c.id)), c.valor);
        if (ir) r.withItemResponse(ir);
      } catch (e) {}
    });
    return r.toPrefilledUrl();
  } catch (e) {
    return LINK_FORM_VAGAS;
  }
}

function vazio_(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.filter(x => String(x).trim()).length === 0;
  return String(v).trim() === "";
}

// Abre o formulário da vaga como janela dentro da planilha (menu / aprovação manual)
function abrirDialogVaga_(sh, row) {
  const ui = SpreadsheetApp.getUi();
  const d = montarDados_(sh, row);

  if (d.statusAprovacao !== STATUS.APROVADO) { ui.alert("Aprove a solicitação antes de criar a vaga."); return; }
  if (d.vagaCriada) { ui.alert(`A vaga desta solicitação já foi criada (${d.vagaCriada}).`); return; }
  if (!FORM_ID_VAGAS) { ui.alert("Preencha a constante FORM_ID_VAGAS no código para criar vagas por aqui."); return; }

  let token = d.token;
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, "");
    sh.getRange(row, COL_TOKEN).setValue(token);
    SpreadsheetApp.flush();
  }

  const info = carregarParaDecisao_(d.solicId, token);
  const tpl = HtmlService.createTemplateFromFile("Decisao");
  tpl.dataJson = JSON.stringify(Object.assign({ acao: "vaga", id: d.solicId, token, modo: "dialog" }, info))
    .replace(/</g, "\\u003c");

  ui.showModalDialog(tpl.evaluate().setWidth(780).setHeight(720), `Criar vaga — ${d.solicId}`);
}

function menuCriarVagaLinhaSelecionada() {
  const sel = getLinhaSelecionada_();
  if (!sel) return;
  abrirDialogVaga_(sel.sh, sel.row);
}


// =================================================================
//  ID SEQUENCIAL
// =================================================================
function generateSolicitacaoId_() {
  const year = new Date().getFullYear();
  const key = `solicitacao_seq_${year}`;

  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const cur = parseInt(props.getProperty(key) || "0", 10) || 0;
    const next = cur + 1;
    props.setProperty(key, String(next));
    return `SOL-${year}-${String(next).padStart(6, "0")}`;
  } finally {
    lock.releaseLock();
  }
}


// =================================================================
//  COLUNAS DE CONTROLE
// =================================================================
function garantirColunasControle_(sh) {
  if (sh.getMaxColumns() < ULTIMA_COL_CONTROLE) {
    sh.insertColumnsAfter(sh.getMaxColumns(), ULTIMA_COL_CONTROLE - sh.getMaxColumns());
  }

  const atuais = sh.getRange(1, COL_SOLIC_ID, 1, CONTROL_HEADERS.length).getDisplayValues()[0];
  const diferente = atuais.some((v, i) => String(v).trim() !== CONTROL_HEADERS[i]);

  if (diferente) {
    const tokenEraNovo = String(atuais[COL_TOKEN - COL_SOLIC_ID]).trim() !== CONTROL_HEADERS[COL_TOKEN - COL_SOLIC_ID];
    sh.getRange(1, COL_SOLIC_ID, 1, CONTROL_HEADERS.length).setValues([CONTROL_HEADERS]);
    if (tokenEraNovo) sh.hideColumns(COL_TOKEN);
  }
}


// =================================================================
//  MENU
// =================================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_FORM_RESPONSES);
    if (sh) garantirColunasControle_(sh);
  } catch (err) {
    Logger.log("Erro ao garantir colunas de controle no onOpen: " + err);
  }

  ui.createMenu("📌 ATS — Solicitações")
    .addItem("📧 Enviar/Reenviar para aprovação (linha selecionada)", "menuReenviarEmailLinhaSelecionada")
    .addItem("✅ Aprovar manualmente (linha selecionada)", "menuAprovarManual")
    .addItem("✏️ Solicitar reajustes manualmente (linha selecionada)", "menuReajusteManual")
    .addItem("📝 Criar vaga (linha selecionada)", "menuCriarVagaLinhaSelecionada")
    .addItem("☑️ Marcar e-mail como enviado (linha selecionada)", "menuMarcarComoEnviadoManual")
    .addSeparator()
    .addItem("🔎 Verificar pendências", "menuVerificarPendenciasEmails")
    .addItem("⚙️ Testar configuração", "testarConfiguracao")
    .addSeparator()
    .addItem("📘 Abrir Manual do Sistema", "menuAbrirManualSolicitacoes")
    .addToUi();
}

function getLinhaSelecionada_() {
  const ui = SpreadsheetApp.getUi();
  const ativa = SpreadsheetApp.getActiveSheet();

  if (ativa.getName() !== SHEET_FORM_RESPONSES) {
    ui.alert(`Abra a aba "${SHEET_FORM_RESPONSES}" e selecione uma linha (não o cabeçalho).`);
    return null;
  }

  const range = ativa.getActiveRange();
  const row = range ? range.getRow() : 0;
  if (row < 2 || row > ativa.getLastRow()) {
    ui.alert("Selecione uma linha com dados (não o cabeçalho).");
    return null;
  }
  if (range.getNumRows() > 1) {
    ui.alert("Selecione apenas uma linha por vez.");
    return null;
  }

  const sh = getSheetRespostas_();
  garantirColunasControle_(sh);
  return { sh, row };
}

// AÇÃO 1 — Enviar / reenviar para aprovação
function menuReenviarEmailLinhaSelecionada() {
  const ui = SpreadsheetApp.getUi();
  const sel = getLinhaSelecionada_();
  if (!sel) return;

  const status = String(sel.sh.getRange(sel.row, COL_APROV_STATUS).getValue() || "").trim().toUpperCase();
  if (status === STATUS.APROVADO) {
    const r = ui.alert(
      "Solicitação já aprovada",
      "Reenviar vai voltar esta solicitação para PENDENTE e pedir uma nova decisão ao gestor. Continuar?",
      ui.ButtonSet.YES_NO
    );
    if (r !== ui.Button.YES) return;
  }

  const prefixo = sel.sh.getRange(sel.row, COL_EMAIL_STATUS).getValue() ? "EMAIL ENVIADO (REENVIO)" : "EMAIL ENVIADO";
  const res = enviarParaAprovacao_(sel.sh, sel.row, prefixo);
  SpreadsheetApp.getActiveSpreadsheet().toast(`${res.solicId} enviado para: ${res.para}`, "E-mail de aprovação enviado ✅", 8);
}

// AÇÃO 2 / 3 — Decisão manual pelo RH
function menuAprovarManual() { decisaoManual_("aprovar"); }
function menuReajusteManual() { decisaoManual_("reajuste"); }

function decisaoManual_(acao) {
  const ui = SpreadsheetApp.getUi();
  const sel = getLinhaSelecionada_();
  if (!sel) return;
  const { sh, row } = sel;

  const d = montarDados_(sh, row);
  if (d.statusAprovacao === STATUS.APROVADO) {
    ui.alert(`Esta solicitação já está APROVADA${d.solicId ? ` (${d.solicId})` : ""}.`);
    return;
  }

  let comentario = "";
  if (acao === "aprovar") {
    const r = ui.alert(
      "Aprovar solicitação",
      `Aprovar "${d.tituloCargo || "(sem título)"}" (linha ${row})?\nEla será copiada para a aba ${SHEET_DESTINO} da planilha de vagas.`,
      ui.ButtonSet.YES_NO
    );
    if (r !== ui.Button.YES) return;
  } else {
    const r = ui.prompt(
      "Solicitar reajustes",
      "Descreva o que precisa ser ajustado (o texto vai por e-mail ao solicitante e ao RH):",
      ui.ButtonSet.OK_CANCEL
    );
    if (r.getSelectedButton() !== ui.Button.OK) return;
    comentario = r.getResponseText().trim();
    if (comentario.length < 5) { ui.alert("Descreva os ajustes antes de enviar."); return; }
  }

  if (!d.solicId) {
    d.solicId = generateSolicitacaoId_();
    sh.getRange(row, COL_SOLIC_ID).setValue(d.solicId);
  }

  let quem = "";
  try { quem = Session.getActiveUser().getEmail(); } catch (e) {}
  quem = `${quem || "Usuário da planilha"} (manual)`;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const res = registrarDecisao_(sh, row, d, acao, comentario, quem);
    SpreadsheetApp.getActiveSpreadsheet().toast(res.mensagem, "ATS — Solicitações", 8);
  } finally {
    lock.releaseLock();
  }

  // Logo após aprovar, abre o formulário da vaga pré-preenchido
  if (acao === "aprovar" && FORM_ID_VAGAS) abrirDialogVaga_(sh, row);
}

// AÇÃO 4 — Marcar e-mail como enviado (sem enviar)
function menuMarcarComoEnviadoManual() {
  const sel = getLinhaSelecionada_();
  if (!sel) return;
  const { sh, row } = sel;

  const idCell = sh.getRange(row, COL_SOLIC_ID);
  if (!String(idCell.getValue() || "").trim()) idCell.setValue(generateSolicitacaoId_());

  sh.getRange(row, COL_EMAIL_STATUS).setValue(`EMAIL ENVIADO (MANUAL) - ${formatarData_(new Date())}`);
  SpreadsheetApp.getActiveSpreadsheet().toast("Marcado como enviado ✅", "ATS — Solicitações", 6);
}

// AÇÃO 5 — Pendências
function menuVerificarPendenciasEmails() {
  const ui = SpreadsheetApp.getUi();
  const sh = getSheetRespostas_();
  garantirColunasControle_(sh);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) { ui.alert("Nenhuma resposta encontrada ainda."); return; }

  const values = sh.getRange(2, 1, lastRow - 1, ULTIMA_COL_CONTROLE).getDisplayValues();
  let semId = 0, emailPendente = 0, aguardando = 0, aprovadas = 0, reajustes = 0;

  values.forEach(r => {
    const id = String(r[COL_SOLIC_ID - 1]).trim();
    const email = String(r[COL_EMAIL_STATUS - 1]).trim().toUpperCase();
    const aprov = String(r[COL_APROV_STATUS - 1]).trim().toUpperCase();

    if (!id) semId++;
    if (!email.startsWith("EMAIL ENVIADO")) emailPendente++;
    if (aprov === STATUS.APROVADO) aprovadas++;
    else if (aprov === STATUS.REAJUSTE) reajustes++;
    else if (email.startsWith("EMAIL ENVIADO")) aguardando++;
  });

  ui.alert(
    "Pendências",
    `Total de solicitações: ${lastRow - 1}\n\n` +
    `Sem e-mail enviado: ${emailPendente}\n` +
    `Sem ID (coluna U vazia): ${semId}\n\n` +
    `Aguardando decisão do gestor: ${aguardando}\n` +
    `Com reajuste solicitado: ${reajustes}\n` +
    `Aprovadas: ${aprovadas}\n\n` +
    `Dica: selecione uma linha e use o menu para reenviar ou decidir manualmente.`,
    ui.ButtonSet.OK
  );
}

// AÇÃO 6 — Teste de configuração (rode também pelo editor para autorizar)
function testarConfiguracao() {
  const linhas = [];
  const marca = (ok, t) => linhas.push(`${ok ? "✅" : "❌"} ${t}`);

  try { getSheetRespostas_(); marca(true, `Aba "${SHEET_FORM_RESPONSES}" encontrada`); }
  catch (e) { marca(false, e.message); }

  const url = getWebAppUrl_();
  if (!url) marca(false, "App da Web não implantado ou WEBAPP_URL vazio");
  else if (/\/dev(\?|$)/.test(url)) marca(false, `A URL termina em /dev (só funciona para você). Use a URL /exec: ${url}`);
  else marca(true, `App da Web: ${url}`);

  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID_NOTIFICACOES).getSheetByName(SHEET_EMAIL_ADM);
    if (!sh) throw new Error(`Aba '${SHEET_EMAIL_ADM}' não encontrada`);
    const last = sh.getLastRow();
    const deps = last < 2 ? [] : sh.getRange(2, EMAIL_COL_DEPARTAMENTO, last - 1, 1).getDisplayValues()
      .map(r => String(r[0]).trim()).filter(Boolean);
    marca(deps.length > 0, `Aba EMAIL: ${deps.length} departamento(s) — ${Array.from(new Set(deps)).join(", ") || "nenhum"}`);
  } catch (e) { marca(false, e.message); }

  try {
    const shDest = SpreadsheetApp.openById(SPREADSHEET_ID_DESTINO).getSheetByName(SHEET_DESTINO);
    marca(!!shDest, shDest ? `Destino "${SHEET_DESTINO}" acessível` : `Aba "${SHEET_DESTINO}" não encontrada no destino`);
  } catch (e) { marca(false, "Sem acesso à planilha de destino: " + e.message); }

  if (!FORM_ID_VAGAS) {
    marca(false, "FORM_ID_VAGAS vazio — o formulário de vaga não abre após a aprovação");
  } else {
    try {
      const form = FormApp.openById(FORM_ID_VAGAS);
      const titulos = form.getItems().map(i => normalizar_(i.getTitle()));
      const semCasar = Object.keys(MAPA_PREFILL_VAGA)
        .filter(k => k !== "ID da Solicitação")
        .filter(k => !titulos.some(t => t === normalizar_(k) || t.indexOf(normalizar_(k)) === 0));
      marca(true, `Formulário de vagas: "${form.getTitle()}" (${titulos.length} itens)`);
      if (semCasar.length) marca(false, `Perguntas do mapa não encontradas no formulário: ${semCasar.join(", ")}`);
    } catch (e) { marca(false, "Sem acesso ao formulário de vagas (você precisa ser editor): " + e.message); }
  }

  const texto = linhas.join("\n");
  Logger.log(texto);
  try { SpreadsheetApp.getUi().alert("Teste de configuração", texto, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

// Manual
function menuAbrirManualSolicitacoes() {
  const tpl = HtmlService.createTemplateFromFile("ManualSolicitacoes");
  tpl.data = {
    spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
    linkPlanilha: LINK_PLANILHA_SOLICITACOES,
    now: new Date().toLocaleString("pt-BR")
  };

  const html = tpl.evaluate()
    .setTitle("Manual — Solicitações")
    .setWidth(940)
    .setHeight(680);

  SpreadsheetApp.getUi().showModalDialog(html, "Manual do Gestor — Solicitações");
}


// =================================================================
//  UTILITÁRIOS
// =================================================================
function getWebAppUrl_() {
  let url = String(WEBAPP_URL || "").trim();
  if (!url) {
    try { url = ScriptApp.getService().getUrl() || ""; } catch (e) {}
  }
  return url;
}

function normalizar_(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:.\s]+$/g, "");
}

function emailValido_(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function primeiroNome_(nome) {
  return String(nome || "").trim().split(/\s+/)[0];
}

function formatarData_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
}

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
