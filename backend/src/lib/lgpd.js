// LGPD: exclusão dos dados de um candidato (a pedido dele ou do RH) e limpeza automática
// depois do prazo de guarda (Configurações → Privacidade).
//
// Quem já tem admissão em andamento/aprovada ou é funcionário não é excluído por aqui:
// esses dados têm obrigação legal de guarda (contrato, documentos assinados) e ficam com o RH.
import { ErroApi, agora, hojeISO } from "./http.js";
import { um, todos, executar, prep, registrarLog, lerConfig } from "./db.js";
import { apagarArquivo } from "./arquivos.js";
import { liberarReservasDaCandidatura } from "../api/agendamento.js";

import { ADM_ENCERRADAS } from "./admissao.js";

export const STATUS_ADM_ENCERRADOS = ADM_ENCERRADAS; // recusada, cancelada, proposta recusada ou vencida
const ATIVAS = ["Em processo", "Aprovado", "Proposta"];

const mesesAtras = meses => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString();
};
const meses = (v, padrao) => { const n = parseInt(v, 10); return n >= 1 && n <= 120 ? n : padrao; };

export async function prazosLgpd(env) {
  const c = await lerConfig(env);
  return { retencao: meses(c.lgpd_meses_retencao, 12), banco: meses(c.lgpd_meses_banco, 24) };
}

// Motivo pelo qual o candidato não pode ser excluído, ou "" se pode
export async function bloqueioExclusao(env, candidatoId) {
  const adm = await um(env,
    `SELECT id, status FROM admissoes WHERE candidato_id = ? AND status NOT IN (${STATUS_ADM_ENCERRADOS.map(() => "?").join(",")}) LIMIT 1`,
    candidatoId, ...STATUS_ADM_ENCERRADOS);
  if (adm) return "Há uma admissão em andamento ou concluída (" + adm.id + "). Esses dados ficam guardados por obrigação legal; fale com o RH.";
  if (await um(env, "SELECT matricula FROM funcionarios WHERE candidato_id = ? LIMIT 1", candidatoId)) {
    return "Você é funcionário(a) da Innomaker. Os dados do contrato ficam guardados por obrigação legal; fale com o RH.";
  }
  return "";
}

// Apaga tudo do candidato: currículos, documentos enviados, candidaturas, etapas, propostas recusadas e a conta.
// O histórico (log) e a lista de e-mails enviados ficam sem o e-mail dele.
export async function excluirCandidato(env, ctx, candidatoId, quem, motivo) {
  const c = await um(env, "SELECT * FROM candidatos WHERE id = ?", candidatoId);
  if (!c) throw new ErroApi("Candidato não encontrado.");
  const bloqueio = await bloqueioExclusao(env, c.id);
  if (bloqueio) throw new ErroApi(bloqueio);

  const cdts = await todos(env, "SELECT id FROM candidaturas WHERE candidato_id = ?", c.id);
  for (const ca of cdts) await liberarReservasDaCandidatura(env, ctx, ca.id, "o candidato saiu do processo seletivo");

  const arquivos = await todos(env,
    "SELECT id FROM arquivos WHERE candidato_id = ? OR admissao_id IN (SELECT id FROM admissoes WHERE candidato_id = ?)", c.id, c.id);
  for (const a of arquivos) await apagarArquivo(env, a.id);
  const curriculos = await todos(env, "SELECT curriculo_id FROM candidaturas WHERE candidato_id = ? AND curriculo_id IS NOT NULL", c.id);
  for (const a of curriculos) await apagarArquivo(env, a.curriculo_id);

  const email = String(c.email || "");
  await env.DB.batch([
    prep(env, "DELETE FROM documentos WHERE candidato_id = ?", c.id),
    prep(env, "DELETE FROM admissoes WHERE candidato_id = ?", c.id),
    prep(env, "DELETE FROM etapas WHERE candidatura_id IN (SELECT id FROM candidaturas WHERE candidato_id = ?)", c.id),
    prep(env, "DELETE FROM candidaturas WHERE candidato_id = ?", c.id),
    prep(env, "DELETE FROM candidatos WHERE id = ?", c.id),
    prep(env, "UPDATE log SET quem = ? WHERE lower(quem) = lower(?)", "candidato excluído (" + c.id + ")", email),
    prep(env, "UPDATE log SET detalhe = replace(detalhe, ?, '(e-mail excluído)') WHERE instr(detalhe, ?) > 0", email, email),
    prep(env, "UPDATE emails SET para = replace(para, ?, '(e-mail excluído)'), corpo = '' WHERE instr(para, ?) > 0", email, email)
  ]);
  await registrarLog(env, quem, "CANDIDATO_EXCLUIDO_LGPD", "candidato", c.id,
    (motivo || "") + " — " + cdts.length + " candidatura(s), " + (arquivos.length + curriculos.length) + " arquivo(s)");
  return { candidaturas: cdts.length, arquivos: arquivos.length + curriculos.length };
}

// Candidatos que passaram do prazo de guarda (uma vez por dia, pela rotina).
// Guarda = última atividade (inscrição, login, avaliação) + prazo. Banco de talentos com consentimento: prazo maior.
// Nunca apaga quem tem candidatura ativa em vaga não concluída, admissão ou é funcionário.
export async function candidatosVencidos(env) {
  const p = await prazosLgpd(env);
  const limite = mesesAtras(p.retencao), limiteBanco = mesesAtras(p.banco);
  return todos(env,
    `SELECT c.id, c.email FROM candidatos c
      WHERE max(COALESCE(c.ultima_atividade, c.criado_em),
                COALESCE((SELECT max(ca.atualizado_em) FROM candidaturas ca WHERE ca.candidato_id = c.id), '')) < ?
        AND NOT (c.banco_talentos = 1 AND COALESCE(c.banco_talentos_em, c.criado_em) >= ?)
        AND NOT EXISTS (SELECT 1 FROM candidaturas ca JOIN vagas v ON v.id = ca.vaga_id
                         WHERE ca.candidato_id = c.id AND ca.status IN (${ATIVAS.map(() => "?").join(",")}) AND v.status <> 'Concluída')
        AND NOT EXISTS (SELECT 1 FROM admissoes a WHERE a.candidato_id = c.id
                         AND a.status NOT IN (${STATUS_ADM_ENCERRADOS.map(() => "?").join(",")}))
        AND NOT EXISTS (SELECT 1 FROM funcionarios f WHERE f.candidato_id = c.id)
      LIMIT 200`,
    limite, limiteBanco, ...ATIVAS, ...STATUS_ADM_ENCERRADOS);
}

export async function limpezaLgpd(env) {
  const hoje = hojeISO();
  const feito = await um(env, "SELECT valor FROM config WHERE chave = 'lgpd_ultima_limpeza'");
  if (feito && feito.valor === hoje) return 0;
  const vencidos = await candidatosVencidos(env);
  let n = 0;
  for (const c of vencidos) {
    try { await excluirCandidato(env, null, c.id, "sistema", "prazo de guarda vencido"); n++; } catch (e) { console.log("LGPD: não excluiu", c.id, e.message); }
  }
  await executar(env, "INSERT INTO config (chave, valor) VALUES ('lgpd_ultima_limpeza', ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor", hoje);
  if (n) await registrarLog(env, "sistema", "LGPD_LIMPEZA", "candidato", "", n + " candidato(s) excluído(s) por prazo de guarda");
  return n;
}

export const tocarAtividade = (env, candidatoId) =>
  executar(env, "UPDATE candidatos SET ultima_atividade = ? WHERE id = ?", agora(), candidatoId);
