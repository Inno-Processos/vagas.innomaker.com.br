// Itens de prioridade alta da revisão: inscrição em conta alheia, "esqueci a senha" por link, limite de tentativas,
// nova proposta depois de cancelar, reativar candidatura, fila de e-mails e proteção da cópia externa.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ambiente, criarVaga, pastaTemp } from "./apoio.js";
import { reenviarEmails } from "../backend/src/lib/email.js";
import { criarBackupExterno } from "../backend/src/infra/backupExterno.js";

const hoje = d => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + (d || 0) * 864e5));
const PROPOSTA = { tipo_contratacao: "Estágio", cargo: "Estagiário", funcao: "Estágio", departamento: "Engenharia", horario_trabalho: "30h",
  data_inicio: hoje(20), bolsa_innomaker: "R$ 700,00", horarios_inicio: "09:00" };

const fdInscricao = (vaga, email) => {
  const fd = new FormData();
  Object.entries({ vaga_id: vaga, nome: "Dona da Conta", email, telefone: "21999999999", periodo_curso: "5º", previsao_formatura: "2027", aceite_privacidade: "1", banco_talentos: "1" })
    .forEach(([k, v]) => fd.set(k, v));
  fd.set("curriculo", new File(["%PDF-1.4 x"], "cv.pdf", { type: "application/pdf" }));
  return fd;
};

test("inscrição: e-mail com conta só se inscreve logado nela; currículo inválido não cria conta", async () => {
  const t = ambiente();
  const v1 = await criarVaga(t.staff, "Vaga 1", ["Triagem"]);
  const v2 = await criarVaga(t.staff, "Vaga 2", ["Triagem"]);
  assert.equal((await t.inscrever(v1, { nome: "Dona da Conta", email: "dona@x.com" })).ok, true);

  // terceiro tenta inscrever a dona em outra vaga (e ligar o banco de talentos)
  const alheia = (await t.chamar("/api/candidato/inscrever", { body: fdInscricao(v2, "dona@x.com") })).json;
  assert.equal(alheia.ok, false);
  assert.equal(alheia.entrar, true);
  const cand = await t.env.DB.prepare("SELECT banco_talentos FROM candidatos WHERE email = 'dona@x.com'").first();
  assert.equal(cand.banco_talentos, 0, "consentimento não muda sem a pessoa");

  // logada na própria conta, funciona
  const s = await t.entrar("dona@x.com");
  const propria = (await t.chamar("/api/candidato/inscrever", { body: fdInscricao(v2, "dona@x.com"), headers: { cookie: s.cookie } })).json;
  assert.equal(propria.ok, true, JSON.stringify(propria));

  // arquivo que não é PDF: nenhuma conta criada
  const fd = fdInscricao(v1, "novo@x.com");
  fd.set("curriculo", new File(["x"], "cv.docx", { type: "application/msword" }));
  assert.equal((await t.chamar("/api/candidato/inscrever", { body: fd })).json.ok, false);
  assert.equal(await t.env.DB.prepare("SELECT id FROM candidatos WHERE email = 'novo@x.com'").first(), null);
});

test("esqueci a senha: link de uso único, senha atual continua até trocar; bloqueio de login é por conexão", async () => {
  const t = ambiente();
  const v = await criarVaga(t.staff, "Vaga", ["Triagem"]);
  await t.inscrever(v, { nome: "Lia", email: "lia@x.com" });
  const { senha } = await t.entrar("lia@x.com");

  await t.env.DB.prepare("UPDATE candidatos SET senha_enviada_em = NULL").run(); // a senha da inscrição acabou de ser enviada
  assert.equal((await t.chamar("/api/candidato/esqueci", { body: { email: "lia@x.com" } })).json.ok, true);
  const m = t.enviados.filter(x => /Criar nova senha/.test(x.assunto)).pop();
  const token = /redefinir=([0-9a-f]{64})/.exec(m.html)[1];
  assert.equal((await t.chamar("/api/candidato/login", { body: { email: "lia@x.com", senha } })).json.ok, true, "senha atual ainda vale");

  assert.equal((await t.chamar("/api/candidato/redefinir", { body: { token, nova: "curta" } })).json.ok, false);
  const r = await t.chamar("/api/candidato/redefinir", { body: { token, nova: "minhaSenhaNova1" } });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.match(r.cookie, /=/, "já entra logada");
  assert.equal((await t.chamar("/api/candidato/redefinir", { body: { token, nova: "outraSenha123" } })).json.ok, false, "link de uso único");
  assert.equal((await t.chamar("/api/candidato/login", { body: { email: "lia@x.com", senha } })).json.ok, false, "senha antiga deixou de valer");

  // 5 erros a partir de uma conexão não travam a dona em outra conexão
  const ipA = { "x-forwarded-for": "10.0.0.1" }, ipB = { "x-forwarded-for": "10.0.0.2" };
  for (let i = 0; i < 5; i++) await t.chamar("/api/candidato/login", { body: { email: "lia@x.com", senha: "errada" }, headers: ipA });
  assert.match((await t.chamar("/api/candidato/login", { body: { email: "lia@x.com", senha: "minhaSenhaNova1" }, headers: ipA })).json.erro, /Muitas tentativas/);
  assert.equal((await t.chamar("/api/candidato/login", { body: { email: "lia@x.com", senha: "minhaSenhaNova1" }, headers: ipB })).json.ok, true);

  // muitas inscrições da mesma conexão
  let ultima;
  for (let i = 0; i < 21; i++) ultima = (await t.chamar("/api/candidato/inscrever", { body: fdInscricao(v, "spam" + i + "@x.com"), headers: { "x-forwarded-for": "10.9.9.9" } })).json;
  assert.match(ultima.erro, /Muitas inscrições/);
});

test("cancelar admissão permite nova proposta; recusa por engano pode ser reativada; situação respeita a admissão", async () => {
  const t = ambiente();
  const v = await criarVaga(t.staff, "Vaga", ["Triagem"]);
  await t.inscrever(v, { nome: "Rui", email: "rui@x.com" });
  let c = (await t.staff("vaga_detalhe", { id: v })).candidatos[0];
  await t.staff("etapa_atualizar", { etapa_id: c.etapas[0].id, resultado: "Aprovado", nota: 3, analise: "Ótimo currículo" });

  const p1 = await t.staff("proposta_criar", { candidatura_id: c.id, proposta: PROPOSTA, prazo_resposta: hoje(3) });
  assert.equal(p1.ok, true, JSON.stringify(p1));
  assert.equal((await t.staff("candidatura_status", { id: c.id, status: "Encerrado" })).ok, false, "admissão em andamento");
  assert.equal((await t.staff("adm_cancelar", { id: p1.id, motivo: "Vaga suspensa" })).ok, true);
  c = (await t.staff("vaga_detalhe", { id: v })).candidatos[0];
  assert.equal(c.admissao_id, null, "admissão cancelada não conta: botão Enviar proposta volta");
  assert.equal(c.status, "Aprovado");

  const p2 = await t.staff("proposta_criar", { candidatura_id: c.id, proposta: PROPOSTA, prazo_resposta: hoje(3) });
  assert.equal(p2.ok, true, JSON.stringify(p2));
  const s = await t.entrar("rui@x.com");
  assert.equal((await t.comoCandidato(s, "proposta", { admissao_id: p2.id, decisao: "recusar" })).json.ok, true);
  c = (await t.staff("vaga_detalhe", { id: v })).candidatos[0];
  assert.equal(c.status, "Desistiu");

  const re = await t.staff("candidatura_reativar", { id: c.id, motivo: "Recusou por engano", avisar: true });
  assert.equal(re.ok, true, JSON.stringify(re));
  assert.equal(re.status, "Aprovado");
  assert.ok(t.enviados.some(m => /reativada/i.test(m.assunto)));
  assert.equal((await t.staff("candidatura_reativar", { id: c.id })).ok, false, "já está ativa");
  assert.equal((await t.staff("proposta_criar", { candidatura_id: c.id, proposta: PROPOSTA, prazo_resposta: hoje(3) })).ok, true);
  assert.equal((await t.staff("candidatura_reativar", { id: c.id }, "gerente")).ok, false, "só o RH");
});

test("e-mail que falha vai para a fila e é reenviado; depois de 6 tentativas fica como FALHOU", async () => {
  const t = ambiente();
  let falhar = true;
  const enviados = [];
  t.env.CORREIO = { enviar: async m => { if (falhar) throw new Error("Gmail fora do ar"); enviados.push(m); } };
  const { enviarEmail } = await import("../backend/src/lib/email.js");
  const r = await enviarEmail(t.env, { para: "a@x.com", assunto: "Teste fila", html: "<p>oi</p>", texto: "oi" });
  assert.equal(r.ok, false);
  assert.equal(r.naFila, true);
  assert.equal((await t.env.DB.prepare("SELECT status FROM emails WHERE assunto = 'Teste fila'").first()).status, "TENTANDO");

  await t.env.DB.prepare("UPDATE emails_fila SET proxima_em = '2000-01-01'").run();
  falhar = false;
  assert.equal(await reenviarEmails(t.env), 1);
  assert.equal(enviados[0].assunto, "Teste fila");
  assert.equal((await t.env.DB.prepare("SELECT status FROM emails WHERE assunto = 'Teste fila'").first()).status, "ENVIADO");
  assert.equal((await t.env.DB.prepare("SELECT COUNT(*) AS n FROM emails_fila").first()).n, 0);

  falhar = true;
  await enviarEmail(t.env, { para: "b@x.com", assunto: "Nunca vai", html: "x", texto: "x" });
  for (let i = 0; i < 6; i++) { await t.env.DB.prepare("UPDATE emails_fila SET proxima_em = '2000-01-01'").run(); await reenviarEmails(t.env); }
  assert.equal((await t.env.DB.prepare("SELECT status FROM emails WHERE assunto = 'Nunca vai'").first()).status, "FALHOU");
  assert.equal((await t.env.DB.prepare("SELECT COUNT(*) AS n FROM emails_fila").first()).n, 0);
});

test("cópia externa: apagados vão para a lixeira; origem vazia não apaga a cópia", async () => {
  const dados = pastaTemp(), destino = pastaTemp();
  fs.mkdirSync(path.join(dados, "backups"), { recursive: true });
  fs.writeFileSync(path.join(dados, "backups", "vagas-2026-11-10.db"), "db");
  fs.mkdirSync(path.join(dados, "arquivos", "curriculos"), { recursive: true });
  fs.writeFileSync(path.join(dados, "arquivos", "curriculos", "a.pdf"), "a");
  fs.writeFileSync(path.join(dados, "arquivos", "curriculos", "b.pdf"), "b");
  const bk = criarBackupExterno(dados, destino);
  assert.equal((await bk.copiar(true)).ok, true);

  fs.rmSync(path.join(dados, "arquivos", "curriculos", "b.pdf"));
  const s = await bk.copiar(true);
  assert.equal(s.ok, true);
  assert.equal(s.arquivos.removidos, 1);
  assert.ok(!fs.existsSync(path.join(destino, "arquivos", "curriculos", "b.pdf")));
  const lix = fs.readdirSync(path.join(destino, "lixeira"));
  assert.ok(fs.existsSync(path.join(destino, "lixeira", lix[0], "curriculos", "b.pdf")), "foi para a lixeira");

  fs.rmSync(path.join(dados, "arquivos"), { recursive: true });
  fs.mkdirSync(path.join(dados, "arquivos"));
  const vazio = await bk.copiar(true);
  assert.equal(vazio.ok, false);
  assert.match(vazio.erro, /vazia/);
  assert.ok(fs.existsSync(path.join(destino, "arquivos", "curriculos", "a.pdf")), "a cópia continua inteira");
});
