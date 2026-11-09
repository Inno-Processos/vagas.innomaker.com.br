// Agendamento: datas/horas de Brasília e convite de calendário (.ics) para candidato, RH e convidados.
import { parseJson, emailValido } from "./http.js";

// Brasília é UTC−3 o ano todo (sem horário de verão desde 2019)
const OFFSET_MS = 3 * 60 * 60 * 1000;
const RX_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const ehHorarioLocal = s => RX_LOCAL.test(String(s || ""));

export function localParaDate(s) {
  const m = RX_LOCAL.exec(String(s || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + OFFSET_MS);
}

export function somarMinutos(local, min) {
  const d = localParaDate(local);
  if (!d) return "";
  const x = new Date(d.getTime() - OFFSET_MS + min * 60000);
  const p = n => String(n).padStart(2, "0");
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
// "terça-feira, 10/11/2026 às 14:00"
export function dataHoraExtenso(local) {
  const m = RX_LOCAL.exec(String(local || ""));
  if (!m) return String(local || "");
  const dia = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${DIAS[dia]}, ${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}`;
}
export const horaDe = local => String(local || "").slice(11, 16);

// Agora em Brasília, "AAAA-MM-DDTHH:MM" (mesmo formato dos horários da agenda)
export function agoraLocal(ms) {
  const x = new Date((ms == null ? Date.now() : ms) - OFFSET_MS);
  const p = n => String(n).padStart(2, "0");
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

// "Nome <email>" ou "email" (um por linha ou separado por vírgula) → [{ nome, email }]
export function lerParticipantes(entrada) {
  const itens = Array.isArray(entrada) ? entrada : String(entrada || "").split(/[\n,;]+/);
  const vistos = new Set();
  const lista = [];
  for (const it of itens) {
    let nome = "", email = "";
    if (it && typeof it === "object") { nome = String(it.nome || "").trim(); email = String(it.email || "").trim(); }
    else {
      const t = String(it || "").trim();
      const m = /^(.*)<([^>]+)>\s*$/.exec(t);
      if (m) { nome = m[1].trim().replace(/^"|"$/g, ""); email = m[2].trim(); } else email = t;
    }
    email = email.toLowerCase();
    if (!email || !emailValido(email) || vistos.has(email)) continue;
    vistos.add(email);
    lista.push({ nome: nome.slice(0, 120), email });
  }
  return lista;
}

export function participantesDoHorario(agenda, horario) {
  return lerParticipantes([...parseJson(agenda.participantes, []), ...parseJson(horario && horario.participantes_extra, [])]);
}

// ---------- Convite de calendário (RFC 5545) ----------
const utc = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escIcs = s => String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
// linhas de no máximo 75 bytes (dobra com espaço no começo da continuação)
function dobrar(linha) {
  const bytes = Buffer.from(linha, "utf8");
  if (bytes.length <= 75) return linha;
  const partes = [];
  let atual = "";
  for (const ch of linha) {
    if (Buffer.byteLength(atual + ch, "utf8") > (partes.length ? 74 : 75)) { partes.push(atual); atual = ""; }
    atual += ch;
  }
  partes.push(atual);
  return partes.join("\r\n ");
}

// metodo: REQUEST (marcar/atualizar) ou CANCEL (desmarcar). uid fixo por horário, para atualizar/cancelar o mesmo evento.
export function icsEvento({ uid, metodo, sequencia, inicio, fim, titulo, descricao, local, organizador, participantes }) {
  const ini = localParaDate(inicio), f = localParaDate(fim);
  const linhas = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Innomaker//Vagas//PT-BR", "CALSCALE:GREGORIAN", "METHOD:" + (metodo || "REQUEST"),
    "BEGIN:VEVENT",
    "UID:" + uid,
    "SEQUENCE:" + (sequencia || 0),
    "DTSTAMP:" + utc(new Date()),
    "DTSTART:" + utc(ini),
    "DTEND:" + utc(f),
    "SUMMARY:" + escIcs(titulo),
    descricao ? "DESCRIPTION:" + escIcs(descricao) : null,
    local ? "LOCATION:" + escIcs(local) : null,
    organizador ? `ORGANIZER;CN=${escIcs(organizador.nome || organizador.email)}:mailto:${organizador.email}` : null,
    ...(participantes || []).map(p => `ATTENDEE;CN=${escIcs(p.nome || p.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${p.email}`),
    "STATUS:" + (metodo === "CANCEL" ? "CANCELLED" : "CONFIRMED"),
    metodo === "CANCEL" ? null : "BEGIN:VALARM",
    metodo === "CANCEL" ? null : "TRIGGER:-PT1H",
    metodo === "CANCEL" ? null : "ACTION:DISPLAY",
    metodo === "CANCEL" ? null : "DESCRIPTION:" + escIcs(titulo),
    metodo === "CANCEL" ? null : "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"
  ].filter(Boolean).map(dobrar);
  return linhas.join("\r\n") + "\r\n";
}
