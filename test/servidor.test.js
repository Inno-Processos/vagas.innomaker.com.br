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
import { GRUPOS_PREPARACAO } from "../backend/src/lib/preparacaoVaga.js";

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

    // endereços bonitos do site: todos abrem a página do site
    for (const c of ["/vagas", "/vagas/estagio-em-software-vag-2026-0002", "/area-do-candidato"]) {
      const r = await fetch(base + c, { redirect: "manual" });
      assert.equal(r.status, 200, c);
      assert.match(await r.text(), /<title>Vagas\.Innomaker<\/title>/, c);
    }
    assert.equal((await fetch(base + "/vagas/a/b", { redirect: "manual" })).status, 302, "endereço desconhecido volta ao site");

    const inicio = await (await fetch(base + "/api/site/inicio")).json();
    assert.equal(inicio.ok, true);
    assert.ok(Array.isArray(inicio.vagas));

    const vagas = await (await fetch(base + "/api/vagas")).json();
    assert.equal(vagas.ok, true);

    const sessao = await (await fetch(base + "/api/painel/sessao")).json();
    assert.equal(sessao.ok, true, JSON.stringify(sessao));
    assert.equal(sessao.usuario.papel, "rh");
    assert.ok(sessao.acoes.includes("solic_decidir"), "RH pode aprovar");

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

    // Solicitação: depois de enviada, só muda se o RH recusar com alteração
    const staff = async (acao, corpo) => (await fetch(base + "/api/staff/" + acao, {
      method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(corpo || {})
    })).json();
    const pedido = { departamento: "Engenharia", titulo: "Estágio em Software", quantidade: 1, data_limite: "2027-12-20", localidade: "Niterói/RJ",
      tipo_vaga: "Híbrido", tipo_contratacao: "Estágio", carga_horaria: "30 horas semanais", remuneracao: "Bolsa de R$ 1.200,00",
      descricao: "Descrição", habilidades_obrigatorias: "Python", principais_funcoes: "Programar", motivo: "Demanda", urgencia: "Alta",
      gestor_responsavel: "Pessoa Teste", concordancia: true };
    const criada = await staff("solic_criar", pedido);
    assert.equal(criada.ok, true, JSON.stringify(criada));
    const editarEnviada = await staff("solic_editar", Object.assign({ id: criada.id }, pedido, { titulo: "Mudado" }));
    assert.equal(editarEnviada.ok, false, "enviada não pode ser alterada");
    assert.match(editarEnviada.erro, /não pode ser alterada/);
    const comAlteracao = await staff("solic_decidir", { id: criada.id, decisao: "reajuste", comentario: "Ajustar a bolsa" });
    assert.equal(comAlteracao.ok, true, JSON.stringify(comAlteracao));
    const decidirComGestor = await staff("solic_decidir", { id: criada.id, decisao: "aprovar" });
    assert.equal(decidirComGestor.ok, false, "com o gestor para correção: RH não decide");
    const corrigida = await staff("solic_editar", Object.assign({ id: criada.id }, pedido, { remuneracao: "Bolsa de R$ 1.500,00" }));
    assert.equal(corrigida.ok, true, JSON.stringify(corrigida));
    const lista = await staff("solic_listar");
    const s1 = lista.itens.find(i => i.id === criada.id);
    assert.equal(s1.status, "PENDENTE");
    assert.equal(s1.remuneracao, "Bolsa de R$ 1.500,00");
    assert.equal((await staff("solic_editar", Object.assign({ id: criada.id }, pedido))).ok, false, "reenviada volta a ficar travada");
    assert.equal((await staff("solic_decidir", { id: criada.id, decisao: "aprovar" })).ok, true);

    // Avaliação das etapas: ordem, estrelas, análise e feedback por e-mail na recusa
    const vg = await staff("vaga_salvar", { titulo: "Estágio Teste", data_limite: "2027-12-31", localidade: "Niterói", tipo_contratacao: "Estágio",
      carga_horaria: "30h", descricao: "x", requisitos: "x", principais_funcoes: "x", status: "Aberta", etapas: ["Triagem", "Entrevista RH"],
      preparacao: Object.fromEntries(GRUPOS_PREPARACAO.map(g => [g.id, { itens: Object.fromEntries(g.itens.map(i => [i.id, true])) }])) });
    assert.equal(vg.ok, true, JSON.stringify(vg));
    const fd = new FormData();
    Object.entries({ vaga_id: vg.id, nome: "Ana Candidata", email: "ana@example.com", telefone: "21999999999", periodo_curso: "5º", previsao_formatura: "2027-12", aceite_privacidade: "1" })
      .forEach(([k, x]) => fd.set(k, x));
    fd.set("curriculo", new File(["%PDF-1.4 teste"], "cv.pdf", { type: "application/pdf" }));
    const insc = await (await fetch(base + "/api/candidato/inscrever", { method: "POST", headers: { origin: base }, body: fd })).json();
    assert.equal(insc.ok, true, JSON.stringify(insc));
    const det = await staff("vaga_detalhe", { id: vg.id });
    const ets = det.candidatos[0].etapas.sort((a, b) => a.ordem - b.ordem);
    assert.ok(ets.length >= 2);
    const avaliar = (e, extra) => staff("etapa_atualizar", Object.assign({ etapa_id: e.id }, extra));

    const foraDeOrdem = await avaliar(ets[1], { resultado: "Aprovado", nota: 3, analise: "Muito bem" });
    assert.equal(foraDeOrdem.ok, false);
    assert.match(foraDeOrdem.erro, /Avalie antes/);
    assert.equal((await avaliar(ets[0], { resultado: "Aprovado", analise: "Currículo bom" })).ok, false, "sem estrelas");
    assert.equal((await avaliar(ets[0], { resultado: "Reprovado", nota: 1, analise: "" })).ok, false, "recusa sem feedback");
    const ok1 = await avaliar(ets[0], { resultado: "Aprovado", nota: 3, analise: "Currículo alinhado à vaga", data_prevista: "2027-01-10" });
    assert.equal(ok1.ok, true, JSON.stringify(ok1));
    assert.equal(ok1.emailEnviado, false, "aprovação sem aviso não manda e-mail");
    const recusa = await avaliar(ets[1], { resultado: "Reprovado", nota: 1, analise: "Faltou domínio de Python para a vaga." });
    assert.equal(recusa.ok, true, JSON.stringify(recusa));
    assert.equal(recusa.status, "Encerrado");
    assert.equal(recusa.emailEnviado, true, "recusa manda o feedback");
    const det2 = await staff("vaga_detalhe", { id: vg.id });
    const e2 = det2.candidatos[0].etapas.sort((a, b) => a.ordem - b.ordem);
    assert.equal(e2[0].nota, 3);
    assert.equal(e2[0].data_prevista, "", "Triagem não tem data prevista");
    assert.equal(e2[1].resultado, "Reprovado");
    assert.equal(det2.candidatos[0].status, "Encerrado");
    // editar a recusa não reenvia o e-mail
    const reedit = await avaliar(ets[1], { resultado: "Reprovado", nota: 1, analise: "Faltou domínio de Python e Git." });
    assert.equal(reedit.emailEnviado, false);
    const logs = await staff("log_listar");
    assert.equal(logs.emails.filter(m => /Retorno do processo seletivo/.test(m.assunto) && m.para === "ana@example.com").length, 1);

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
