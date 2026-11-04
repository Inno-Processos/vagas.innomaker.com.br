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

test("grupos do LLDAP com maiúsculas (RH, Gerente, funcionarios) viram os papéis certos", () => {
  const mapa = { rh: ["rh", "vagas_rh"], gerente: ["gerente", "vagas_gerente"], funcionario: ["funcionarios", "vagas_funcionario"] };
  assert.equal(papelDosGrupos(["RH"], mapa), "rh");
  assert.equal(papelDosGrupos(["Gerente"], mapa), "gerente");
  assert.equal(papelDosGrupos(["funcionarios", "sac_admin"], mapa), "funcionario");
  assert.equal(papelDosGrupos(["Gerente", "RH"], mapa), "rh");
  assert.ok(podeExecutar("rh", "solic_decidir"), "RH aprova solicitações");
  assert.ok(!podeExecutar("gerente", "solic_decidir"), "gerente não aprova");
});
