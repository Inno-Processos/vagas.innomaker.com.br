import { test } from "node:test";
import assert from "node:assert/strict";
import { ambiente, preparacaoCompleta } from "./apoio.js";
import { rotear } from "../backend/src/rotas.js";

const VAGA = { titulo: "Vaga em preparação", data_limite: "2099-12-31", localidade: "Niterói", tipo_contratacao: "Estágio",
  carga_horaria: "30h", descricao: "Descrição", requisitos: "Requisitos", principais_funcoes: "Atividades", etapas: ["Triagem", "Entrevista RH"], gestor_email: "rh@innomaker.com.br" };

test("preparação: rascunho fica fora do site; abertura e reabertura exigem checklist completo", async () => {
  const t = ambiente();
  const aberta = await t.staff("vaga_salvar", { ...VAGA, status: "Aberta" });
  assert.equal(aberta.ok, false);
  assert.match(aberta.erro, /checklist.*Acompanhante.*Materiais.*marketing/);
  const r = await t.staff("vaga_salvar", VAGA);
  assert.equal(r.ok, true, JSON.stringify(r));
  const listar = async () => (await t.chamar("/api/vagas", { method: "GET" })).json;
  assert.deepEqual((await listar()).vagas, []);
  assert.equal(t.enviados.some(m => /Vaga publicada/.test(m.assunto)), false);
  assert.equal((await t.inscrever(r.id, { nome: "Candidato", email: "candidato@x.com" })).ok, false);
  let v = (await t.staff("vaga_detalhe", { id: r.id })).vaga;
  assert.equal(v.status, "Rascunho");
  assert.ok(v.preparacao_pendencias.length);

  const prep = preparacaoCompleta();
  prep.testes = { nao_aplica: true };
  const semMotivo = await t.staff("vaga_salvar", { ...VAGA, id: r.id, status: "Aberta", preparacao: prep });
  assert.equal(semMotivo.ok, false);
  assert.match(semMotivo.erro, /justifique/);
  prep.testes.justificativa = "Esta vaga utiliza somente entrevistas e análise de portfólio.";
  prep.entrevista.observacoes = "Acompanhante: Ana. Treinamento realizado antes da entrevista.";
  prep.entrevista.conferido_por = "Pessoa forjada";
  assert.equal((await t.staff("vaga_salvar", { ...VAGA, id: r.id, status: "Aberta", preparacao: prep })).ok, true);
  v = (await t.staff("vaga_detalhe", { id: r.id })).vaga;
  assert.deepEqual(v.preparacao_pendencias, []);
  assert.match(v.preparacao.entrevista.conferido_por, /Pessoa RH/);
  assert.ok(v.preparacao.entrevista.conferido_em);
  assert.ok(t.enviados.some(m => /Vaga publicada/.test(m.assunto)));
  const site = await listar();
  assert.ok(JSON.stringify(site).includes(r.id));
  assert.equal(JSON.stringify(site).includes("Acompanhante: Ana"), false, "preparação é interna");

  // O checklist continua obrigatório quando uma vaga pausada volta a ser aberta.
  prep.entrevista.itens.treinamento = false;
  assert.equal((await t.staff("vaga_salvar", { ...VAGA, id: r.id, status: "Pausada", preparacao: prep })).ok, true);
  assert.equal((await t.staff("vaga_salvar", { ...VAGA, id: r.id, status: "Aberta" })).ok, false);
  assert.equal((await t.staff("vaga_detalhe", { id: r.id })).vaga.status, "Pausada");
});

test("preparação: documentos separados por grupo/vaga, acesso restrito e exclusão", async () => {
  const t = ambiente();
  const a = await t.staff("vaga_salvar", VAGA);
  const b = await t.staff("vaga_salvar", { ...VAGA, titulo: "Outra vaga" });
  const upload = (vaga, grupo, nome = "roteiro.pdf", tipo = "application/pdf", grupos) => {
    const fd = new FormData(); fd.set("vaga_id", vaga); fd.set("grupo", grupo);
    fd.append("arquivo", new File(["conteúdo"], nome, { type: tipo }));
    return t.chamar("/api/staff/vaga_preparacao_anexar", { body: fd, headers: grupos ? { "x-dev-grupos": grupos } : {} });
  };
  assert.equal((await upload("inexistente", "entrevista")).json.ok, false);
  assert.equal((await upload(a.id, "invalido")).json.ok, false);
  assert.equal((await upload(a.id, "entrevista", "script.html", "text/html")).json.ok, false);
  assert.equal((await upload(a.id, "entrevista", "roteiro.pdf", "application/pdf", "gerente")).status, 403);
  const anexo = (await upload(a.id, "entrevista")).json;
  assert.equal(anexo.ok, true, JSON.stringify(anexo));
  const id = anexo.arquivos[0].id;
  assert.equal((await upload(a.id, "testes", "teste.docx", "application/octet-stream")).json.ok, true);
  assert.equal((await upload(a.id, "divulgacao", "briefing.pdf")).json.ok, true);
  const v = (await t.staff("vaga_detalhe", { id: a.id })).vaga;
  assert.deepEqual(v.preparacao_anexos.map(a => a.preparacao_grupo).sort(), ["divulgacao", "entrevista", "testes"]);
  assert.deepEqual((await t.staff("vaga_detalhe", { id: b.id })).vaga.preparacao_anexos, []);
  // Anexar não marca o checklist como concluído.
  assert.ok(v.preparacao_pendencias.length);
  const abrir = headers => rotear(new Request("http://localhost/arquivo/" + id, { headers }), t.env, t.ctx);
  assert.equal((await abrir({})).status, 200, "RH abre o documento");
  assert.equal((await abrir({ "x-dev-grupos": "funcionario" })).status, 302);
  // O gerente com e-mail rh@innomaker.com.br é gestor desta vaga.
  assert.equal((await abrir({ "x-dev-grupos": "gerente" })).status, 200);
  await t.env.DB.prepare("UPDATE vagas SET gestor_email = 'outro@x.com' WHERE id = ?").bind(a.id).run();
  assert.equal((await abrir({ "x-dev-grupos": "gerente" })).status, 302);
  assert.equal((await t.staff("vaga_preparacao_desanexar", { vaga_id: b.id, arquivo_id: id })).ok, false);
  assert.equal((await t.staff("vaga_preparacao_desanexar", { vaga_id: a.id, arquivo_id: id })).ok, true);
  assert.equal(await t.env.DB.prepare("SELECT id FROM arquivos WHERE id = ?").bind(id).first(), null);
});
