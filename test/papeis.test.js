import { test } from "node:test";
import assert from "node:assert/strict";
import { papelDosGrupos, podeExecutar, acoesDoPapel } from "../src/lib/papeis.js";

const mapa = { rh: ["rh"], gerente: ["gerente", "gestor"], funcionario: ["funcionario"] };

test("RH tem prioridade sobre os outros grupos", () => {
  assert.equal(papelDosGrupos(["funcionario", "gerente", "RH"], mapa), "rh");
});

test("gerente e funcionário", () => {
  assert.equal(papelDosGrupos(["gestor"], mapa), "gerente");
  assert.equal(papelDosGrupos(["funcionario"], mapa), "funcionario");
});

test("sem grupo conhecido → sem papel (403)", () => {
  assert.equal(papelDosGrupos([], mapa), null);
  assert.equal(papelDosGrupos(["financeiro"], mapa), null);
});

test("permissões por papel", () => {
  assert.equal(podeExecutar("funcionario", "vagas_abertas"), true);
  assert.equal(podeExecutar("funcionario", "solic_criar"), false);
  assert.equal(podeExecutar("gerente", "solic_criar"), true);
  assert.equal(podeExecutar("gerente", "solic_listar"), false);
  assert.equal(podeExecutar("gerente", "adm_aprovar"), false);
  assert.equal(podeExecutar("rh", "adm_aprovar"), true);
  assert.equal(podeExecutar("rh", "acao_inexistente"), false);
  assert.equal(podeExecutar(null, "me"), false);
  assert.ok(acoesDoPapel("rh").length > acoesDoPapel("gerente").length);
});
