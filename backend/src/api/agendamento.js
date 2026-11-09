// =====================================================================
//  Agendamento de horários com reserva (entrevistas e testes de cada etapa)
//
//  RH (painel):  abre uma agenda para uma etapa da vaga, com os horários em que pode atender,
//                o local e os participantes (RH, funcionário, convidados); envia o link aos candidatos.
//  Candidato:    abre /agendar/<token>, vê os horários livres e reserva um. Horário reservado
//                não pode ser ocupado por outra pessoa (reserva atômica no banco).
//  Ao reservar:  convite de calendário (.ics) por e-mail ao candidato e a todos os participantes.
// =====================================================================
import { ErroApi, json, agora, texto, parseJson, lerJson, mesmaOrigem, esc } from "../lib/http.js";
import { um, todos, executar, registrarLog, quemE } from "../lib/db.js";
import { enviarEmail, layout, textoSimples } from "../lib/email.js";
import { cfg } from "../lib/config.js";
import {
  ehHorarioLocal, somarMinutos, dataHoraExtenso, horaDe, agoraLocal, lerParticipantes, participantesDoHorario, icsEvento,
  lerDisponibilidade, gerarHorarios, sobrepoe
} from "../lib/agenda.js";
import { ehDataISO, hojeISO } from "../lib/http.js";

const linkAgendar = (env, token) => cfg(env).siteUrl + "/agendar/" + encodeURIComponent(token);
const linkPainel = (env, hash) => cfg(env).siteUrl + "/painel#" + hash;
const ANTECEDENCIA_TROCA_MIN = 120; // o candidato pode trocar/liberar até 2 h antes

function enviar(env, ctx, para, assunto, titulo, paragrafos, botao, convite) {
  if (!para || (Array.isArray(para) && !para.length)) return;
  ctx.waitUntil(enviarEmail(env, {
    para, assunto,
    html: layout({ titulo, paragrafos, botao }),
    texto: textoSimples(titulo, paragrafos, botao && botao.url),
    convite
  }));
}

const descreverLocal = a => (a.local_tipo === "online" ? "Online: " : "") + a.local;

// Tudo o que um horário reservado precisa para o convite
async function contextoDoHorario(env, horarioId) {
  const h = await um(env, "SELECT * FROM agenda_horarios WHERE id = ?", horarioId);
  if (!h) return null;
  const a = await um(env, "SELECT * FROM agendas WHERE id = ?", h.agenda_id);
  const e = h.etapa_id ? await um(env, "SELECT * FROM etapas WHERE id = ?", h.etapa_id) : null;
  const ca = e ? await um(env,
    `SELECT ca.*, c.nome, c.email, c.telefone, v.titulo AS vaga_titulo, v.id AS vaga_id FROM candidaturas ca
       JOIN candidatos c ON c.id = ca.candidato_id JOIN vagas v ON v.id = ca.vaga_id WHERE ca.id = ?`, e.candidatura_id) : null;
  return { h, a, e, ca };
}

// Convite (REQUEST) ou cancelamento (CANCEL) para o candidato e todos os participantes do horário
function avisarHorario(env, ctx, x, metodo, opts) {
  const { h, a, e, ca } = x;
  const o = opts || {};
  const participantes = participantesDoHorario(a, h);
  const candidato = { nome: ca.nome, email: ca.email };
  const organizador = { nome: env.EMAIL_NOME || "Innomaker Recrutamento", email: String(env.SMTP_FROM || env.SMTP_USER || "rh.innomaker@gmail.com").trim() };
  const quando = dataHoraExtenso(h.inicio) + " até " + horaDe(h.fim);
  const ics = icsEvento({
    uid: `horario-${h.id}@vagas.innomaker.com.br`, metodo, sequencia: h.sequencia,
    inicio: h.inicio, fim: h.fim, titulo: `${a.titulo || a.etapa_nome} — ${ca.nome} (${ca.vaga_titulo})`,
    descricao: [`Processo seletivo: ${ca.vaga_titulo}`, `Etapa: ${a.etapa_nome}`, `Candidato: ${ca.nome} — ${ca.email}${ca.telefone ? " — " + ca.telefone : ""}`,
      a.local_tipo === "online" ? "Link: " + a.local : "Local: " + a.local, a.instrucoes ? "Descrição: " + a.instrucoes : ""].filter(Boolean).join("\n"),
    local: a.local, organizador, participantes: [candidato, ...participantes]
  });
  const convite = { metodo, ics };
  const primeiro = String(ca.nome).split(" ")[0];
  const destaque = `<b>${esc(a.etapa_nome)}</b> — ${esc(ca.vaga_titulo)}<br>${esc(quando)}<br>${esc(descreverLocal(a))}`;

  if (o.candidato !== false) {
    if (metodo === "CANCEL") {
      enviar(env, ctx, ca.email, "Horário cancelado — " + a.etapa_nome, "Seu horário foi cancelado",
        [`Olá, <b>${esc(primeiro)}</b>.`, `O horário da etapa <b>${esc(a.etapa_nome)}</b> (${esc(quando)}) foi cancelado.`,
          o.motivo ? "<b>Motivo:</b> " + esc(o.motivo) : "", o.linkNovo ? "Escolha um novo horário pelo botão abaixo." : ""].filter(Boolean),
        o.linkNovo ? { texto: "Escolher novo horário", url: o.linkNovo } : null, convite);
    } else {
      enviar(env, ctx, ca.email, (o.atualizado ? "Horário atualizado — " : "Horário confirmado — ") + a.etapa_nome, o.atualizado ? "Seu horário foi atualizado" : "Seu horário está confirmado",
        [`Olá, <b>${esc(primeiro)}</b>!`, destaque, a.instrucoes ? "<b>Informações:</b><br>" + esc(a.instrucoes).replace(/\n/g, "<br>") : "",
          "O convite está anexado: clique em <b>Sim</b> para colocar na sua agenda. Se precisar trocar, use o botão abaixo (até 2 horas antes)."].filter(Boolean),
        { texto: "Ver ou trocar meu horário", url: linkAgendar(env, e.agenda_token) }, convite);
    }
  }
  const alvos = o.somente ? lerParticipantes(o.somente) : participantes;
  if (alvos.length) {
    const titulo = metodo === "CANCEL" ? "Entrevista cancelada" : o.atualizado ? "Entrevista atualizada" : "Entrevista agendada";
    enviar(env, ctx, alvos.map(p => p.email), `${titulo} — ${ca.nome} (${a.etapa_nome})`, titulo,
      [destaque, `<b>Candidato:</b> ${esc(ca.nome)} — ${esc(ca.email)}${ca.telefone ? " — " + esc(ca.telefone) : ""}`,
        o.motivo ? "<b>Motivo:</b> " + esc(o.motivo) : "",
        metodo === "CANCEL" ? "O evento sai da sua agenda ao abrir o convite." : "Clique em <b>Sim</b> no convite para colocar na sua agenda."].filter(Boolean),
      { texto: "Ver candidato no painel", url: linkPainel(env, "vaga/" + ca.vaga_id) }, convite);
  }
}

// Horários já reservados, em qualquer agenda, que envolvem alguém desta agenda (o mesmo entrevistador não fica em dois lugares)
async function ocupados(env, a, de, ate) {
  const meus = new Set(lerParticipantes(parseJson(a.participantes, [])).map(p => p.email));
  if (!meus.size) return [];
  const rs = await todos(env,
    `SELECT h.inicio, h.fim, h.participantes_extra, ag.participantes FROM agenda_horarios h JOIN agendas ag ON ag.id = h.agenda_id
      WHERE h.etapa_id IS NOT NULL AND h.fim > ? AND h.inicio < ?`, de, ate);
  return rs.filter(r => [...parseJson(r.participantes, []), ...parseJson(r.participantes_extra, [])].some(p => p && meus.has(String(p.email || "").toLowerCase())));
}

// Horários livres que o candidato pode escolher: no futuro (com a antecedência mínima) e sem conflito com outra entrevista
async function livresDisponiveis(env, a) {
  const minimo = agoraLocal(Date.now() + (a.antecedencia_horas || 0) * 3600000);
  const livres = await todos(env, "SELECT id, inicio, fim FROM agenda_horarios WHERE agenda_id = ? AND etapa_id IS NULL AND inicio > ? ORDER BY inicio", a.id, minimo);
  if (!livres.length) return [];
  const occ = await ocupados(env, a, livres[0].inicio, livres[livres.length - 1].fim);
  return livres.filter(h => !occ.some(o => sobrepoe(h.inicio, h.fim, o.inicio, o.fim)));
}

// Etapa "atual" do candidato: as anteriores aprovadas e esta pendente
function etapaAtual(etapas) {
  const ord = etapas.slice().sort((x, y) => x.ordem - y.ordem);
  for (const e of ord) {
    if (e.resultado === "Aprovado") continue;
    return e.resultado === "Pendente" ? e : null;
  }
  return null;
}

// =====================================================================
//  Painel (RH; o gerente da vaga só vê)
// =====================================================================
export async function agendaListar(env, ctx, b) {
  const vaga = await um(env, "SELECT id, titulo, etapas, gestor_nome, gestor_email FROM vagas WHERE id = ?", texto(b.vaga_id, 30));
  if (!vaga) throw new ErroApi("Vaga não encontrada.");
  const agendas = await todos(env, "SELECT * FROM agendas WHERE vaga_id = ? ORDER BY ativo DESC, criado_em DESC", vaga.id);
  const horarios = await todos(env,
    `SELECT h.*, c.nome AS candidato_nome, c.email AS candidato_email, ca.id AS candidatura_id
       FROM agenda_horarios h JOIN agendas a ON a.id = h.agenda_id
       LEFT JOIN etapas e ON e.id = h.etapa_id LEFT JOIN candidaturas ca ON ca.id = e.candidatura_id LEFT JOIN candidatos c ON c.id = ca.candidato_id
      WHERE a.vaga_id = ? ORDER BY h.inicio`, vaga.id);
  const cands = await todos(env,
    `SELECT ca.id, ca.status, c.nome, c.email FROM candidaturas ca JOIN candidatos c ON c.id = ca.candidato_id WHERE ca.vaga_id = ? ORDER BY c.nome`, vaga.id);
  const ets = await todos(env, "SELECT e.* FROM etapas e JOIN candidaturas ca ON ca.id = e.candidatura_id WHERE ca.vaga_id = ?", vaga.id);
  const agora_ = agoraLocal();

  const disponiveis = {};
  for (const a of agendas) disponiveis[a.id] = new Set((await livresDisponiveis(env, a)).map(h => h.id));
  const lista = agendas.map(a => {
    const hs = horarios.filter(h => h.agenda_id === a.id).map(h => ({
      id: h.id, inicio: h.inicio, fim: h.fim, reservado: !!h.etapa_id, passado: h.inicio < agora_, manual: !!h.manual,
      bloqueado: !h.etapa_id && h.inicio >= agora_ && !disponiveis[a.id].has(h.id),
      candidato_nome: h.candidato_nome || "", candidato_email: h.candidato_email || "", candidatura_id: h.candidatura_id || "",
      participantes_extra: parseJson(h.participantes_extra, [])
    }));
    // Quem pode receber o convite: candidato em processo com esta etapa como atual
    const elegiveis = cands.filter(c => c.status === "Em processo").map(c => {
      const atual = etapaAtual(ets.filter(e => e.candidatura_id === c.id));
      if (!atual || atual.nome !== a.etapa_nome) return null;
      const reserva = hs.find(h => h.candidatura_id === c.id);
      return { candidatura_id: c.id, nome: c.nome, email: c.email, convidado_em: atual.agenda_id === a.id ? atual.convidado_em : null,
        reservado: reserva ? reserva.inicio : null };
    }).filter(Boolean);
    return Object.assign({}, a, { participantes: parseJson(a.participantes, []), horarios: hs, elegiveis,
      disponibilidade: parseJson(a.disponibilidade, {}), excluidos: parseJson(a.excluidos, []),
      livres: disponiveis[a.id].size });
  });

  const etapasVaga = parseJson(vaga.etapas, ["Triagem"]);
  return {
    ok: true, agendas: lista,
    etapasAgendaveis: etapasVaga.filter((n, i) => i > 0 && !/triagem/i.test(n)),
    sugestaoParticipantes: lerParticipantes([vaga.gestor_email ? { nome: vaga.gestor_nome, email: vaga.gestor_email } : null].filter(Boolean))
  };
}

export async function agendaSalvar(env, ctx, b, u) {
  const vaga = await um(env, "SELECT id, titulo, etapas FROM vagas WHERE id = ?", texto(b.vaga_id, 30));
  if (!vaga) throw new ErroApi("Vaga não encontrada.");
  const etapasVaga = parseJson(vaga.etapas, ["Triagem"]);
  const etapa = texto(b.etapa_nome, 80);
  if (etapasVaga.indexOf(etapa) <= 0 || /triagem/i.test(etapa)) throw new ErroApi("Escolha uma etapa da vaga (a Triagem não tem agendamento).");
  const titulo = texto(b.titulo, 120) || etapa + " — " + vaga.titulo;
  const localTipo = b.local_tipo === "online" ? "online" : "presencial";
  const local = texto(b.local, 500);
  if (local.length < 3) throw new ErroApi(localTipo === "online" ? "Informe o link da reunião." : "Informe o endereço ou a sala.");
  const duracao = parseInt(b.duracao_min, 10);
  if (!(duracao >= 10 && duracao <= 480)) throw new ErroApi("Duração inválida (de 10 a 480 minutos).");
  const intervalo = Math.min(240, Math.max(0, parseInt(b.intervalo_min, 10) || 0));
  const antecedencia = Math.min(336, Math.max(0, parseInt(b.antecedencia_horas, 10) || 0));
  const participantes = lerParticipantes(b.participantes);
  if (!participantes.length) throw new ErroApi("Informe pelo menos um participante (o RH ou o funcionário que vai entrevistar).");
  const instrucoes = texto(b.descricao != null ? b.descricao : b.instrucoes, 4000);
  const disp = lerDisponibilidade(b.disponibilidade);
  if (disp === null) throw new ErroApi("Disponibilidade inválida: confira os horários (o início precisa ser antes do fim).");
  const temDisp = Object.keys(disp).length > 0;
  const de = texto(b.data_inicio, 10) || hojeISO(), ate = texto(b.data_fim, 10) || hojeISO(14);
  if (temDisp) {
    if (!ehDataISO(de) || !ehDataISO(ate)) throw new ErroApi("Informe o período (de / até).");
    if (ate < de) throw new ErroApi("O fim do período precisa ser depois do início.");
    if (ate > hojeISO(180)) throw new ErroApi("O período pode ir no máximo até 6 meses à frente.");
  }
  const t = agora();

  let id = parseInt(b.id, 10) || 0;
  let antes = null;
  if (id) {
    antes = await um(env, "SELECT * FROM agendas WHERE id = ? AND vaga_id = ?", id, vaga.id);
    if (!antes) throw new ErroApi("Agenda não encontrada.");
    await executar(env, `UPDATE agendas SET etapa_nome = ?, titulo = ?, local_tipo = ?, local = ?, duracao_min = ?, intervalo_min = ?, antecedencia_horas = ?,
      instrucoes = ?, participantes = ?, disponibilidade = ?, data_inicio = ?, data_fim = ?, atualizado_em = ? WHERE id = ?`,
      etapa, titulo, localTipo, local, duracao, intervalo, antecedencia, instrucoes, JSON.stringify(participantes), JSON.stringify(disp), de, ate, t, id);
  } else {
    const r = await executar(env, `INSERT INTO agendas (vaga_id, etapa_nome, titulo, local_tipo, local, duracao_min, intervalo_min, antecedencia_horas, instrucoes,
      participantes, disponibilidade, data_inicio, data_fim, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      vaga.id, etapa, titulo, localTipo, local, duracao, intervalo, antecedencia, instrucoes, JSON.stringify(participantes), JSON.stringify(disp), de, ate, quemE(u), t, t);
    id = r.meta.last_row_id;
  }
  const agoraL = agoraLocal();

  // Horários tirados à mão: os gerados entram em "excluídos" (não voltam); os criados à mão são apagados
  const excluidos = new Set(parseJson(antes && antes.excluidos, []).filter(x => x > agoraL));
  const remover = (Array.isArray(b.horarios_remover) ? b.horarios_remover : []).map(x => parseInt(x, 10)).filter(Boolean);
  for (const hid of remover) {
    const h = await um(env, "SELECT * FROM agenda_horarios WHERE id = ? AND agenda_id = ? AND etapa_id IS NULL", hid, id);
    if (!h) continue;
    if (!h.manual) excluidos.add(h.inicio);
    await executar(env, "DELETE FROM agenda_horarios WHERE id = ?", h.id);
  }
  // Horários da disponibilidade que o RH tirou na grade antes de salvar
  (Array.isArray(b.excluir) ? b.excluir : []).slice(0, 1500).map(x => String(x || "")).filter(ehHorarioLocal).forEach(x => excluidos.add(x));
  // Horários avulsos (clicando na grade) voltam a valer mesmo se estavam excluídos
  const novos = (Array.isArray(b.horarios_novos) ? b.horarios_novos : []).map(x => String(x || "").trim()).filter(Boolean).slice(0, 300);
  for (const ini of novos) { if (!ehHorarioLocal(ini)) throw new ErroApi("Horário inválido: " + ini); excluidos.delete(ini); }

  // Disponibilidade: o que deve existir; livres gerados antes que não cabem mais saem
  const gerados = temDisp ? gerarHorarios(disp, de, ate, duracao, intervalo).filter(x => x > agoraL && !excluidos.has(x)) : [];
  const desejados = new Set(gerados);
  const livres = await todos(env, "SELECT id, inicio, manual FROM agenda_horarios WHERE agenda_id = ? AND etapa_id IS NULL", id);
  for (const h of livres) {
    if (!h.manual && !desejados.has(h.inicio)) await executar(env, "DELETE FROM agenda_horarios WHERE id = ?", h.id);
    else await executar(env, "UPDATE agenda_horarios SET fim = ? WHERE id = ?", somarMinutos(h.inicio, duracao), h.id);
  }
  let criados = 0;
  for (const ini of gerados) {
    const r = await executar(env, "INSERT OR IGNORE INTO agenda_horarios (agenda_id, inicio, fim, manual) VALUES (?, ?, ?, 0)", id, ini, somarMinutos(ini, duracao));
    criados += r.meta.changes || 0;
  }
  for (const ini of novos) {
    if (ini <= agoraL) continue;
    const r = await executar(env, "INSERT OR IGNORE INTO agenda_horarios (agenda_id, inicio, fim, manual) VALUES (?, ?, ?, 1)", id, ini, somarMinutos(ini, duracao));
    criados += r.meta.changes || 0;
  }
  await executar(env, "UPDATE agendas SET excluidos = ? WHERE id = ?", JSON.stringify([...excluidos].sort()), id);

  // Mudou local, descrição ou participantes: atualiza o convite de quem já reservou
  if (antes && (antes.local !== local || antes.local_tipo !== localTipo || antes.instrucoes !== instrucoes || antes.participantes !== JSON.stringify(participantes) || antes.titulo !== titulo)) {
    const reservados = await todos(env, "SELECT id FROM agenda_horarios WHERE agenda_id = ? AND etapa_id IS NOT NULL", id);
    for (const h of reservados) {
      await executar(env, "UPDATE agenda_horarios SET sequencia = sequencia + 1 WHERE id = ?", h.id);
      const x = await contextoDoHorario(env, h.id);
      if (x && x.ca) avisarHorario(env, ctx, x, "REQUEST", { atualizado: true });
    }
  }
  const total = await um(env, "SELECT COUNT(*) AS n FROM agenda_horarios WHERE agenda_id = ? AND etapa_id IS NULL AND inicio > ?", id, agoraL);
  await registrarLog(env, quemE(u), antes ? "AGENDA_EDITADA" : "AGENDA_CRIADA", "vaga", vaga.id, titulo + " — " + total.n + " horário(s) livre(s)");
  return { ok: true, id, criados, livres: total.n };
}

export async function agendaEncerrar(env, ctx, b, u) {
  const a = await um(env, "SELECT * FROM agendas WHERE id = ?", parseInt(b.id, 10) || 0);
  if (!a) throw new ErroApi("Agenda não encontrada.");
  const ativo = b.ativo === true ? 1 : 0;
  await executar(env, "UPDATE agendas SET ativo = ?, atualizado_em = ? WHERE id = ?", ativo, agora(), a.id);
  await registrarLog(env, quemE(u), ativo ? "AGENDA_REABERTA" : "AGENDA_ENCERRADA", "vaga", a.vaga_id, a.etapa_nome);
  return { ok: true };
}

// Envia o link de agendamento aos candidatos escolhidos
export async function agendaConvidar(env, ctx, b, u) {
  const a = await um(env, "SELECT a.*, v.titulo AS vaga_titulo FROM agendas a JOIN vagas v ON v.id = a.vaga_id WHERE a.id = ?", parseInt(b.agenda_id, 10) || 0);
  if (!a) throw new ErroApi("Agenda não encontrada.");
  if (!a.ativo) throw new ErroApi("Esta agenda está encerrada. Reabra para enviar convites.");
  if (!(await livresDisponiveis(env, a)).length) throw new ErroApi("A agenda não tem horários livres. Adicione horários antes de enviar.");
  const ids = (Array.isArray(b.candidatura_ids) ? b.candidatura_ids : []).map(x => texto(x, 30)).filter(Boolean);
  if (!ids.length) throw new ErroApi("Escolha pelo menos um candidato.");

  const enviados = [], ignorados = [];
  for (const cid of ids) {
    const ca = await um(env, "SELECT ca.*, c.nome, c.email FROM candidaturas ca JOIN candidatos c ON c.id = ca.candidato_id WHERE ca.id = ? AND ca.vaga_id = ?", cid, a.vaga_id);
    if (!ca) { ignorados.push({ nome: cid, motivo: "candidatura não encontrada" }); continue; }
    if (ca.status !== "Em processo") { ignorados.push({ nome: ca.nome, motivo: "não está em processo" }); continue; }
    const atual = etapaAtual(await todos(env, "SELECT * FROM etapas WHERE candidatura_id = ?", ca.id));
    if (!atual || atual.nome !== a.etapa_nome) { ignorados.push({ nome: ca.nome, motivo: "a etapa atual não é " + a.etapa_nome }); continue; }
    const reserva = await um(env, "SELECT inicio FROM agenda_horarios WHERE etapa_id = ?", atual.id);
    if (reserva) { ignorados.push({ nome: ca.nome, motivo: "já reservou " + dataHoraExtenso(reserva.inicio) }); continue; }
    const token = atual.agenda_token || (crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8));
    await executar(env, "UPDATE etapas SET agenda_id = ?, agenda_token = ?, convidado_em = ? WHERE id = ?", a.id, token, agora(), atual.id);
    const primeiro = String(ca.nome).split(" ")[0];
    enviar(env, ctx, ca.email, "Escolha seu horário — " + (a.titulo || a.etapa_nome), "Escolha o seu horário",
      [`Olá, <b>${esc(primeiro)}</b>!`,
        `Você avançou no processo seletivo para <b>${esc(a.vaga_titulo)}</b>. A próxima etapa é <b>${esc(a.etapa_nome)}</b> (${a.duracao_min} minutos).`,
        `<b>${a.local_tipo === "online" ? "Online" : "Local"}:</b> ${esc(a.local_tipo === "online" ? "o link da reunião vai no convite após a reserva" : a.local)}`,
        a.instrucoes ? "<b>Informações:</b><br>" + esc(a.instrucoes).replace(/\n/g, "<br>") : "",
        "Clique no botão abaixo e escolha um dos horários disponíveis. Os horários são reservados por ordem de escolha."].filter(Boolean),
      { texto: "Escolher meu horário", url: linkAgendar(env, token) });
    enviados.push(ca.nome);
  }
  await registrarLog(env, quemE(u), "AGENDA_CONVITES", "vaga", a.vaga_id, a.etapa_nome + ": " + enviados.length + " enviado(s)");
  return { ok: true, enviados, ignorados };
}

// RH cancela um horário reservado (libera para outro candidato) e, se quiser, manda o link para escolher outro
export async function agendaCancelarReserva(env, ctx, b, u) {
  const x = await contextoDoHorario(env, parseInt(b.horario_id, 10) || 0);
  if (!x || !x.h.etapa_id) throw new ErroApi("Este horário não está reservado.");
  const motivo = texto(b.motivo, 500);
  await executar(env, "UPDATE agenda_horarios SET sequencia = sequencia + 1 WHERE id = ?", x.h.id);
  x.h.sequencia += 1;
  const reenviar = b.reenviar !== false && x.a.ativo;
  avisarHorario(env, ctx, x, "CANCEL", { motivo, linkNovo: reenviar ? linkAgendar(env, x.e.agenda_token) : "" });
  await executar(env, "UPDATE agenda_horarios SET etapa_id = NULL, reservado_em = NULL, participantes_extra = '[]' WHERE id = ?", x.h.id);
  await executar(env, "UPDATE etapas SET data_prevista = '' WHERE id = ?", x.e.id);
  await registrarLog(env, quemE(u), "AGENDA_RESERVA_CANCELADA", "candidatura", x.ca.id, dataHoraExtenso(x.h.inicio) + (motivo ? " — " + motivo : ""));
  return { ok: true };
}

// Convidar mais alguém só para esta entrevista
export async function agendaParticipante(env, ctx, b, u) {
  const x = await contextoDoHorario(env, parseInt(b.horario_id, 10) || 0);
  if (!x || !x.h.etapa_id) throw new ErroApi("Só é possível convidar pessoas para um horário reservado.");
  const novos = lerParticipantes(b.participantes);
  if (!novos.length) throw new ErroApi("Informe o e-mail de quem você quer convidar.");
  const atuais = participantesDoHorario(x.a, x.h).map(p => p.email);
  const realmenteNovos = novos.filter(p => atuais.indexOf(p.email) < 0);
  if (!realmenteNovos.length) throw new ErroApi("Essas pessoas já estão convidadas.");
  const extra = lerParticipantes([...parseJson(x.h.participantes_extra, []), ...realmenteNovos]);
  await executar(env, "UPDATE agenda_horarios SET participantes_extra = ? WHERE id = ?", JSON.stringify(extra), x.h.id);
  x.h.participantes_extra = JSON.stringify(extra);
  avisarHorario(env, ctx, x, "REQUEST", { candidato: false, somente: realmenteNovos });
  await registrarLog(env, quemE(u), "AGENDA_PARTICIPANTE", "candidatura", x.ca.id, realmenteNovos.map(p => p.email).join(", "));
  return { ok: true, convidados: realmenteNovos.length };
}

// Libera os horários reservados de uma candidatura (candidato excluído, desistência ou recusa).
// Horários futuros: avisa os participantes que a entrevista foi cancelada.
export async function liberarReservasDaCandidatura(env, ctx, candidaturaId, motivo) {
  const hs = await todos(env,
    "SELECT h.id, h.inicio FROM agenda_horarios h JOIN etapas e ON e.id = h.etapa_id WHERE e.candidatura_id = ?", candidaturaId);
  const agoraL = agoraLocal();
  for (const h of hs) {
    if (h.inicio > agoraL && ctx) {
      await executar(env, "UPDATE agenda_horarios SET sequencia = sequencia + 1 WHERE id = ?", h.id);
      const x = await contextoDoHorario(env, h.id);
      if (x && x.ca) avisarHorario(env, ctx, x, "CANCEL", { candidato: false, motivo });
    }
    await executar(env, "UPDATE agenda_horarios SET etapa_id = NULL, reservado_em = NULL, participantes_extra = '[]', lembrete_em = NULL WHERE id = ?", h.id);
  }
  return hs.length;
}

// Lembrete 1 dia antes (rotina de hora em hora): candidato e participantes, uma vez por horário
export async function lembretesDeEntrevista(env) {
  const de = agoraLocal(Date.now() + 20 * 3600000), ate = agoraLocal(Date.now() + 28 * 3600000);
  const hs = await todos(env,
    "SELECT id FROM agenda_horarios WHERE etapa_id IS NOT NULL AND lembrete_em IS NULL AND inicio > ? AND inicio <= ?", de, ate);
  const fila = [];
  const ctxLocal = { waitUntil: p => fila.push(p) };
  for (const { id } of hs) {
    const x = await contextoDoHorario(env, id);
    if (!x || !x.ca || x.ca.status !== "Em processo") continue;
    const { h, a, e, ca } = x;
    const quando = dataHoraExtenso(h.inicio) + " até " + horaDe(h.fim);
    const primeiro = String(ca.nome).split(" ")[0];
    enviar(env, ctxLocal, ca.email, "Lembrete: " + a.etapa_nome + " amanhã — " + ca.vaga_titulo, "Sua entrevista é amanhã",
      [`Olá, <b>${esc(primeiro)}</b>!`, `Lembrete da etapa <b>${esc(a.etapa_nome)}</b> do processo seletivo para <b>${esc(ca.vaga_titulo)}</b>:`,
        `<b>${esc(quando)}</b><br>${esc(descreverLocal(a))}`,
        a.instrucoes ? "<b>Informações:</b><br>" + esc(a.instrucoes).replace(/\n/g, "<br>") : "",
        "Se não puder comparecer, troque o horário pelo botão abaixo (até 2 horas antes) ou fale com o RH."].filter(Boolean),
      { texto: "Ver ou trocar meu horário", url: linkAgendar(env, e.agenda_token) });
    const parts = participantesDoHorario(a, h);
    if (parts.length) {
      enviar(env, ctxLocal, parts.map(p => p.email), `Lembrete: entrevista amanhã — ${ca.nome} (${a.etapa_nome})`, "Entrevista amanhã",
        [`<b>${esc(a.etapa_nome)}</b> — ${esc(ca.vaga_titulo)}<br>${esc(quando)}<br>${esc(descreverLocal(a))}`,
          `<b>Candidato:</b> ${esc(ca.nome)} — ${esc(ca.email)}`],
        { texto: "Ver candidato no painel", url: linkPainel(env, "vaga/" + ca.vaga_id) });
    }
    await executar(env, "UPDATE agenda_horarios SET lembrete_em = ? WHERE id = ?", agora(), h.id);
  }
  await Promise.allSettled(fila);
  return hs.length;
}

// =====================================================================
//  Candidato (link /agendar/<token>, sem login)
// =====================================================================
async function etapaDoToken(env, token) {
  const t = String(token || "").replace(/[^a-f0-9]/gi, "");
  if (t.length < 32) return null;
  const e = await um(env, "SELECT * FROM etapas WHERE agenda_token = ?", t);
  if (!e) return null;
  const a = e.agenda_id ? await um(env, "SELECT a.*, v.titulo AS vaga_titulo FROM agendas a JOIN vagas v ON v.id = a.vaga_id WHERE a.id = ?", e.agenda_id) : null;
  const ca = await um(env, "SELECT ca.*, c.nome, c.email FROM candidaturas ca JOIN candidatos c ON c.id = ca.candidato_id WHERE ca.id = ?", e.candidatura_id);
  return a && ca ? { e, a, ca } : null;
}

export async function apiAgendamento(request, env, ctx, resto) {
  const [token, acao] = String(resto || "").split("/");
  try {
    const x = await etapaDoToken(env, decodeURIComponent(token || ""));
    if (!x) return json({ ok: false, erro: "Link de agendamento inválido ou expirado. Fale com o RH." }, 404);
    const { e, a, ca } = x;
    const reserva = await um(env, "SELECT * FROM agenda_horarios WHERE etapa_id = ?", e.id);
    const aberto = e.resultado === "Pendente" && ca.status === "Em processo";

    if (request.method === "GET" && !acao) {
      const livres = a.ativo && aberto && !reserva ? await livresDisponiveis(env, a) : [];
      return json({
        ok: true,
        candidato: String(ca.nome).split(" ")[0], vaga: a.vaga_titulo, etapa: a.etapa_nome, titulo: a.titulo || a.etapa_nome, duracao_min: a.duracao_min,
        participantes: lerParticipantes(parseJson(a.participantes, [])).map(p => p.nome || p.email),
        local_tipo: a.local_tipo, local: a.local_tipo === "online" && !reserva ? "" : a.local, instrucoes: a.instrucoes,
        reserva: reserva ? { inicio: reserva.inicio, fim: reserva.fim, podeTrocar: aberto && somarMinutos(agoraLocal(), ANTECEDENCIA_TROCA_MIN) < reserva.inicio } : null,
        livres, aberto: aberto && !!a.ativo,
        motivoFechado: !aberto ? "Esta etapa já foi concluída." : !a.ativo ? "A agenda foi encerrada pelo RH. Fale com o RH para combinar outro horário." : ""
      });
    }

    if (request.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);
    if (!mesmaOrigem(request, new URL(request.url))) return json({ ok: false, erro: "Origem não permitida." }, 403);
    if (!aberto) return json({ ok: false, erro: "Esta etapa já foi concluída." });

    if (acao === "reservar") {
      if (!a.ativo) return json({ ok: false, erro: "A agenda foi encerrada pelo RH." });
      if (reserva) return json({ ok: false, erro: "Você já tem um horário reservado. Para mudar, use \"Trocar horário\"." });
      const b = await lerJson(request);
      const hid = parseInt(b.horario_id, 10) || 0;
      const h = await um(env, "SELECT * FROM agenda_horarios WHERE id = ? AND agenda_id = ?", hid, a.id);
      if (!h) return json({ ok: false, erro: "Horário não encontrado." });
      if (h.inicio <= agoraLocal()) return json({ ok: false, erro: "Esse horário já passou. Escolha outro." });
      if (!(await livresDisponiveis(env, a)).some(x => x.id === h.id)) return json({ ok: false, ocupado: true, erro: "Esse horário não está mais disponível. Escolha outro." }, 409);
      // Reserva atômica: só ocupa se ainda estiver livre
      let r;
      try {
        r = await executar(env, "UPDATE agenda_horarios SET etapa_id = ?, reservado_em = ?, participantes_extra = '[]' WHERE id = ? AND etapa_id IS NULL",
          e.id, agora(), h.id);
      } catch (erro) {
        return json({ ok: false, erro: "Você já tem um horário reservado." });
      }
      if (!r.meta.changes) return json({ ok: false, ocupado: true, erro: "Esse horário acabou de ser reservado por outra pessoa. Escolha outro." }, 409);
      await executar(env, "UPDATE etapas SET data_prevista = ? WHERE id = ?", h.inicio.slice(0, 10), e.id);
      const ctxH = await contextoDoHorario(env, h.id);
      avisarHorario(env, ctx, ctxH, "REQUEST");
      await registrarLog(env, ca.email, "AGENDA_RESERVA", "candidatura", ca.id, a.etapa_nome + " — " + dataHoraExtenso(h.inicio));
      return json({ ok: true, inicio: h.inicio, fim: h.fim });
    }

    if (acao === "liberar") {
      if (!reserva) return json({ ok: false, erro: "Você não tem horário reservado." });
      if (!(somarMinutos(agoraLocal(), ANTECEDENCIA_TROCA_MIN) < reserva.inicio)) {
        return json({ ok: false, erro: "Faltam menos de 2 horas para o horário. Para mudar, fale com o RH." });
      }
      await executar(env, "UPDATE agenda_horarios SET sequencia = sequencia + 1 WHERE id = ?", reserva.id);
      const ctxH = await contextoDoHorario(env, reserva.id);
      avisarHorario(env, ctx, ctxH, "CANCEL", { candidato: false, motivo: "o candidato pediu para trocar de horário" });
      await executar(env, "UPDATE agenda_horarios SET etapa_id = NULL, reservado_em = NULL, participantes_extra = '[]' WHERE id = ?", reserva.id);
      await executar(env, "UPDATE etapas SET data_prevista = '' WHERE id = ?", e.id);
      await registrarLog(env, ca.email, "AGENDA_RESERVA_LIBERADA", "candidatura", ca.id, dataHoraExtenso(reserva.inicio));
      return json({ ok: true });
    }
    return json({ ok: false, erro: "Ação desconhecida." }, 404);
  } catch (erro) {
    if (erro instanceof ErroApi) return json({ ok: false, erro: erro.message });
    console.log("apiAgendamento", erro && erro.stack);
    return json({ ok: false, erro: "Erro interno. Tente novamente em instantes." }, 500);
  }
}
