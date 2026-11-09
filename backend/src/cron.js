// Rotina (de hora em hora): fecha vagas vencidas, avisa o RH sobre contratos perto do fim,
// lembra candidatos de entrevistas, cadastros e assinaturas pendentes e aplica o prazo de guarda (LGPD).
import { hojeISO, agora, dataBR, parseJson, esc } from "./lib/http.js";
import { todos, um, executar, registrarLog, lerConfig, historicoMais } from "./lib/db.js";
import { enviarEmail, layout, textoSimples } from "./lib/email.js";
import { cfg } from "./lib/config.js";
import { lembretesDeEntrevista } from "./api/agendamento.js";
import { limpezaLgpd } from "./lib/lgpd.js";
import { CAMPOS_CADASTRO, documentosExigidos, documentosFaltando } from "./lib/admissao.js";

const DIAS_AVISO_RENOVACAO = 45;
const DIAS_ENTRE_LEMBRETES = 2;
const MAX_LEMBRETES = 3;

// Proposta sem resposta depois do prazo: vence, o candidato volta a "Aprovado no processo" e RH e candidato são avisados
export async function vencerPropostas(env) {
  const vencidas = await todos(env,
    `SELECT a.*, c.nome, v.titulo FROM admissoes a JOIN candidatos c ON c.id = a.candidato_id JOIN vagas v ON v.id = a.vaga_id
      WHERE a.status = 'PROPOSTA_ENVIADA' AND a.prazo_resposta IS NOT NULL AND a.prazo_resposta < ?`, hojeISO());
  if (!vencidas.length) return 0;
  const config = await lerConfig(env);
  const site = cfg(env).siteUrl;
  for (const a of vencidas) {
    await executar(env, "UPDATE admissoes SET status = 'PROPOSTA_EXPIRADA', historico = ?, atualizado_em = ? WHERE id = ? AND status = 'PROPOSTA_ENVIADA'",
      historicoMais(a.historico, "sistema", "Proposta vencida", "sem resposta até " + dataBR(a.prazo_resposta)), agora(), a.id);
    await executar(env, "UPDATE candidaturas SET status = 'Aprovado', atualizado_em = ? WHERE id = ? AND status = 'Proposta'", agora(), a.candidatura_id);
    await registrarLog(env, "sistema", "PROPOSTA_VENCIDA", "admissao", a.id, a.nome);
    const primeiro = esc(String(a.nome).split(" ")[0]);
    const psC = [`Olá, <b>${primeiro}</b>.`, `O prazo para responder a proposta para <b>${esc(a.titulo)}</b> terminou em ${dataBR(a.prazo_resposta)} e ela não está mais valendo.`,
      "Se ainda tiver interesse, responda este e-mail ou fale com o RH."];
    await enviarEmail(env, { para: a.email_contato, assunto: "Sua proposta venceu — " + a.titulo, html: layout({ titulo: "O prazo da proposta terminou", paragrafos: psC }),
      texto: textoSimples("O prazo da proposta terminou", psC) });
    if (config.email_rh) {
      const url = site + "/painel#admissao/" + a.id;
      const psR = [`A proposta de <b>${esc(a.nome)}</b> para <b>${esc(a.titulo)}</b> (${a.id}) venceu sem resposta.`,
        "Para dar mais prazo, abra a admissão e use <b>Editar proposta</b>. Para outro candidato, envie uma nova proposta pela vaga."];
      await enviarEmail(env, { para: config.email_rh, assunto: "Proposta vencida — " + a.nome, html: layout({ titulo: "Proposta vencida", paragrafos: psR, botao: { texto: "Abrir admissão", url } }),
        texto: textoSimples("Proposta vencida", psR, url) });
    }
  }
  return vencidas.length;
}

// Véspera do 1º dia: gestor e RH recebem o que ainda falta na trilha; o novo colaborador recebe as boas-vindas
export async function avisoVesperaInicio(env) {
  const amanha = hojeISO(1);
  const lista = await todos(env,
    `SELECT a.*, f.nome, f.email AS email_func, f.funcao, f.departamento, f.data_efetivacao, f.documentos_conferidos, f.ponto_cadastrado, f.acessos_ok, f.onboarding_ok,
            v.titulo FROM admissoes a JOIN funcionarios f ON f.matricula = a.funcionario_id JOIN vagas v ON v.id = a.vaga_id
      WHERE a.status = 'APROVADA' AND a.onboarding_aviso_em IS NULL AND f.ativo = 1 AND f.data_efetivacao = ?`, amanha);
  if (!lista.length) return 0;
  const config = await lerConfig(env);
  const site = cfg(env).siteUrl;
  for (const a of lista) {
    const docs = await um(env, "SELECT COUNT(*) AS t, SUM(CASE WHEN status = 'ASSINADO' THEN 1 ELSE 0 END) AS s FROM documentos WHERE admissao_id = ? AND status <> 'CANCELADO'", a.id);
    const pend = [
      docs.t && docs.s < docs.t ? `Documentos assinados: ${docs.s || 0} de ${docs.t}` : "",
      !a.documentos_conferidos ? "Conferência dos documentos assinados" : "",
      !a.ponto_cadastrado ? "Cadastro no aplicativo de ponto" : "",
      !a.acessos_ok ? "Acessos (e-mail Innomaker e sistemas)" : ""
    ].filter(Boolean);
    const p = parseJson(a.proposta, {});
    const url = site + "/painel#admissao/" + a.id;
    const ps = [`<b>${esc(a.nome)}</b> começa amanhã, <b>${dataBR(a.data_efetivacao)}</b>, como ${esc(a.funcao || a.titulo)} (${esc(a.departamento || "")}).`,
      pend.length ? "<b>Ainda falta:</b><br>• " + pend.map(esc).join("<br>• ") : "Todos os passos da admissão antes do primeiro dia estão feitos.",
      "Prepare o onboarding: sala, apresentação, camisa e crachá."];
    const para = [...new Set([p.gestor_email, config.email_rh].filter(Boolean))];
    if (para.length) await enviarEmail(env, { para, assunto: `Amanhã começa: ${a.nome}`, html: layout({ titulo: "Novo colaborador amanhã", paragrafos: ps, botao: { texto: "Ver admissão", url } }),
      texto: textoSimples("Novo colaborador amanhã", ps, url) });
    const psN = [`Olá, <b>${esc(String(a.nome).split(" ")[0])}</b>!`, `Amanhã, <b>${dataBR(a.data_efetivacao)}</b>, é o seu primeiro dia na Innomaker. Estamos esperando você!`,
      p.horario_trabalho ? "Horário: " + esc(p.horario_trabalho) + "." : "", "Qualquer dúvida, responda este e-mail."].filter(Boolean);
    await enviarEmail(env, { para: a.email_func || a.email_contato, assunto: "Amanhã é seu primeiro dia na Innomaker", html: layout({ titulo: "Boas-vindas!", paragrafos: psN }),
      texto: textoSimples("Boas-vindas!", psN) });
    await executar(env, "UPDATE admissoes SET onboarding_aviso_em = ? WHERE id = ?", agora(), a.id);
  }
  return lista.length;
}

// Proposta sem resposta, cadastro incompleto, correção pedida e documentos sem assinatura:
// até 3 lembretes, a cada 2 dias, para o candidato.
export async function avisosAoCandidato(env) {
  const limite = new Date(Date.now() - DIAS_ENTRE_LEMBRETES * 864e5).toISOString();
  const area = cfg(env).siteUrl + "/area-do-candidato";
  const config = await lerConfig(env);
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
      ps = [`Olá, <b>${primeiro}</b>!`, `A proposta para <b>${esc(a.titulo)}</b> ainda não foi respondida.`,
        (a.prazo_resposta ? `O prazo para responder termina em <b>${dataBR(a.prazo_resposta)}</b>. ` : "") + "Entre na Área do candidato para aceitar ou recusar."];
    } else if (a.status === "CORRECAO_SOLICITADA") {
      const pedido = parseJson(a.historico, []).filter(h => h.acao === "Correção solicitada").pop();
      assunto = "Lembrete: o RH pediu uma correção no seu cadastro"; titulo = "Falta corrigir seu cadastro";
      const corr = parseJson(a.correcoes, {});
      ps = [`Olá, <b>${primeiro}</b>!`, `O RH pediu um ajuste no seu cadastro de admissão (${esc(a.titulo)}) e ele ainda não foi reenviado.`,
        (corr.itens || []).length ? "<b>O que corrigir:</b><br>• " + corr.itens.map(i => esc(i.rotulo) + ": " + esc(i.comentario)).join("<br>• ") : "",
        corr.texto || (pedido && pedido.texto && !(corr.itens || []).length) ? "<b>Observação do RH:</b><br>" + esc(corr.texto || pedido.texto).replace(/\n/g, "<br>") : ""].filter(Boolean);
    } else {
      const faltam = [];
      const rasc = parseJson(a.rascunho, {});
      const vazios = Object.keys(CAMPOS_CADASTRO).filter(k => CAMPOS_CADASTRO[k][1] && !rasc[k]);
      if (vazios.length) faltam.push(vazios.length === Object.keys(CAMPOS_CADASTRO).filter(k => CAMPOS_CADASTRO[k][1]).length
        ? "os dados do cadastro (CPF, endereço, formação e contato de emergência)"
        : "campos: " + vazios.slice(0, 8).map(k => CAMPOS_CADASTRO[k][2]).join(", ") + (vazios.length > 8 ? "…" : ""));
      const arqs = await todos(env, "SELECT categoria FROM arquivos WHERE admissao_id = ?", a.id);
      documentosFaltando(documentosExigidos(config, parseJson(a.proposta, {}).tipo_contratacao), arqs).forEach(d => faltam.push(d.nome));
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
  await vencerPropostas(env);
  // Lembretes só em horário comercial (8h–20h de Brasília), para não chegar de madrugada
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (hora >= 8 && hora < 20) {
    await avisosAoCandidato(env);
    await lembretesDeEntrevista(env);
    await avisoVesperaInicio(env);
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
