// Servidor self-hosted: banco (SQLite com interface do D1), arquivos (pasta com interface do R2) e o site rodando.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { abrirBanco } from "../backend/src/infra/banco.js";
import { criarArmazenamento } from "../backend/src/infra/arquivos.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRACOES = path.join(RAIZ, "backend", "migrations");
const temporarios = [];
const pastaTemp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "vagas-teste-")); temporarios.push(d); return d; };
const bancos = [];
after(() => {
  bancos.forEach(b => b.fechar());
  temporarios.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* Windows */ } });
});

test("banco: migrações, first/all/run, RETURNING, batch atômico", async () => {
  const dir = pastaTemp();
  const db = abrirBanco(dir, MIGRACOES);
  bancos.push(db);
  const aplicadas = await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all();
  assert.deepEqual(aplicadas.results.map(r => r.name), fs.readdirSync(MIGRACOES).filter(f => f.endsWith(".sql")).sort());

  const r1 = await db.prepare("INSERT INTO sequencias (nome, valor) VALUES (?, 1) ON CONFLICT (nome) DO UPDATE SET valor = valor + 1 RETURNING valor").bind("t").first();
  const r2 = await db.prepare("INSERT INTO sequencias (nome, valor) VALUES (?, 1) ON CONFLICT (nome) DO UPDATE SET valor = valor + 1 RETURNING valor").bind("t").first();
  assert.equal(r1.valor, 1);
  assert.equal(r2.valor, 2);
  assert.equal(await db.prepare("SELECT valor FROM sequencias WHERE nome = ?").bind("t").first("valor"), 2);
  assert.equal(await db.prepare("SELECT * FROM sequencias WHERE nome = ?").bind("nada").first(), null);

  const ins = await db.prepare("INSERT INTO log (quando, quem, acao, entidade, entidade_id, detalhe) VALUES (?, ?, ?, ?, ?, ?)")
    .bind("2026-01-01", "x", "A", "", "", "").run();
  assert.equal(ins.meta.changes, 1);
  assert.ok(ins.meta.last_row_id > 0);
  const upd = await db.prepare("UPDATE sequencias SET valor = 9 WHERE nome = ?").bind("nada").run();
  assert.equal(upd.meta.changes, 0);

  // batch: se um comando falha, nenhum vale
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO sequencias (nome, valor) VALUES (?, ?)").bind("b1", 1),
    db.prepare("INSERT INTO tabela_que_nao_existe VALUES (1)")
  ]));
  assert.equal(await db.prepare("SELECT * FROM sequencias WHERE nome = 'b1'").first(), null);
  const ok = await db.batch([db.prepare("INSERT INTO sequencias (nome, valor) VALUES (?, ?)").bind("b2", 5)]);
  assert.equal(ok[0].meta.changes, 1);

  assert.ok(fs.existsSync(db.backup(true)));
});

test("arquivos: grava, lê, apaga e bloqueia caminhos fora da pasta", async () => {
  const a = criarArmazenamento(pastaTemp());
  await a.put("curriculos/abc-cv.pdf", new TextEncoder().encode("%PDF-teste").buffer, { httpMetadata: { contentType: "application/pdf" } });
  const obj = await a.get("curriculos/abc-cv.pdf");
  assert.equal(await new Response(obj.body).text(), "%PDF-teste");
  await a.delete("curriculos/abc-cv.pdf");
  assert.equal(await a.get("curriculos/abc-cv.pdf"), null);
  await assert.rejects(a.put("../fora.txt", "x"));
});

// Sobe um processo e espera ele dizer em que porta está ("localhost:NNNN")
function subir(pasta, args, env) {
  const filho = spawn(process.execPath, args, { cwd: path.join(RAIZ, pasta), env: Object.assign({}, process.env, env) });
  let saida = "";
  const porta = new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error(pasta + " não subiu:\n" + saida)), 20000);
    filho.stdout.on("data", d => { saida += d; const m = /localhost:(\d+)/.exec(saida); if (m) { clearTimeout(t); ok(Number(m[1])); } });
    filho.stderr.on("data", d => { saida += d; });
    filho.on("exit", c => { clearTimeout(t); falha(new Error(pasta + " saiu (" + c + "):\n" + saida)); });
  });
  return { filho, porta };
}

test("backend e frontend separados: telas, repasse da API, arquivos estáticos e saúde", { timeout: 40000 }, async () => {
  const dir = pastaTemp();
  const back = subir("backend", ["--disable-warning=ExperimentalWarning", "src/index.js"], {
    API_PORT: "0", DATA_DIR: dir, SESSION_SECRET: "teste-" + "x".repeat(40), SMTP_USER: "", SMTP_PASS: "",
    DEV_USUARIO_FALSO: JSON.stringify({ login: "teste", nome: "Pessoa Teste", email: "teste@innomaker.com.br", grupos: ["RH"] })
  });
  const portaApi = await back.porta;
  const front = subir("frontend", ["server.js"], { WEB_PORT: "0", API_URL: `http://127.0.0.1:${portaApi}` });
  const porta = await front.porta;
  const base = `http://localhost:${porta}`;
  try {
    // o backend não entrega telas: só API
    const telaNoBackend = await fetch(`http://127.0.0.1:${portaApi}/`);
    assert.equal(telaNoBackend.status, 404);
    assert.match(telaNoBackend.headers.get("content-type"), /json/);
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${portaApi}/saude`)).json(), { ok: true });

    assert.deepEqual(await (await fetch(base + "/saude")).json(), { ok: true });

    const site = await fetch(base + "/");
    assert.equal(site.status, 200);
    const htmlSite = await site.text();
    assert.match(htmlSite, /<title>Vagas\.Innomaker<\/title>/);
    assert.ok(!/__VERSAO__|__BOOT__/.test(htmlSite), "marcadores trocados");

    const inicio = await (await fetch(base + "/api/site/inicio")).json();
    assert.equal(inicio.ok, true);
    assert.ok(Array.isArray(inicio.vagas));

    const vagas = await (await fetch(base + "/api/vagas")).json();
    assert.equal(vagas.ok, true);

    const sessao = await (await fetch(base + "/api/painel/sessao")).json();
    assert.equal(sessao.ok, true, JSON.stringify(sessao));
    assert.equal(sessao.usuario.papel, "rh");
    assert.ok(sessao.acoes.includes("solic_decidir"), "RH pode aprovar");

    const doc = await fetch(base + "/documento/nao-existe");
    assert.equal(doc.status, 200);
    assert.match(doc.headers.get("x-frame-options") || "", /DENY/);
    assert.equal((await fetch(base + "/api/documento/nao-existe")).status, 404);

    const arq = await fetch(base + "/arquivo/nao-existe", { redirect: "manual" });
    assert.equal(arq.status, 302);
    assert.equal(arq.headers.get("location"), "/erro?c=404");

    const css = await fetch(base + "/assets/site.css");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /text\/css/);
    const fuga = await fetch(base + "/assets/%2e%2e/package.json", { redirect: "manual" });
    assert.ok(!/json/.test(fuga.headers.get("content-type") || ""), "não pode servir arquivos fora de public/");

    const painel = await fetch(base + "/painel");
    assert.equal(painel.status, 200);
    assert.match(await painel.text(), /<title>Painel — Vagas\.Innomaker<\/title>/);

    const log = await fetch(base + "/api/staff/log_listar", {
      method: "POST", headers: { "content-type": "application/json", origin: base }, body: "{}"
    });
    const corpo = await log.json();
    assert.equal(log.status, 200, JSON.stringify(corpo));
    assert.equal(corpo.ok, true);
    assert.ok(Array.isArray(corpo.emails));

    const outraOrigem = await fetch(base + "/api/staff/log_listar", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://malicioso.example" }, body: "{}"
    });
    assert.equal(outraOrigem.status, 403);

    // backend fora do ar: o frontend responde 503 "reiniciando" (as telas tentam de novo sozinhas)
    back.filho.kill();
    await new Promise(r => back.filho.once("exit", r));
    const fora = await fetch(base + "/api/vagas");
    assert.equal(fora.status, 503);
    assert.equal((await fora.json()).reiniciando, true);
  } finally {
    back.filho.kill();
    front.filho.kill();
  }
});
