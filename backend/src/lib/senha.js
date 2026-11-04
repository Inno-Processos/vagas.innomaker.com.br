// Senhas (PBKDF2) e sessão dos candidatos (cookie assinado).
import { lerCookie, cookie } from "./http.js";
import { um } from "./db.js";

const ITERACOES = 100000;
export const COOKIE_CANDIDATO = "cand_sessao";
const SESSAO_DIAS = 7;
const enc = new TextEncoder();

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const deHex = s => new Uint8Array((s.match(/.{2}/g) || []).map(h => parseInt(h, 16)));

export function novoSalt() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashSenha(senha, salt) {
  const chave = await crypto.subtle.importKey("raw", enc.encode(String(senha)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: deHex(salt), iterations: ITERACOES }, chave, 256);
  return hex(bits);
}

// 8 caracteres sem l, i, o, 0, 1 (evita confusão ao digitar)
export function gerarSenha() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  while (s.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && s.length < 8) s += chars[b % chars.length];
    }
  }
  return s;
}

export async function sha256Hex(textoLivre) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(textoLivre)));
}

async function hmac(segredo, dados) {
  const k = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(dados));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

function segredo(env) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET não configurado no backend/.env.");
  return env.SESSION_SECRET;
}

export async function cookieSessao(env, candidato) {
  const payload = b64url(JSON.stringify({ c: candidato.id, v: candidato.versao_sessao || 1, x: Date.now() + SESSAO_DIAS * 86400000 }));
  const valor = payload + "." + await hmac(segredo(env), payload);
  return cookie(COOKIE_CANDIDATO, valor, SESSAO_DIAS * 86400);
}

export const cookieSair = () => cookie(COOKIE_CANDIDATO, "", 0);

// Candidato logado (linha da tabela) ou null
export async function candidatoDaSessao(env, request) {
  const valor = lerCookie(request.headers.get("cookie"), COOKIE_CANDIDATO);
  const partes = valor.split(".");
  if (partes.length !== 2) return null;
  if (await hmac(segredo(env), partes[0]) !== partes[1]) return null;
  let o;
  try { o = JSON.parse(deB64url(partes[0])); } catch (e) { return null; }
  if (!o || !o.c || Date.now() > Number(o.x)) return null;
  const c = await um(env, "SELECT * FROM candidatos WHERE id = ?", o.c);
  if (!c || Number(c.versao_sessao) !== Number(o.v)) return null;
  return c;
}
