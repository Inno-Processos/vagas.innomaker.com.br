import { test } from "node:test";
import assert from "node:assert/strict";
import { ambiente, criarVaga } from "./apoio.js";
import { enfileirarGoogle, sincronizarGoogle, CALENDARIO_PADRAO } from "../backend/src/lib/googleCalendar.js";
import { agoraLocal, somarMinutos } from "../backend/src/lib/agenda.js";

const dados = {
  titulo: "Entrevista · Ana", inicio: "2099-11-10T14:00", fim: "2099-11-10T14:30", local: "Sala 1",
  participantes: [{ nome: "Ana", email: "ANA@x.com" }, { nome: "RH", email: "rh@x.com" }, { email: "ana@x.com" }]
};

function googleFalso(env) {
  const eventos = new Map(), chamadas = [];
  let falhar = false;
  Object.assign(env, { GOOGLE_CLIENT_ID: "cliente", GOOGLE_CLIENT_SECRET: "segredo", GOOGLE_REFRESH_TOKEN: "refresh" });
  env.GOOGLE_FETCH = async (url, opts) => {
    if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "token" });
    const body = opts.body ? JSON.parse(opts.body) : null;
    chamadas.push({ url, method: opts.method, body });
    assert.equal(opts.headers.Authorization, "Bearer token");
    if (falhar) return new Response(null, { status: 503 });
    const id = url.split("/events/")[1]?.split("?")[0] || body.id;
    if (opts.method === "DELETE") { eventos.delete(id); return new Response(null, { status: 204 }); }
    if (opts.method === "PATCH" && !eventos.has(id)) return new Response(null, { status: 404 });
    if (opts.method === "POST" && eventos.has(id)) return new Response(null, { status: 409 });
    eventos.set(id, body);
    return Response.json(body);
  };
  return { eventos, chamadas, falhar: v => { falhar = v; } };
}

test("Google: persiste sem credenciais, cria sem duplicar, atualiza convidados, tenta novamente e cancela", async () => {
  const t = ambiente();
  await enfileirarGoogle(t.env, null, "teste-1", dados);
  assert.equal((await t.env.DB.prepare("SELECT pendente FROM google_calendar_eventos").first()).pendente, 1);
  const g = googleFalso(t.env);
  await sincronizarGoogle(t.env);
  assert.equal(g.eventos.size, 1);
  const [id, evento] = [...g.eventos][0];
  assert.equal(evento.start.dateTime, "2099-11-10T14:00:00-03:00");
  assert.equal(evento.start.timeZone, "America/Sao_Paulo");
  assert.deepEqual(evento.attendees.map(p => p.email), ["ana@x.com", "rh@x.com"]);
  assert.ok(g.chamadas.every(c => c.url.includes(encodeURIComponent(CALENDARIO_PADRAO)) && c.url.includes("sendUpdates=all")));

  g.falhar(true);
  await enfileirarGoogle(t.env, null, "teste-1", { ...dados, titulo: "Remarcada", participantes: [...dados.participantes, { email: "gestor@x.com" }] });
  await sincronizarGoogle(t.env);
  const pendente = await t.env.DB.prepare("SELECT * FROM google_calendar_eventos").first();
  assert.equal(pendente.pendente, 1);
  assert.match(pendente.erro, /503/);
  g.falhar(false);
  await sincronizarGoogle(t.env);
  assert.equal(g.eventos.size, 1);
  assert.equal(g.eventos.get(id).summary, "Remarcada");
  assert.equal(g.eventos.get(id).attendees.length, 3);

  await enfileirarGoogle(t.env, null, "teste-1", null, true);
  await sincronizarGoogle(t.env);
  assert.equal(g.eventos.size, 0);
  const cancelado = await t.env.DB.prepare("SELECT * FROM google_calendar_eventos").first();
  assert.equal(cancelado.pendente, 0);
  assert.equal(cancelado.evento, "{}", "cancelamento não retém dados pessoais na fila");
});

test("Google: timeout após criação usa o mesmo ID ao tentar de novo", async () => {
  const t = ambiente(), g = googleFalso(t.env);
  const request = t.env.GOOGLE_FETCH;
  let timeout = true;
  t.env.GOOGLE_FETCH = async (url, opts) => {
    const r = await request(url, opts);
    if (opts.method === "POST" && url.includes("/events") && timeout) { timeout = false; throw new Error("timeout"); }
    return r;
  };
  await enfileirarGoogle(t.env, null, "teste-timeout", dados);
  await sincronizarGoogle(t.env);
  assert.equal((await t.env.DB.prepare("SELECT pendente FROM google_calendar_eventos").first()).pendente, 1);
  await sincronizarGoogle(t.env);
  assert.equal(g.eventos.size, 1);
  assert.equal((await t.env.DB.prepare("SELECT pendente FROM google_calendar_eventos").first()).pendente, 0);
});

test("Google: agendamento fixo inclui candidato, RH e convidados mesmo sem aviso SMTP", async () => {
  const t = ambiente(), g = googleFalso(t.env);
  const vaga = await criarVaga(t.staff, "Entrevista Google");
  await t.inscrever(vaga, { nome: "Ana Google", email: "ana@x.com" });
  const c = (await t.staff("vaga_detalhe", { id: vaga })).candidatos[0];
  const e = c.etapas.find(e => e.ordem === 2);
  const data = somarMinutos(agoraLocal(), 4320).slice(0, 10);
  const r = await t.staff("etapa_agendar", { etapa_id: e.id, data, hora: "14:00", participantes: "Teste <teste@x.com>", avisar: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(g.eventos.size, 1);
  let evento = [...g.eventos.values()][0];
  assert.ok(evento.attendees.some(p => p.email === "ana@x.com"));
  assert.ok(evento.attendees.some(p => p.email === "teste@x.com"));
  assert.ok(evento.attendees.some(p => p.email === "rh@innomaker.com.br"));
  const semHora = await t.staff("etapa_agendar", { etapa_id: e.id, data, avisar: false });
  assert.equal(semHora.ok, true);
  assert.equal(g.eventos.size, 1);
  evento = [...g.eventos.values()][0];
  assert.equal(evento.start.date, data);
  assert.ok(evento.end.date > data);
  assert.equal(evento.start.dateTime, null);
  await t.staff("candidatura_status", { id: c.id, status: "Desistiu" });
  assert.equal(g.eventos.size, 0);
});

test("Google: reserva, convidado extra, cancelamento e nova reserva sincronizam pela API", async () => {
  const t = ambiente(), g = googleFalso(t.env);
  const vaga = await criarVaga(t.staff, "Reserva Google");
  await t.inscrever(vaga, { nome: "Ana Reserva", email: "ana@x.com" });
  const c = (await t.staff("vaga_detalhe", { id: vaga })).candidatos[0];
  await t.staff("etapa_atualizar", { etapa_id: c.etapas.find(e => e.ordem === 1).id, resultado: "Aprovado", nota: 3, analise: "Bom currículo" });
  const inicio = somarMinutos(agoraLocal(), 4320);
  const ag = await t.staff("agenda_salvar", { vaga_id: vaga, etapa_nome: "Entrevista RH", local: "Sala 1", duracao_min: 30, participantes: "rh@x.com", horarios_novos: [inicio] });
  await t.staff("agenda_convidar", { agenda_id: ag.id, candidatura_ids: [c.id] });
  const e = await t.env.DB.prepare("SELECT * FROM etapas WHERE candidatura_id = ? AND ordem = 2").bind(c.id).first();
  const h = await t.env.DB.prepare("SELECT id FROM agenda_horarios WHERE agenda_id = ?").bind(ag.id).first();
  const reservar = () => t.chamar(`/api/agendar/${e.agenda_token}/reservar`, { body: { horario_id: h.id } });
  assert.equal((await reservar()).json.ok, true);
  assert.equal(g.eventos.size, 1);
  await t.staff("agenda_participante", { horario_id: h.id, participantes: "gestor@x.com" });
  assert.ok([...g.eventos.values()][0].attendees.some(p => p.email === "gestor@x.com"));
  await t.staff("agenda_cancelar_reserva", { horario_id: h.id });
  assert.equal(g.eventos.size, 0);
  assert.equal((await reservar()).json.ok, true);
  assert.equal(g.eventos.size, 1);
});
