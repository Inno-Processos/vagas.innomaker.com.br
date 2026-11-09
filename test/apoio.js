// Ambiente dos testes de fluxo: rotas chamadas direto, banco SQLite temporário e e-mail falso.
import { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirBanco } from "../backend/src/infra/banco.js";
import { criarArmazenamento } from "../backend/src/infra/arquivos.js";
import { rotear } from "../backend/src/rotas.js";
import { GRUPOS_PREPARACAO } from "../backend/src/lib/preparacaoVaga.js";

export const preparacaoCompleta = () => Object.fromEntries(GRUPOS_PREPARACAO.map(g => [g.id, { itens: Object.fromEntries(g.itens.map(i => [i.id, true])) }]));

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporarios = [];
export const pastaTemp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "vagas-fluxo-")); temporarios.push(d); return d; };
export const bancos = [];
after(() => {
  bancos.forEach(b => b.fechar());
  temporarios.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* Windows */ } });
});

// ---------- Ambiente de teste ----------
export function ambiente() {
  const dir = pastaTemp();
  const DB = abrirBanco(dir, path.join(RAIZ, "backend", "migrations"));
  bancos.push(DB);
  const enviados = [];
  const env = {
    DB, ARQUIVOS: criarArmazenamento(path.join(dir, "arquivos")),
    CORREIO: { enviar: async m => { enviados.push(m); } },
    SMTP_USER: "rh@teste", SMTP_PASS: "x", SITE_URL: "http://localhost",
    SESSION_SECRET: "teste-" + "y".repeat(40),
    DEV_USUARIO_FALSO: JSON.stringify({ login: "rh", nome: "Pessoa RH", email: "rh@innomaker.com.br", grupos: ["rh"] })
  };
  const pendentes = [];
  const ctx = { waitUntil: p => pendentes.push(p) };
  const esperar = async () => { while (pendentes.length) await pendentes.shift(); };

  async function chamar(caminho, opts) {
    opts = opts || {};
    const headers = Object.assign({ origin: "http://localhost" }, opts.headers || {});
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers["content-type"] = "application/json"; body = JSON.stringify(body); }
    const r = await rotear(new Request("http://localhost" + caminho, { method: opts.method || "POST", headers, body }), env, ctx);
    await esperar();
    return { status: r.status, json: await r.json(), cookie: r.headers.get("set-cookie") || "" };
  }
  const staff = async (acao, corpo, grupos) => (await chamar("/api/staff/" + acao, { body: corpo || {}, headers: grupos ? { "x-dev-grupos": grupos } : {} })).json;

  async function inscrever(vagaId, dados) {
    const fd = new FormData();
    Object.entries(Object.assign({ vaga_id: vagaId, telefone: "21999999999", periodo_curso: "5º", previsao_formatura: "2027-12", aceite_privacidade: "1" }, dados))
      .forEach(([k, v]) => fd.set(k, v));
    fd.set("curriculo", new File(["%PDF-1.4 teste"], "cv.pdf", { type: "application/pdf" }));
    return (await chamar("/api/candidato/inscrever", { body: fd })).json;
  }

  // Entra na Área do candidato com a senha que foi "enviada" por e-mail
  async function entrar(email) {
    const m = enviados.filter(x => [].concat(x.para).includes(email) && /Senha:/.test(x.texto || "")).pop();
    const senha = /Senha: (\S+)/.exec(m.texto)[1];
    const r = await chamar("/api/candidato/login", { body: { email, senha } });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    return { cookie: r.cookie.split(";")[0], senha };
  }
  const comoCandidato = (sessao, acao, corpo) => chamar("/api/candidato/" + acao, { body: corpo || {}, headers: { cookie: sessao.cookie } });

  return { env, ctx, dir, enviados, chamar, staff, inscrever, entrar, comoCandidato };
}

export async function criarVaga(staff, titulo, etapas) {
  const v = await staff("vaga_salvar", { titulo, data_limite: "2099-12-31", localidade: "Niterói", tipo_contratacao: "Estágio",
    carga_horaria: "30h", descricao: "x", requisitos: "x", principais_funcoes: "x", status: "Aberta", preparacao: preparacaoCompleta(), etapas: etapas || ["Triagem", "Entrevista RH"] });
  assert.equal(v.ok, true, JSON.stringify(v));
  return v.id;
}

