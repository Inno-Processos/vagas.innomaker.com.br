// Rotina (de hora em hora): fecha vagas vencidas, avisa o RH sobre contratos perto do fim,
// lembra candidatos de entrevistas, cadastros e assinaturas pendentes e aplica o prazo de guarda (LGPD).
import { hojeISO, agora, dataBR, parseJson, esc } from "./lib/http.js";
import { todos, um, executar, registrarLog, lerConfig } from "./lib/db.js";
import { enviarEmail, layout, textoSimples } from "./lib/email.js";
import { cfg } from "./lib/config.js";
import { lembretesDeEntrevista } from "./api/agendamento.js";
import { limpezaLgpd } from "./lib/lgpd.js";

const DIAS_AVISO_RENOVACAO = 45;
const DIAS_ENTRE_LEMBRETES = 2;
const MAX_LEMBRETES = 3;

// Proposta sem resposta, cadastro incompleto, correção pedida e documentos sem assinatura:
// até 3 lembretes, a cada 2 dias, para o candidato.
export async function avisosAoCandidato(env) {
  const limite = new Date(Date.now() - DIAS_ENTRE_LEMBRETES * 864e5).toISOString();
  const area = cfg(env).siteUrl + "/?page=acompanhar";
  const enviar = (para, assunto, titulo, paragrafos) => enviarEmail(env, {
    para, assunto, html: layout({ titulo, paragrafos, botao: { texto: "Abrir a Área do candidato", url: area } }),
    texto: textoSimples(titulo, paragrafos, area)
  });

  const adms = await todos(env,
    `SELECT a.*, c.nome, v.titulo FROM admissoes a JOIN candidatos c ON c.id = a.candidato_id JOIN vagas v ON v.id = a.vaga_id
      WHERE a.status IN ('PROPOSTA_ENVIADA', 'COMPLETANDO_CADASTRO', 'CORRECAO_SOLICITADA')
        AND a.lembretes < ? AND COALESCE(a.lembrete_em, a.atualizado_em) < ?`, MAX_LEMBRETES, limite);
  for (const a of adms) {
    const primeiro = esc(String(a.nome).split(" ")[0]);
    let assunto, titulo, ps;
    if (a.status === "PROPOSTA_ENVIADA") {
      assunto = "Lembrete: sua proposta da Innomaker está esperando resposta"; titulo = "Sua proposta está esperando";
      ps = [`Olá, <b>${primeiro}</b>!`, `A proposta para <b>${esc(a.titulo)}</b> ainda não foi respondida.`, "Entre na Área do candidato para aceitar ou recusar."];
    } else if (a.status === "CORRECAO_SOLICITADA") {
      const pedido = parseJson(a.historico, []).filter(h => h.acao === "Correção solicitada").pop();
      assunto = "Lembrete: o RH pediu uma correção no seu cadastro"; titulo = "Falta corrigir seu cadastro";
      ps = [`Olá, <b>${primeiro}</b>!`, `O RH pediu um ajuste no seu cadastro de admissão (${esc(a.titulo)}) e ele ainda não foi reenviado.`,
        pedido && pedido.texto ? "<b>O que corrigir:</b><br>" + esc(pedido.texto).replace(/\n/g, "<br>") : ""].filter(Boolean);
    } else {
      const faltam = [];
      if (!Object.keys(parseJson(a.cadastro, {})).length) faltam.push("os dados do cadastro (CPF, endereço, banco e contato de emergência)");
      if (!(await um(env, "SELECT id FROM arquivos WHERE admissao_id = ? AND categoria = 'doc_pessoais' LIMIT 1", a.id))) {
        faltam.push("os documentos pessoais (RG, CPF e comprovante de residência)");
      }
      assunto = "Lembrete: complete seu cadastro de admissão"; titulo = "Falta pouco para sua admissão";
      ps = [`Olá, <b>${primeiro}</b>!`, `Seu cadastro de admissão para <b>${esc(a.titulo)}</b> ainda não foi enviado.`,
        faltam.length ? "<b>Falta enviar:</b><br>• " + faltam.join("<br>• ") : "Revise os dados e clique em enviar."];
    }
    await enviar(a.email_contato, assunto, titulo, ps);
    await executar(env, "UPDATE admissoes SET lembrete_em = ?, lembretes = lembretes + 1 WHERE id = ?", agora(), a.id);
  }

  const docs = await todos(env,
    `SELECT d.candidato_id, c.nome, c.email, group_concat(d.titulo, '||') AS titulos, group_concat(d.id, '||') AS ids
       FROM documentos d JOIN candidatos c ON c.id = d.candidato_id
      WHERE d.status = 'AGUARDANDO_ASSINATURA' AND d.lembretes < ? AND COALESCE(d.lembrete_em, d.criado_em) < ?
      GROUP BY d.candidato_id`, MAX_LEMBRETES, limite);
  for (const d of docs) {
    const titulos = String(d.titulos || "").split("||");
    await enviar(d.email, "Lembrete: documentos aguardando sua assinatura", "Documentos para assinar",
      [`Olá, <b>${esc(String(d.nome).split(" ")[0])}</b>!`, "Estes documentos ainda estão esperando a sua assinatura:",
        "• " + titulos.map(esc).join("<br>• "), "Entre na Área do candidato, leia com atenção e assine."]);
    for (const id of String(d.ids || "").split("||")) {
      await executar(env, "UPDATE documentos SET lembrete_em = ?, lembretes = lembretes + 1 WHERE id = ?", agora(), id);
    }
  }
  return adms.length + docs.length;
}

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
  // Lembretes só em horário comercial (8h–20h de Brasília), para não chegar de madrugada
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hora >= 8 && hora < 20) {
    await avisosAoCandidato(env);
    await lembretesDeEntrevista(env);
  }
  await limpezaLgpd(env);
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
