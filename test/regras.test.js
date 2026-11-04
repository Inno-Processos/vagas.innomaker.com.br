import { test } from "node:test";
import assert from "node:assert/strict";
import { preencherModelo, validarModelo, textoParaHtml, valoresDoFuncionario, camposUsados } from "../backend/src/lib/documentos.js";
import { estadoDasEtapas } from "../backend/src/lib/etapas.js";
import { hashSenha, novoSalt, gerarSenha } from "../backend/src/lib/senha.js";
import { cpfValido } from "../backend/src/api/candidato.js";

test("modelo: campo vazio cancela com mensagem do processo (item 5.2)", () => {
  const m = { nome: "Termo de Compromisso", conteudo: "Eu, {{NOME}}, CPF {{CPF}}." };
  assert.throws(() => preencherModelo(m, { NOME: "Ana", CPF: "" }, 15), /Matrícula 15: CPF está vazio\. Documento: Termo de Compromisso\. Operação cancelada\./);
  assert.equal(preencherModelo(m, { NOME: "Ana", CPF: "123" }, 15), "Eu, Ana, CPF 123.");
});

test("modelo: campo desconhecido é rejeitado", () => {
  assert.throws(() => validarModelo("{{NOME}} {{INVENTADO}}"), /INVENTADO/);
  assert.deepEqual(camposUsados("{{NOME}} {{ NOME }} {{CPF}}"), ["NOME", "CPF"]);
});

test("texto do documento vira HTML escapado", () => {
  const h = textoParaHtml("# Título\n\nLinha <b>1</b>\nLinha 2");
  assert.equal(h, "<h2>Título</h2>\n<p>Linha &lt;b&gt;1&lt;/b&gt;<br>Linha 2</p>");
});

test("valores do funcionário: data final = início + 1 ano", () => {
  const v = valoresDoFuncionario({ nome: "Ana", matricula: 7, data_efetivacao: "2026-12-01", dados: '{"cidade":"Niterói","estado":"RJ"}' }, "2026-11-04");
  assert.equal(v.DATA_INICIO, "01/12/2026");
  assert.equal(v.DATA_FIM, "01/12/2027");
  assert.equal(v.CIDADE_ESTADO, "Niterói - RJ");
  assert.equal(v.MATRICULA, "7");
});

test("etapas: atual, encerrado e concluído", () => {
  assert.equal(estadoDasEtapas([{ ordem: 1, nome: "Triagem", resultado: "Aprovado" }, { ordem: 2, nome: "Entrevista", resultado: "Pendente" }]).etapaAtual, "Entrevista");
  assert.equal(estadoDasEtapas([{ ordem: 1, nome: "Triagem", resultado: "Reprovado" }]).status, "Processo encerrado");
  assert.equal(estadoDasEtapas([{ ordem: 1, nome: "Triagem", resultado: "Aprovado" }]).status, "Processo concluído");
});

test("senha: gerada, hash determinístico por salt", async () => {
  const s = gerarSenha();
  assert.match(s, /^[a-hj-km-np-z2-9]{8}$/);
  const salt = novoSalt();
  assert.equal(await hashSenha(s, salt), await hashSenha(s, salt));
  assert.notEqual(await hashSenha(s, salt), await hashSenha(s + "x", salt));
});

test("CPF", () => {
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("111.111.111-11"), false);
  assert.equal(cpfValido("529.982.247-24"), false);
});
