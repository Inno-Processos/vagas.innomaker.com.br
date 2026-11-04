// Utilidades HTTP, datas e validações.

export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status || 400;
  }
}

export function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, headers || {})
  });
}

export function redirecionar(url, headers) {
  return new Response(null, { status: 302, headers: Object.assign({ location: url, "cache-control": "no-store" }, headers || {}) });
}

export const HEADERS_HTML = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin"
};

export function lerCookie(header, nome) {
  for (const p of String(header || "").split(/;\s*/)) {
    const i = p.indexOf("=");
    if (i > 0 && p.slice(0, i).trim() === nome) return p.slice(i + 1).trim();
  }
  return "";
}

export function cookie(nome, valor, maxAgeSeg) {
  return `${nome}=${valor}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeg}`;
}

// POST só do próprio site (evita uso da sessão por outras páginas)
export function mesmaOrigem(request, url) {
  const origem = request.headers.get("origin");
  if (origem) return origem === url.origin;
  const sfs = request.headers.get("sec-fetch-site");
  return !sfs || sfs === "same-origin" || sfs === "none";
}

export async function lerJson(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

export const agora = () => new Date().toISOString();

// Data de hoje em Brasília, "AAAA-MM-DD"
export function hojeISO(deslocDias) {
  const d = new Date(Date.now() + (deslocDias || 0) * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

export function somarAnos(iso, anos) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return String(+m[1] + anos) + "-" + m[2] + "-" + m[3];
}

export function dataBR(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
}

export function dataHoraBR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d);
}

export const ehDataISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

export function emailValido(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

export function texto(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max || 5000);
}

export function normalizar(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export const soDigitos = s => String(s || "").replace(/\D/g, "");

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function parseJson(s, padrao) {
  try { const v = JSON.parse(s); return v == null ? padrao : v; } catch (e) { return padrao; }
}
