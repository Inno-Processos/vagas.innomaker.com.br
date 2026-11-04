import { test } from "node:test";
import assert from "node:assert/strict";
import { papelDosGrupos, podeExecutar, acoesDoPapel } from "../src/lib/papeis.js";

const mapa = { rh: ["rh"], gerente: ["gerente", "gestor"], funcionario: ["funcionario"] };

test("RH tem prioridade sobre os outros grupos", () => {
  assert.equal(papelDosGrupos(["funcionario", "gerente", "RH"], mapa), "rh");
});

test("gerente, funcionário e sem grupo (403)", () => {
  assert.equal(papelDosGrupos(["gestor"], mapa), "gerente");
  assert.equal(papelDosGrupos(["funcionario"], mapa), "funcionario");
  assert.equal(papelDosGrupos(["financeiro"], mapa), null);
});

test("permissões por papel", () => {
  assert.equal(podeExecutar("funcionario", "vagas_abertas"), true);
  assert.equal(podeExecutar("funcionario", "solic_criar"), false);
  assert.equal(podeExecutar("gerente", "solic_criar"), true);
  assert.equal(podeExecutar("gerente", "vaga_detalhe"), true);
  assert.equal(podeExecutar("gerente", "solic_listar"), false);
  assert.equal(podeExecutar("gerente", "adm_decidir"), false);
  assert.equal(podeExecutar("gerente", "cfg_obter"), false);
  assert.equal(podeExecutar("rh", "adm_decidir"), true);
  assert.equal(podeExecutar(null, "me"), false);
  assert.ok(acoesDoPapel("rh").length > acoesDoPapel("gerente").length);
});
