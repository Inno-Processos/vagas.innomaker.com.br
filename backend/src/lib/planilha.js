// Planilha "Registros" (Google Sheets) — preenchida quando o RH aprova uma admissão.
//
// O backend fala com o Apps Script da própria planilha (docs/planilha-registros.gs), publicado como
// app da Web. Configure no backend/.env:
//   PLANILHA_REGISTROS_URL    URL da implantação (termina em /exec)
//   PLANILHA_REGISTROS_TOKEN  o mesmo valor da propriedade VAGAS_TOKEN do script
//
// A linha vai na ordem exata das 64 colunas da aba Registros (COLUNAS). Colunas que a planilha
// preenche sozinha (DRIVE, Planilha de Horário, Planilha de Registro, Salário bruto…) vão vazias.
import { agora, hojeISO, parseJson } from "./http.js";
import { executar, um, todos, registrarLog } from "./db.js";
import { cfg } from "./config.js";

export const COLUNAS = [
  "Matricula", "vazio", "Situação", "Nome Completo", "Sexo", "Data Nascimento", "Mes de aniversário", "Idade", "CPF", "RG",
  "ORGÃO EXP/UF (RG)", "CNH", "ORGÃO EXP/UF (CNH)", "CTPS", "ORGÃO EXP/UF (CTPS)", "Telefone de contato", "E-mail", "vazio",
  "CEP", "Endereço", "Bairro", "Cidade", "Estado", "vazio", "Data da matrícula*", "Auxílio", "Bolsa - Valor", "Responsável",
  "Entidade Vinculada", "Data Inicial Bolsa", "Data Final Bolsa", "Bolsa - Innomaker", "SALÁRIO BRUTO", "Observação do Salário",
  "vazio", "Função", "Departamento", "Setor", "Horário de trabalho", "Data de Efetivação", "Data Final Contrato Innomaker",
  "Observação do Funcionário", "Curriculo lattes", "Grau de instrução", "Área de Formação", "Instituição de ensino", "CR",
  "DRIVE", "Planilha de Horário", "Matricula - UFF", "Email innomaker", "Planilha de Registro", "Data do Ultimo termo assinado",
  "Nº do PIX", "Banco do pix", "Foto", "Termo de Compromisso", "Direito de Imagem", "Aumento", "Mudança da Forma de Pagamento",
  "Principais funções", "Divisão Salario", "Resumo", "employeeIdChronos"
];

export function planilhaConfigurada(env) {
  return !!(env.PLANILHA_REGISTROS_URL && env.PLANILHA_REGISTROS_TOKEN);
}

const so = s => String(s == null ? "" : s).trim();
const digitos = s => so(s).replace(/\D/g, "");

function cpfFormatado(cpf) {
  const d = digitos(cpf);
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : so(cpf);
}

// "R$ 1.200,50" → 1200.5 (a planilha soma e formata como moeda). Texto que não é valor fica como está.
export function valorMonetario(v) {
  const t = so(v);
  if (!t) return "";
  const limpo = t.replace(/[R$\s]/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(limpo)) return t;
  const n = /,\d{1,2}$/.test(limpo) || /\.\d{3}/.test(limpo) ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
  return Number.isFinite(n) ? n : t;
}

export function idade(nascimentoIso, hojeIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(so(nascimentoIso));
  const h = /^(\d{4})-(\d{2})-(\d{2})$/.exec(so(hojeIso));
  if (!m || !h) return "";
  let anos = Number(h[1]) - Number(m[1]);
  if (Number(h[2]) < Number(m[2]) || (h[2] === m[2] && Number(h[3]) < Number(m[3]))) anos--;
  return anos >= 0 && anos < 130 ? anos : "";
}

const dataIso = s => /^\d{4}-\d{2}-\d{2}$/.test(so(s)) ? so(s) : so(s) ? so(s) : "";

// Monta a linha (64 valores) a partir do funcionário. Datas vão como AAAA-MM-DD (o script converte para data).
export function linhaRegistro(f, opts) {
  const d = typeof f.dados === "string" ? parseJson(f.dados, {}) : (f.dados || {});
  const o = opts || {};
  const hoje = o.hoje || hojeISO();
  const cr = so(d.cr).replace(",", ".");
  const v = {
    "Matricula": f.matricula ? Number(f.matricula) : "",
    "Situação": so(f.situacao),
    "Nome Completo": so(f.nome),
    "Sexo": so(d.sexo),
    "Data Nascimento": dataIso(d.data_nascimento),
    "Mes de aniversário": dataIso(d.data_nascimento),
    "Idade": idade(d.data_nascimento, hoje),
    "CPF": cpfFormatado(d.cpf),
    "RG": so(d.rg),
    "CNH": so(d.cnh),
    "CTPS": so(d.ctps),
    "Telefone de contato": so(f.telefone),
    "E-mail": so(f.email),
    "CEP": digitos(d.cep),
    "Endereço": so(d.endereco),
    "Bairro": so(d.bairro),
    "Cidade": so(d.cidade),
    "Estado": so(d.estado),
    "Data da matrícula*": o.dataMatricula || hoje,
    "Auxílio": so(f.auxilio),
    "Bolsa - Valor": valorMonetario(f.bolsa_valor),
    "Responsável": so(f.responsavel),
    "Entidade Vinculada": so(f.entidade_vinculada),
    "Data Inicial Bolsa": dataIso(f.data_efetivacao),
    "Data Final Bolsa": dataIso(f.data_final_contrato),
    "Função": so(f.funcao),
    "Departamento": so(f.departamento),
    "Setor": so(f.setor),
    "Horário de trabalho": so(f.horario_trabalho),
    "Data de Efetivação": dataIso(f.data_efetivacao),
    "Data Final Contrato Innomaker": dataIso(f.data_final_contrato),
    "Observação do Funcionário": f.admissao_id ? "Admitido pelo sistema de vagas (" + f.admissao_id + ")" + (f.tipo_contratacao ? " — " + f.tipo_contratacao : "") : "",
    "Curriculo lattes": so(d.curriculo_lattes),
    "Grau de instrução": so(d.grau_instrucao),
    "Área de Formação": so(d.area_formacao),
    "Instituição de ensino": so(d.instituicao_ensino),
    "CR": cr && Number.isFinite(Number(cr)) ? Number(cr) : so(d.cr),
    "Matricula - UFF": so(d.matricula_uff),
    "Email innomaker": so(f.email_innomaker),
    "Nº do PIX": so(d.pix_numero),
    "Banco do pix": so(d.pix_banco),
    "Termo de Compromisso": o.linkCompromisso || "",
    "Direito de Imagem": o.linkImagem || "",
    "Principais funções": so(f.principais_funcoes)
  };
  return COLUNAS.map(c => (c in v ? v[c] : ""));
}

// Chamada ao Apps Script. Resposta esperada: JSON { ok, ... }.
async function chamar(env, corpo, ms) {
  let r;
  try {
    r = await fetch(env.PLANILHA_REGISTROS_URL, {
      method: "POST",
      redirect: "follow", // o Apps Script responde por um redirecionamento para script.googleusercontent.com
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ origem: "vagas.innomaker", token: env.PLANILHA_REGISTROS_TOKEN }, corpo)),
      signal: AbortSignal.timeout(ms || 30000)
    });
  } catch (e) {
    throw new Error(e && e.name === "TimeoutError" ? "a planilha demorou demais para responder" : "não foi possível falar com a planilha (" + (e && e.message || e) + ")");
  }
  const texto = await r.text();
  let j;
  try { j = JSON.parse(texto); } catch (e) {
    throw new Error("a planilha respondeu uma página em vez de dados (HTTP " + r.status + "). Confira se a implantação do Apps Script está com acesso \"Qualquer pessoa\".");
  }
  if (!j.ok) throw new Error(j.erro || "a planilha recusou o pedido");
  return j;
}

export async function testarPlanilha(env) {
  if (!planilhaConfigurada(env)) return { ok: false, erro: "Planilha não configurada: preencha PLANILHA_REGISTROS_URL e PLANILHA_REGISTROS_TOKEN no backend/.env." };
  try {
    const j = await chamar(env, { acao: "ping" }, 30000);
    return { ok: true, aba: j.aba, linhas: j.linhas, colunas: j.colunas, proximaMatricula: j.proximaMatricula, esperadas: COLUNAS.length };
  } catch (e) {
    return { ok: false, erro: "Planilha: " + e.message };
  }
}

// Próxima matrícula = maior da coluna A da planilha + 1 (nunca menor que a próxima do sistema)
export async function proximaMatricula(env) {
  const j = await chamar(env, { acao: "proxima_matricula" }, 30000);
  const daPlanilha = parseInt(j.matricula, 10) || 1;
  const local = await um(env, "SELECT COALESCE(MAX(matricula), 0) + 1 AS n FROM funcionarios");
  return Math.max(daPlanilha, Number(local.n) || 1);
}

// Envia (ou completa) a linha do funcionário e grava o resultado no registro dele
export async function enviarRegistro(env, matricula, quem) {
  const f = await um(env, "SELECT * FROM funcionarios WHERE matricula = ?", matricula);
  if (!f) return { ok: false, erro: "Funcionário não encontrado." };
  if (!planilhaConfigurada(env)) {
    await executar(env, "UPDATE funcionarios SET planilha_status = 'NAO_CONFIGURADA', planilha_erro = ?, planilha_em = ? WHERE matricula = ?",
      "PLANILHA_REGISTROS_URL e PLANILHA_REGISTROS_TOKEN não estão no backend/.env.", agora(), matricula);
    return { ok: false, erro: "Planilha não configurada no backend/.env." };
  }
  const docs = await todos(env, "SELECT id, titulo FROM documentos WHERE funcionario_matricula = ? AND status <> 'CANCELADO' ORDER BY criado_em", matricula);
  const link = rx => { const d = docs.find(x => rx.test(x.titulo)); return d ? cfg(env).siteUrl + "/documento/" + d.id : ""; };
  const linha = linhaRegistro(f, {
    dataMatricula: String(f.criado_em || "").slice(0, 10) || hojeISO(),
    linkCompromisso: link(/compromisso/i),
    linkImagem: link(/imagem/i)
  });
  await executar(env, "UPDATE funcionarios SET planilha_status = 'ENVIANDO', planilha_erro = '', planilha_em = ? WHERE matricula = ?", agora(), matricula);
  try {
    // a planilha roda as rotinas dela (pastas no Drive, planilhas, formatação): pode levar alguns minutos
    const j = await chamar(env, { acao: "registrar", linha }, 6 * 60 * 1000);
    const aviso = (j.avisos || []).join(" | ");
    await executar(env, "UPDATE funcionarios SET planilha_status = 'ENVIADO', planilha_erro = ?, planilha_em = ?, planilha_linha = ? WHERE matricula = ?",
      aviso, agora(), parseInt(j.linha, 10) || null, matricula);
    await registrarLog(env, quem || "sistema", "PLANILHA_REGISTROS", "funcionario", matricula, (j.criada ? "linha criada " : "linha completada ") + (j.linha || "") + (aviso ? " — " + aviso : ""));
    return { ok: true, linha: j.linha, criada: !!j.criada, drive: j.drive || "", avisos: j.avisos || [] };
  } catch (e) {
    await executar(env, "UPDATE funcionarios SET planilha_status = 'FALHOU', planilha_erro = ?, planilha_em = ? WHERE matricula = ?",
      String(e.message || e).slice(0, 500), agora(), matricula);
    await registrarLog(env, quem || "sistema", "PLANILHA_REGISTROS_FALHOU", "funcionario", matricula, String(e.message || e));
    return { ok: false, erro: "Planilha: " + (e.message || e) };
  }
}
