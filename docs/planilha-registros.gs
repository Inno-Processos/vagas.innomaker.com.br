/* =====================================================================================
   Integração da planilha de Registros com o sistema Vagas.Innomaker
   -------------------------------------------------------------------------------------
   Cole este arquivo no Apps Script da planilha (Extensões → Apps Script → "+" → Script,
   nome: VagasIntegracao). Passo a passo completo em docs/planilha-registros.md.

   IMPORTANTE: este arquivo traz o doPost(e). APAGUE o doPost antigo do outro arquivo
   (o que chama processarRegistroAprovado_), senão o Apps Script fica com dois doPost.
   O comportamento antigo continua: pedidos que não vêm do sistema de vagas seguem para
   processarRegistroAprovado_ como antes.
   ===================================================================================== */

var VAGAS_ABA = "Registros";
var VAGAS_TOTAL_COLUNAS = 64;          // Matricula … employeeIdChronos
var VAGAS_COLUNAS_PROTEGIDAS = [48, 49, 52]; // DRIVE, Planilha de Horário, Planilha de Registro (criadas pelo main)

function doPost(e) {
  var dados = {};
  try { dados = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (x) { dados = {}; }

  if (dados.origem === "vagas.innomaker") {
    var resposta;
    try { resposta = vagasProcessar_(dados); }
    catch (erro) { resposta = { ok: false, erro: String(erro && erro.message || erro) }; }
    return ContentService.createTextOutput(JSON.stringify(resposta)).setMimeType(ContentService.MimeType.JSON);
  }

  // Comportamento antigo (registro aprovado do sistema anterior)
  processarRegistroAprovado_(dados);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function vagasProcessar_(d) {
  var token = PropertiesService.getScriptProperties().getProperty("VAGAS_TOKEN");
  if (!token) return { ok: false, erro: "VAGAS_TOKEN não existe no script. Rode a função vagasGerarToken uma vez no editor." };
  if (d.token !== token) return { ok: false, erro: "Token inválido: PLANILHA_REGISTROS_TOKEN (backend/.env) é diferente de VAGAS_TOKEN (script)." };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(VAGAS_ABA);
  if (!aba) return { ok: false, erro: 'A aba "' + VAGAS_ABA + '" não foi encontrada na planilha.' };

  if (d.acao === "ping") {
    return { ok: true, aba: VAGAS_ABA, linhas: aba.getLastRow(), colunas: aba.getLastColumn(), proximaMatricula: vagasProximaMatricula_(aba) };
  }
  if (d.acao === "proxima_matricula") return { ok: true, matricula: vagasProximaMatricula_(aba) };
  if (d.acao === "registrar") return vagasRegistrar_(ss, aba, d.linha || []);
  return { ok: false, erro: "Ação desconhecida: " + d.acao };
}

// Maior número da coluna A (Matricula) + 1
function vagasProximaMatricula_(aba) {
  var n = aba.getLastRow();
  if (n < 2) return 1;
  var col = aba.getRange(2, 1, n - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < col.length; i++) {
    var v = parseInt(String(col[i][0]).replace(/\D/g, ""), 10);
    if (v > max) max = v;
  }
  return max + 1;
}

function vagasLinhaDaMatricula_(aba, matricula) {
  var n = aba.getLastRow();
  if (n < 2) return 0;
  var col = aba.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (parseInt(String(col[i][0]).replace(/\D/g, ""), 10) === matricula) return i + 2;
  }
  return 0;
}

// "AAAA-MM-DD" vira data de verdade (a planilha formata como dd/mm/aaaa); o resto fica como veio
function vagasValor_(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    var p = v.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  return v;
}

function vagasRegistrar_(ss, aba, linha) {
  var valores = [];
  for (var i = 0; i < VAGAS_TOTAL_COLUNAS; i++) valores.push(vagasValor_(linha[i]));

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var numLinha, criada = false, matricula;
  try {
    matricula = parseInt(valores[0], 10);
    if (!matricula) { matricula = vagasProximaMatricula_(aba); valores[0] = matricula; }
    numLinha = vagasLinhaDaMatricula_(aba, matricula);
    if (!numLinha) {
      aba.appendRow(valores);
      numLinha = aba.getLastRow();
      criada = true;
    } else {
      // Já existe: só completa células vazias (nada preenchido é apagado) e nunca mexe nos links do Drive
      var atuais = aba.getRange(numLinha, 1, 1, VAGAS_TOTAL_COLUNAS).getValues()[0];
      for (var k = 0; k < VAGAS_TOTAL_COLUNAS; k++) {
        if (VAGAS_COLUNAS_PROTEGIDAS.indexOf(k + 1) >= 0) continue;
        var vazio = atuais[k] === "" || atuais[k] === null;
        if (vazio && valores[k] !== "") aba.getRange(numLinha, k + 1).setValue(valores[k]);
      }
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // Rotinas da própria planilha: pasta no Drive, planilha de horário, planilha individual, formatação…
  var avisos = [];
  try {
    ss.setActiveSheet(aba);
    main();
  } catch (erro) {
    // main() termina com um alerta na tela (getUi), que não existe quando roda pelo sistema: isso não é erro
    if (!/getUi|context|contexto/i.test(String(erro))) avisos.push("main(): " + erro);
  }

  return {
    ok: true, matricula: matricula, linha: numLinha, criada: criada,
    drive: String(aba.getRange(numLinha, 48).getValue() || ""), avisos: avisos
  };
}

// Rode UMA VEZ no editor (selecione vagasGerarToken e clique em Executar).
// O token aparece em "Registro de execução": copie para PLANILHA_REGISTROS_TOKEN no backend/.env.
function vagasGerarToken() {
  var t = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty("VAGAS_TOKEN", t);
  Logger.log("VAGAS_TOKEN = " + t);
}
