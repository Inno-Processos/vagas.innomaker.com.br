// Acesso ao banco (env.DB: SQLite em data/vagas.db, ver infra/banco.js).
import { agora, parseJson } from "./http.js";

export const um = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).first();
export const todos = async (env, sql, ...p) => (await env.DB.prepare(sql).bind(...p).all()).results || [];
export const executar = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).run();
export const prep = (env, sql, ...p) => env.DB.prepare(sql).bind(...p);

// Contador atômico (IDs legíveis como SOL-2026-000001)
export async function proximoNumero(env, nome) {
  const r = await env.DB.prepare(
    "INSERT INTO sequencias (nome, valor) VALUES (?, 1) ON CONFLICT (nome) DO UPDATE SET valor = valor + 1 RETURNING valor"
  ).bind(nome).first();
  return r.valor;
}

export async function novoId(env, prefixo, digitos) {
  const ano = new Date().getFullYear();
  const n = await proximoNumero(env, prefixo + "_" + ano);
  return `${prefixo}-${ano}-${String(n).padStart(digitos, "0")}`;
}

export function quemE(usuario) {
  if (!usuario) return "sistema";
  return (usuario.nome || usuario.login || "") + (usuario.email ? " <" + usuario.email + ">" : "");
}

export async function registrarLog(env, quem, acao, entidade, entidadeId, detalhe) {
  try {
    await executar(env, "INSERT INTO log (quando, quem, acao, entidade, entidade_id, detalhe) VALUES (?, ?, ?, ?, ?, ?)",
      agora(), String(quem || ""), acao, entidade || "", String(entidadeId || ""), typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe || ""));
  } catch (e) { console.log("log falhou", e); }
}

export async function lerConfig(env) {
  const linhas = await todos(env, "SELECT chave, valor FROM config");
  const c = {};
  linhas.forEach(l => { c[l.chave] = l.valor; });
  c.links_colaborador = parseJson(c.links_colaborador, []);
  return c;
}

export function historicoMais(historicoJson, quem, acao, textoLivre) {
  const h = parseJson(historicoJson, []);
  h.push({ quando: agora(), quem: String(quem || ""), acao, texto: textoLivre || "" });
  return JSON.stringify(h);
}
