// Rotina diária (Cron Trigger): fecha vagas vencidas e avisa o RH sobre contratos perto do fim.
import { hojeISO, agora, dataBR } from "./lib/http.js";
import { todos, executar, registrarLog, lerConfig } from "./lib/db.js";
import { enviarEmail, layout, textoSimples } from "./lib/email.js";
import { cfg } from "./lib/config.js";

const DIAS_AVISO_RENOVACAO = 45;

export async function rotinaDiaria(env) {
  const hoje = hojeISO();

  const r = await executar(env,
    "UPDATE vagas SET status = 'Fechada', atualizado_em = ? WHERE status IN ('Aberta', 'Pausada') AND data_limite IS NOT NULL AND data_limite <> '' AND data_limite < ?",
    agora(), hoje);
  if (r.meta && r.meta.changes) await registrarLog(env, "sistema", "VAGAS_FECHADAS_POR_PRAZO", "vaga", "", r.meta.changes + " vaga(s)");

  // Contratos com duração mínima de 1 ano: avisar o RH com antecedência (RHC-PROC-2026-003, item 5)
  const limite = hojeISO(DIAS_AVISO_RENOVACAO);
  const vencendo = await todos(env,
    `SELECT matricula, nome, data_final_contrato FROM funcionarios
      WHERE ativo = 1 AND data_final_contrato <> '' AND data_final_contrato <= ? AND lembrete_renovacao_em IS NULL
      ORDER BY data_final_contrato`, limite);
  if (!vencendo.length) return;

  const config = await lerConfig(env);
  if (config.email_rh) {
    const lista = vencendo.map(f => `${f.nome} (matrícula ${f.matricula}) — termina em ${dataBR(f.data_final_contrato)}`);
    const url = cfg(env).siteUrl + "/painel#funcionarios";
    await enviarEmail(env, {
      para: config.email_rh,
      assunto: `Contratos terminando nos próximos ${DIAS_AVISO_RENOVACAO} dias`,
      html: layout({
        titulo: "Contratos para renovar",
        paragrafos: ["Confirme as datas e gere os novos termos pelo painel (Funcionários → Gerar documentos):"],
        destaque: lista.join("<br>"),
        botao: { texto: "Abrir funcionários", url }
      }),
      texto: textoSimples("Contratos para renovar", lista, url)
    });
  }
  for (const f of vencendo) {
    await executar(env, "UPDATE funcionarios SET lembrete_renovacao_em = ? WHERE matricula = ?", agora(), f.matricula);
  }
}
