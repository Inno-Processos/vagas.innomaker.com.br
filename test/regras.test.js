import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoDasEtapas } from "../backend/src/lib/etapas.js";
import { hashSenha, novoSalt, gerarSenha } from "../backend/src/lib/senha.js";
import { cpfValido } from "../backend/src/api/candidato.js";

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
