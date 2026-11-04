// Planilha de Registros: montagem da linha (64 colunas) e conversa com o Apps Script (simulado aqui).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLUNAS, linhaRegistro, valorMonetario, idade, proximaMatricula, enviarRegistro, testarPlanilha } from "../backend/src/lib/planilha.js";
import { abrirBanco } from "../backend/src/infra/banco.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const col = nome => COLUNAS.indexOf(nome);
const limpar = [];
after(() => limpar.forEach(f => f()));

test("linha tem as 64 colunas na ordem da aba Registros", () => {
  assert.equal(COLUNAS.length, 64);
  assert.equal(COLUNAS[0], "Matricula");
  assert.equal(COLUNAS[47], "DRIVE");             // coluna 48 (usada pelo main da planilha)
  assert.equal(COLUNAS[48], "Planilha de Horário"); // 49
  assert.equal(COLUNAS[51], "Planilha de Registro"); // 52
  assert.equal(COLUNAS[55], "Foto");               // 56
  assert.equal(COLUNAS[63], "employeeIdChronos");

  const f = {
    matricula: 231, nome: "Maria Silva", email: "maria@x.com", email_innomaker: "maria@innomaker.com.br", telefone: "21999990000",
    situacao: "Estagiário", funcao: "Estagiária", departamento: "Engenharia", setor: "Software", horario_trabalho: "30 horas semanais",
    tipo_contratacao: "Estágio", bolsa_valor: "R$ 1.200,00", auxilio: "Auxílio transporte", responsavel: "João", entidade_vinculada: "UFF",
    principais_funcoes: "Programar", data_efetivacao: "2026-12-01", data_final_contrato: "2027-11-30", admissao_id: "ADM-2026-0001",
    dados: JSON.stringify({ cpf: "12345678901", rg: "123456789", sexo: "Feminino", data_nascimento: "2004-11-10", cep: "24.210-346",
      endereco: "Rua A, 10", bairro: "Icaraí", cidade: "Niterói", estado: "RJ", cr: "8,7", matricula_uff: "121", pix_numero: "maria@x.com", pix_banco: "Nubank" })
  };
  const l = linhaRegistro(f, { hoje: "2026-11-04", linkCompromisso: "https://vagas.innomaker.com.br/documento/D1" });
  assert.equal(l.length, 64);
  assert.equal(l[col("Matricula")], 231);
  assert.equal(l[col("Nome Completo")], "Maria Silva");
  assert.equal(l[col("CPF")], "123.456.789-01");
  assert.equal(l[col("CEP")], "24210346");
  assert.equal(l[col("Idade")], 21);
  assert.equal(l[col("Data Nascimento")], "2004-11-10");
  assert.equal(l[col("Bolsa - Valor")], 1200);
  assert.equal(l[col("CR")], 8.7);
  assert.equal(l[col("Data de Efetivação")], "2026-12-01");
  assert.equal(l[col("Termo de Compromisso")], "https://vagas.innomaker.com.br/documento/D1");
  assert.equal(l[col("DRIVE")], "", "DRIVE é criado pela planilha");
  assert.equal(l[1], "", "coluna vazio");
});

test("valores: dinheiro e idade", () => {
  assert.equal(valorMonetario("R$ 700,00"), 700);
  assert.equal(valorMonetario("1.200"), 1200);
  assert.equal(valorMonetario("1200.50"), 1200.5);
  assert.equal(valorMonetario("Bolsa de R$ 700,00 + auxílio"), "Bolsa de R$ 700,00 + auxílio");
  assert.equal(valorMonetario(""), "");
  assert.equal(idade("2004-11-10", "2026-11-09"), 21);
  assert.equal(idade("2004-11-10", "2026-11-10"), 22);
  assert.equal(idade("", "2026-11-10"), "");
});

// Apps Script falso: responde 302 → GET com o JSON, como o Google faz
function appsScriptFalso(estado) {
  const srv = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/resposta/")) {
      const corpo = estado.respostas.get(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(corpo);
    }
    let txt = "";
    req.on("data", c => { txt += c; });
    req.on("end", () => {
      const d = JSON.parse(txt);
      estado.pedidos.push(d);
      let r;
      if (d.token !== "segredo") r = { ok: false, erro: "Token inválido" };
      else if (d.acao === "ping") r = { ok: true, aba: "Registros", linhas: estado.linhas.length + 1, colunas: 64, proximaMatricula: estado.proxima() };
      else if (d.acao === "proxima_matricula") r = { ok: true, matricula: estado.proxima() };
      else if (d.acao === "registrar") {
        let i = estado.linhas.findIndex(x => x[0] === d.linha[0]);
        const criada = i < 0;
        if (criada) { estado.linhas.push(d.linha.slice()); i = estado.linhas.length - 1; }
        else d.linha.forEach((v, k) => { if (estado.linhas[i][k] === "" && v !== "") estado.linhas[i][k] = v; });
        r = { ok: true, matricula: d.linha[0], linha: i + 2, criada, avisos: [] };
      } else r = { ok: false, erro: "Ação desconhecida" };
      const id = "/resposta/" + estado.pedidos.length;
      estado.respostas.set(id, JSON.stringify(r));
      res.writeHead(302, { location: id });
      res.end();
    });
  });
  return new Promise(ok => srv.listen(0, () => { limpar.push(() => srv.close()); ok(srv.address().port); }));
}

test("conversa com a planilha: próxima matrícula, enviar, reenviar sem apagar e token errado", async () => {
  const estado = { pedidos: [], respostas: new Map(), linhas: [[230, "", "Ativo", "Pessoa Antiga"]] };
  estado.proxima = () => Math.max(...estado.linhas.map(l => l[0])) + 1;
  const porta = await appsScriptFalso(estado);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vagas-planilha-"));
  const db = abrirBanco(dir, path.join(RAIZ, "backend", "migrations"));
  limpar.push(() => { db.fechar(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows */ } });
  const env = { DB: db, SITE_URL: "https://vagas.innomaker.com.br", PLANILHA_REGISTROS_URL: `http://127.0.0.1:${porta}/exec`, PLANILHA_REGISTROS_TOKEN: "segredo" };

  const teste = await testarPlanilha(env);
  assert.equal(teste.ok, true, JSON.stringify(teste));
  assert.equal(teste.proximaMatricula, 231);

  const m = await proximaMatricula(env);
  assert.equal(m, 231, "segue a numeração da planilha");

  const agora = new Date().toISOString();
  await db.prepare("INSERT INTO funcionarios (matricula, nome, email, situacao, dados, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(m, "Maria Silva", "maria@x.com", "Ativo", JSON.stringify({ cpf: "12345678901" }), agora, agora).run();

  const r1 = await enviarRegistro(env, m, "teste");
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.criada, true);
  assert.equal(estado.linhas.length, 2);
  assert.equal(estado.linhas[1][3], "Maria Silva");
  let f = await db.prepare("SELECT planilha_status, planilha_linha FROM funcionarios WHERE matricula = ?").bind(m).first();
  assert.equal(f.planilha_status, "ENVIADO");
  assert.equal(f.planilha_linha, 3);

  // reenvio: completa só o que está vazio
  estado.linhas[1][3] = "Maria Silva (editado na planilha)";
  const r2 = await enviarRegistro(env, m, "teste");
  assert.equal(r2.criada, false);
  assert.equal(estado.linhas.length, 2, "não duplica a linha");
  assert.equal(estado.linhas[1][3], "Maria Silva (editado na planilha)", "não apaga o que já está na planilha");

  // a próxima matrícula nunca fica abaixo da do sistema
  assert.equal(await proximaMatricula(env), 232);

  // token errado: falha registrada no funcionário
  const r3 = await enviarRegistro(Object.assign({}, env, { PLANILHA_REGISTROS_TOKEN: "errado" }), m, "teste");
  assert.equal(r3.ok, false);
  assert.match(r3.erro, /Token inválido/);
  f = await db.prepare("SELECT planilha_status, planilha_erro FROM funcionarios WHERE matricula = ?").bind(m).first();
  assert.equal(f.planilha_status, "FALHOU");

  // sem configuração
  const semConfig = await testarPlanilha({ DB: db });
  assert.equal(semConfig.ok, false);
  assert.match(semConfig.erro, /não configurada/);
});
