import { createHash } from "node:crypto";
import { executar, todos, registrarLog } from "./db.js";
import { agora } from "./http.js";
import { lerParticipantes, somarMinutos } from "./agenda.js";

export const CALENDARIO_PADRAO = "0f5e8952482afdf6e7a1764b5991182e002722d6deb9c3f4127488cde1fbbce4@group.calendar.google.com";
export const googleConfigurado = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);

export function eventoGoogle({ titulo, descricao, local, inicio, fim, participantes }) {
  const data = inicio.length === 10;
  return {
    summary: titulo, description: descricao || "", location: local || "", status: "confirmed",
    start: data ? { date: inicio, dateTime: null, timeZone: null } : { date: null, dateTime: inicio + ":00-03:00", timeZone: "America/Sao_Paulo" },
    end: data ? { date: somarMinutos(inicio + "T00:00", 1440).slice(0, 10), dateTime: null, timeZone: null }
      : { date: null, dateTime: fim + ":00-03:00", timeZone: "America/Sao_Paulo" },
    attendees: lerParticipantes(participantes).map(p => ({ email: p.email, ...(p.nome ? { displayName: p.nome } : {}) })),
    guestsCanModify: false, guestsCanInviteOthers: false, visibility: "private"
  };
}

// Grava antes de liberar uma reserva; cancelamentos sobrevivem à exclusão dos dados de origem.
export async function enfileirarGoogle(env, ctx, chave, dados, cancelar = false) {
  const calendar = env.GOOGLE_CALENDAR_ID || CALENDARIO_PADRAO;
  // ID determinístico: repetir um envio após timeout não duplica o evento.
  const id = createHash("sha256").update((env.SITE_URL || "") + ":" + chave).digest("hex");
  await executar(env, `INSERT INTO google_calendar_eventos (chave, calendar_id, event_id, evento, cancelar, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chave) DO UPDATE SET evento = excluded.evento,
    cancelar = excluded.cancelar, versao = versao + 1, pendente = 1, erro = '', atualizado_em = excluded.atualizado_em`,
  chave, calendar, id, cancelar ? "{}" : JSON.stringify(eventoGoogle(dados)), cancelar ? 1 : 0, agora());
  if (ctx) ctx.waitUntil(sincronizarGoogle(env));
}

const filas = new WeakMap();
export function sincronizarGoogle(env) {
  if (!googleConfigurado(env)) return Promise.resolve();
  const anterior = filas.get(env) || Promise.resolve();
  const proxima = anterior.catch(() => {}).then(() => processar(env));
  filas.set(env, proxima);
  return proxima;
}

async function processar(env) {
  const pendentes = await todos(env, "SELECT * FROM google_calendar_eventos WHERE pendente = 1 ORDER BY atualizado_em LIMIT 100");
  if (!pendentes.length) return;
  const request = env.GOOGLE_FETCH || fetch;
  let token;
  try {
    const r = await request("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }) });
    const body = await r.json();
    if (!r.ok || !body.access_token) throw new Error("Google OAuth: autorização recusada. Confira as credenciais no backend.");
    token = body.access_token;
  } catch {
    await registrarLog(env, "sistema", "GOOGLE_CALENDAR_ERRO", "agenda", "", "Não foi possível autorizar o Google Calendar. Os eventos continuam pendentes.");
    return;
  }
  for (const item of pendentes) {
    try {
      const base = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(item.calendar_id) + "/events";
      const url = base + "/" + item.event_id + "?sendUpdates=all";
      const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
      const call = (u, method, body) => request(u, { method, headers, signal: AbortSignal.timeout(15000), ...(body ? { body: JSON.stringify(body) } : {}) });
      let r;
      if (item.cancelar) {
        r = await call(url, "DELETE");
        if (![404, 410].includes(r.status) && !r.ok) throw new Error("Google Calendar HTTP " + r.status);
      } else {
        const evento = JSON.parse(item.evento);
        // PATCH preserva respostas de presença e dados que o Google acrescenta ao evento.
        r = await call(url, "PATCH", evento);
        if (r.status === 404) {
          r = await call(base + "?sendUpdates=all", "POST", { id: item.event_id, ...evento });
          if (r.status === 409) r = await call(url, "PATCH", evento);
        }
        if (!r.ok) throw new Error("Google Calendar HTTP " + r.status);
      }
      await executar(env, "UPDATE google_calendar_eventos SET pendente = 0, erro = '', evento = '{}' WHERE chave = ? AND versao = ?", item.chave, item.versao);
    } catch (erro) {
      const mensagem = erro.message.startsWith("Google Calendar HTTP") ? erro.message : "Falha de conexão com o Google Calendar";
      await executar(env, "UPDATE google_calendar_eventos SET erro = ? WHERE chave = ? AND versao = ?", mensagem, item.chave, item.versao);
      await registrarLog(env, "sistema", "GOOGLE_CALENDAR_ERRO", "agenda", item.chave, mensagem + ". Nova tentativa na rotina automática.");
    }
  }
}
