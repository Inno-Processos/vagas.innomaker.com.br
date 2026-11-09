// Fluxos completos sem subir servidor: rotas chamadas direto, banco SQLite temporário e e-mail falso.
// Inscrição (consentimento e origem), avaliação, agendamento com reserva, lembretes, banco de talentos,
// indicadores, exclusão LGPD, prazo de guarda e backup externo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { abrirBanco } from "../backend/src/infra/banco.js";
import { criarBackupExterno } from "../backend/src/infra/backupExterno.js";
import { avisosAoCandidato } from "../backend/src/cron.js";
import { lembretesDeEntrevista } from "../backend/src/api/agendamento.js";
import { limpezaLgpd } from "../backend/src/lib/lgpd.js";
import { ambiente, criarVaga, pastaTemp, bancos, RAIZ } from "./apoio.js";
import { agoraLocal, somarMinutos, lerParticipantes, icsEvento, localParaDate, dataHoraExtenso } from "../backend/src/lib/agenda.js";

// =====================================================================
test("agenda: horário de Brasília, convite .ics e participantes", () => {
  assert.equal(somarMinutos("2026-12-31T23:30", 45), "2027-01-01T00:15");
  assert.equal(localParaDate("2026-11-10T14:00").toISOString(), "2026-11-10T17:00:00.000Z");
  assert.match(agoraLocal(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(dataHoraExtenso("2026-11-10T14:00"), "terça-feira, 10/11/2026 às 14:00");
  assert.deepEqual(lerParticipantes("Ana <ANA@x.com>, bia@x.com\nana@x.com; invalido"),
    [{ nome: "Ana", email: "ana@x.com" }, { nome: "", email: "bia@x.com" }]);
  const ics = icsEvento({ uid: "u1", metodo: "REQUEST", sequencia: 2, inicio: "2026-11-10T14:00", fim: "2026-11-10T14:30",
    titulo: "Entrevista; com vírgula, e acento é longo ".repeat(4), local: "Sala 1", organizador: { nome: "RH", email: "rh@x.com" },
    participantes: [{ nome: "Ana", email: "ana@x.com" }] });
  assert.match(ics, /DTSTART:20261110T170000Z/);
  assert.match(ics, /SEQUENCE:2/);
  assert.match(ics.replace(/\r\n /g, ""), /ATTENDEE;CN=Ana.*mailto:ana@x.com/);
  assert.ok(ics.split("\r\n").every(l => Buffer.byteLength(l, "utf8") <= 75), "linhas dobradas em 75 bytes");
  assert.match(icsEvento({ uid: "u1", metodo: "CANCEL", inicio: "2026-11-10T14:00", fim: "2026-11-10T14:30", titulo: "x" }), /STATUS:CANCELLED/);
});

test("inscrição: exige consentimento, guarda origem/indicação e o banco de talentos", async () => {
  const t = ambiente();
  const vaga = await criarVaga(t.staff, "Estágio Origem");
  const sem = await t.inscrever(vaga, { nome: "Sem Aceite", email: "sem@x.com", aceite_privacidade: "" });
  assert.equal(sem.ok, false);
  assert.match(sem.erro, /Política de privacidade/);
  const semNome = await t.inscrever(vaga, { nome: "Indicada", email: "ind@x.com", origem: "indicacao" });
  assert.equal(semNome.ok, false, "indicação precisa do nome de quem indicou");
  const ok = await t.inscrever(vaga, { nome: "Indicada Silva", email: "ind@x.com", origem: "indicacao", indicado_por: "Pessoa RH", banco_talentos: "1" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const c = await t.env.DB.prepare("SELECT * FROM candidatos WHERE email = 'ind@x.com'").first();
  assert.ok(c.consentimento_em);
  assert.equal(c.banco_talentos, 1);
  const ca = await t.env.DB.prepare("SELECT * FROM candidaturas WHERE candidato_id = ?").bind(c.id).first();
  assert.equal(ca.origem, "indicacao");
  assert.equal(ca.indicado_por, "Pessoa RH");

  // link de indicação do funcionário já leva o nome dele
  const abertas = await t.staff("vagas_abertas", {}, "funcionario");
  assert.match(abertas.vagas[0].link, /origem=indicacao&ind=Pessoa%20RH/);

  // desligar o banco de talentos pela Área do candidato
  const s = await t.entrar("ind@x.com");
  const area = await t.comoCandidato(s, "area");
  assert.equal(area.json.privacidade.banco_talentos, true);
  assert.equal((await t.comoCandidato(s, "privacidade", { banco_talentos: false })).json.banco_talentos, false);
});

test("agendamento: RH abre horários, candidato reserva, ninguém ocupa o mesmo horário, lembrete na véspera", async () => {
  const t = ambiente();
  const vaga = await criarVaga(t.staff, "Estágio Agenda");
  assert.equal((await t.inscrever(vaga, { nome: "Ana Um", email: "ana@x.com" })).ok, true);
  assert.equal((await t.inscrever(vaga, { nome: "Bia Dois", email: "bia@x.com" })).ok, true);
  const det = await t.staff("vaga_detalhe", { id: vaga });
  for (const c of det.candidatos) {
    const tri = c.etapas.find(e => e.ordem === 1);
    assert.equal((await t.staff("etapa_atualizar", { etapa_id: tri.id, resultado: "Aprovado", nota: 3, analise: "Currículo bom" })).ok, true);
  }

  const h1 = somarMinutos(agoraLocal(), 3 * 24 * 60).slice(0, 14) + "00";
  const h2 = somarMinutos(h1, 60);
  assert.equal((await t.staff("agenda_salvar", { vaga_id: vaga, etapa_nome: "Triagem", local: "Sala 1", duracao_min: 30, participantes: "rh@x.com" })).ok, false,
    "Triagem não tem agenda");
  const ag = await t.staff("agenda_salvar", { vaga_id: vaga, etapa_nome: "Entrevista RH", local_tipo: "online", local: "https://meet.example/abc",
    duracao_min: 30, participantes: "Entrevistador <entrevista@innomaker.com.br>", horarios_novos: [h1, h2, "2000-01-01T10:00"] });
  assert.equal(ag.ok, true, JSON.stringify(ag));
  assert.equal(ag.criados, 2, "horário no passado é ignorado");

  // gerente sem relação com a vaga não vê a agenda; RH vê os candidatos elegíveis
  assert.equal((await t.staff("agenda_listar", { vaga_id: vaga }, "gerente")).ok, false);
  const lista = await t.staff("agenda_listar", { vaga_id: vaga });
  assert.equal(lista.agendas[0].elegiveis.length, 2);
  assert.equal(lista.agendas[0].livres, 2);

  const conv = await t.staff("agenda_convidar", { agenda_id: ag.id, candidatura_ids: det.candidatos.map(c => c.id) });
  assert.equal(conv.enviados.length, 2, JSON.stringify(conv));
  const tokens = (await t.env.DB.prepare("SELECT e.agenda_token, c.email FROM etapas e JOIN candidaturas ca ON ca.id = e.candidatura_id JOIN candidatos c ON c.id = ca.candidato_id WHERE e.agenda_token IS NOT NULL").all()).results;
  const tok = Object.fromEntries(tokens.map(x => [x.email, x.agenda_token]));

  const ver = await t.chamar("/api/agendar/" + tok["ana@x.com"], { method: "GET" });
  assert.equal(ver.json.livres.length, 2);
  assert.equal(ver.json.local, "", "link online só aparece depois de reservar");
  assert.equal((await t.chamar("/api/agendar/" + "f".repeat(40), { method: "GET" })).status, 404);

  const hid = ver.json.livres[0].id;
  const r1 = await t.chamar("/api/agendar/" + tok["ana@x.com"] + "/reservar", { body: { horario_id: hid } });
  assert.equal(r1.json.ok, true, JSON.stringify(r1.json));
  const convite = t.enviados.find(m => m.convite && [].concat(m.para).includes("ana@x.com"));
  assert.equal(convite.convite.metodo, "REQUEST");
  assert.ok(t.enviados.some(m => m.convite && [].concat(m.para).includes("entrevista@innomaker.com.br")), "entrevistador recebe o convite");

  const r2 = await t.chamar("/api/agendar/" + tok["bia@x.com"] + "/reservar", { body: { horario_id: hid } });
  assert.equal(r2.status, 409, "mesmo horário não pode ser reservado duas vezes");
  assert.equal(r2.json.ocupado, true);
  assert.equal((await t.chamar("/api/agendar/" + tok["ana@x.com"] + "/reservar", { body: { horario_id: ver.json.livres[1].id } })).json.ok, false,
    "um horário por candidato");

  // a Área do candidato mostra o horário reservado
  const s = await t.entrar("ana@x.com");
  const area = await t.comoCandidato(s, "area");
  assert.equal(area.json.candidaturas[0].agenda.horario, h1);
  const ents = await t.staff("entrevistas_listar", { periodo: "proximas" });
  assert.ok(ents.itens.some(i => i.origem === "agenda" && i.candidato_nome === "Ana Um" && i.quando === h1), "reserva aparece em Entrevistas");

  // lembrete 1 dia antes: só uma vez
  await t.env.DB.prepare("UPDATE agenda_horarios SET inicio = ? WHERE id = ?").bind(somarMinutos(agoraLocal(), 24 * 60), hid).run();
  assert.equal(await lembretesDeEntrevista(t.env), 1);
  assert.ok(t.enviados.some(m => /^Lembrete:/.test(m.assunto) && [].concat(m.para).includes("ana@x.com")));
  assert.equal(await lembretesDeEntrevista(t.env), 0);

  // candidato troca de horário: o horário volta a ficar livre e os participantes recebem o cancelamento
  await t.env.DB.prepare("UPDATE agenda_horarios SET inicio = ? WHERE id = ?").bind(h1, hid).run();
  const lib = await t.chamar("/api/agendar/" + tok["ana@x.com"] + "/liberar", {});
  assert.equal(lib.json.ok, true, JSON.stringify(lib.json));
  assert.ok(t.enviados.some(m => m.convite && m.convite.metodo === "CANCEL"));
  assert.equal((await t.chamar("/api/agendar/" + tok["bia@x.com"] + "/reservar", { body: { horario_id: hid } })).json.ok, true);

  // recusa libera o horário do candidato
  const bia = (await t.staff("vaga_detalhe", { id: vaga })).candidatos.find(c => c.email === "bia@x.com");
  const ent = bia.etapas.find(e => e.ordem === 2);
  assert.equal((await t.staff("etapa_atualizar", { etapa_id: ent.id, resultado: "Reprovado", nota: 1, analise: "Não seguiu." })).ok, true);
  assert.equal((await t.env.DB.prepare("SELECT etapa_id FROM agenda_horarios WHERE id = ?").bind(hid).first()).etapa_id, null);
});

test("banco de talentos e indicadores", async () => {
  const t = ambiente();
  const v1 = await criarVaga(t.staff, "Vaga Antiga");
  const v2 = await criarVaga(t.staff, "Vaga Nova");
  await t.inscrever(v1, { nome: "Com Banco", email: "banco@x.com", banco_talentos: "1", origem: "linkedin" });
  await t.inscrever(v1, { nome: "Sem Banco", email: "sembanco@x.com" });
  const det = await t.staff("vaga_detalhe", { id: v1 });
  const sem = det.candidatos.find(c => c.email === "sembanco@x.com");
  const com = det.candidatos.find(c => c.email === "banco@x.com");
  assert.equal(com.origem_nome, "LinkedIn");
  const tri = sem.etapas.find(e => e.ordem === 1);
  await t.staff("etapa_atualizar", { etapa_id: tri.id, resultado: "Reprovado", nota: 2, analise: "Perfil para outra vaga." });

  assert.equal((await t.staff("talento_salvar", { candidato_id: sem.candidato_id, marcado: true, nota: "Bom em CAD", tags: "CAD, mecânica, cad" })).ok, true);
  const tal = await t.staff("talentos_listar");
  assert.equal(tal.itens.length, 2);
  const marcado = tal.itens.find(i => i.email === "sembanco@x.com");
  assert.equal(marcado.talento_tags, "cad, mecânica");
  assert.equal(marcado.banco_talentos, 0);

  const conv = await t.staff("talento_convidar", { vaga_id: v2, candidato_ids: [com.candidato_id, sem.candidato_id] });
  assert.deepEqual(conv.enviados, ["Com Banco"]);
  assert.match(conv.ignorados[0].motivo, /não autorizou/);
  assert.ok(t.enviados.some(m => /origem=talentos/.test(m.html || "")));

  const ind = await t.staff("indicadores", { dias: 30 });
  assert.equal(ind.ok, true);
  assert.equal(ind.resumo.candidaturas, 2);
  assert.equal(ind.resumo.encerrados, 1);
  assert.deepEqual(ind.origens.map(o => o.origem).sort(), ["linkedin", "site"]);
  const triagem = ind.etapas.find(e => e.etapa === "Triagem");
  assert.equal(triagem.chegaram, 2);
  assert.equal(triagem.recusados, 1);
  assert.equal(triagem.aguardando, 1);
  assert.equal((await t.staff("indicadores", {}, "gerente")).ok, false, "só o RH vê os indicadores");
});

test("LGPD: candidato exclui os próprios dados; admissão em andamento bloqueia; prazo de guarda", async () => {
  const t = ambiente();
  const vaga = await criarVaga(t.staff, "Vaga LGPD");
  await t.inscrever(vaga, { nome: "Quer Sair", email: "sair@x.com" });
  const s = await t.entrar("sair@x.com");
  const c = await t.env.DB.prepare("SELECT * FROM candidatos WHERE email = 'sair@x.com'").first();
  const arq = await t.env.DB.prepare("SELECT * FROM arquivos WHERE candidato_id = ?").bind(c.id).first();
  assert.ok(fs.existsSync(path.join(t.dir, "arquivos", arq.r2_key)));

  assert.equal((await t.comoCandidato(s, "excluir", { senha: s.senha, confirmacao: "talvez" })).json.ok, false);
  assert.equal((await t.comoCandidato(s, "excluir", { senha: "errada", confirmacao: "EXCLUIR" })).json.ok, false);
  const ex = await t.comoCandidato(s, "excluir", { senha: s.senha, confirmacao: "EXCLUIR" });
  assert.equal(ex.json.ok, true, JSON.stringify(ex.json));
  assert.equal(await t.env.DB.prepare("SELECT id FROM candidatos WHERE id = ?").bind(c.id).first(), null);
  assert.equal((await t.env.DB.prepare("SELECT count(*) AS n FROM candidaturas WHERE candidato_id = ?").bind(c.id).first()).n, 0);
  assert.ok(!fs.existsSync(path.join(t.dir, "arquivos", arq.r2_key)), "currículo apagado do disco");
  assert.equal((await t.env.DB.prepare("SELECT count(*) AS n FROM log WHERE quem LIKE '%sair@x.com%' OR detalhe LIKE '%sair@x.com%'").first()).n, 0);
  assert.equal((await t.env.DB.prepare("SELECT count(*) AS n FROM emails WHERE para LIKE '%sair@x.com%'").first()).n, 0);
  assert.equal((await t.comoCandidato(s, "area")).json.sessaoExpirada, true, "sessão deixa de valer");

  // com admissão em andamento não exclui
  await t.inscrever(vaga, { nome: "Em Admissão", email: "adm@x.com" });
  const c2 = await t.env.DB.prepare("SELECT * FROM candidatos WHERE email = 'adm@x.com'").first();
  const ca2 = await t.env.DB.prepare("SELECT * FROM candidaturas WHERE candidato_id = ?").bind(c2.id).first();
  await t.env.DB.prepare(`INSERT INTO admissoes (id, candidatura_id, candidato_id, vaga_id, status, email_contato, criado_em, atualizado_em)
    VALUES ('ADM-T-1', ?, ?, ?, 'COMPLETANDO_CADASTRO', 'adm@x.com', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')`).bind(ca2.id, c2.id, vaga).run();
  const bloqueado = await t.staff("candidato_excluir", { candidato_id: c2.id, confirmacao: "EXCLUIR" });
  assert.equal(bloqueado.ok, false);
  assert.match(bloqueado.erro, /admissão/);

  // lembrete de cadastro incompleto: até 3, a cada 2 dias
  assert.equal(await avisosAoCandidato(t.env), 1);
  const lembrete = t.enviados.find(m => /complete seu cadastro/i.test(m.assunto));
  assert.match(lembrete.html, /RG \(frente e verso\)/);
  assert.match(lembrete.html, /Comprovante de residência/);
  assert.equal(await avisosAoCandidato(t.env), 0, "não repete antes de 2 dias");

  // prazo de guarda: antigo e encerrado é apagado; banco de talentos recente fica
  await t.inscrever(vaga, { nome: "Antigo", email: "antigo@x.com" });
  await t.inscrever(vaga, { nome: "Talento", email: "talento@x.com", banco_talentos: "1" });
  await t.env.DB.prepare("UPDATE candidatos SET ultima_atividade = '2020-01-01T00:00:00Z' WHERE email IN ('antigo@x.com', 'talento@x.com')").run();
  await t.env.DB.prepare(`UPDATE candidaturas SET status = 'Encerrado', atualizado_em = '2020-01-01T00:00:00Z'
    WHERE candidato_id IN (SELECT id FROM candidatos WHERE email IN ('antigo@x.com', 'talento@x.com'))`).run();
  assert.equal(await limpezaLgpd(t.env), 1);
  assert.equal(await t.env.DB.prepare("SELECT id FROM candidatos WHERE email = 'antigo@x.com'").first(), null);
  assert.ok(await t.env.DB.prepare("SELECT id FROM candidatos WHERE email = 'talento@x.com'").first());
  assert.ok(await t.env.DB.prepare("SELECT id FROM candidatos WHERE email = 'adm@x.com'").first(), "admissão nunca é apagada pelo prazo");
  assert.equal(await limpezaLgpd(t.env), 0, "uma vez por dia");

  // prazos editáveis com validação
  assert.equal((await t.staff("cfg_salvar_lgpd", { lgpd_meses_retencao: 12, lgpd_meses_banco: 6 })).ok, false);
  assert.equal((await t.staff("cfg_salvar_lgpd", { lgpd_meses_retencao: 6, lgpd_meses_banco: 24 })).ok, true);
  assert.deepEqual((await t.staff("cfg_obter")).lgpd, { retencao: 6, banco: 24 });
});

test("backup externo: copia o banco, espelha os arquivos e apaga o que foi excluído", async () => {
  const dados = pastaTemp(), destino = pastaTemp();
  const db = abrirBanco(dados, path.join(RAIZ, "backend", "migrations"));
  bancos.push(db);
  db.backup(true);
  fs.mkdirSync(path.join(dados, "arquivos", "curriculos"), { recursive: true });
  fs.writeFileSync(path.join(dados, "arquivos", "curriculos", "a.pdf"), "A");
  fs.writeFileSync(path.join(dados, "arquivos", "curriculos", "b.pdf"), "B");

  const semDestino = criarBackupExterno(dados, "");
  assert.equal(await semDestino.copiar(true), null);
  assert.equal(semDestino.status().configurado, false);

  const fora = criarBackupExterno(dados, path.join(destino, "nao-montado"));
  const falha = await fora.copiar(true);
  assert.equal(falha.ok, false);
  assert.match(falha.erro, /não existe/);

  const be = criarBackupExterno(dados, destino);
  const r = await be.copiar(true);
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.arquivos.copiados, 2);
  assert.equal(fs.readdirSync(path.join(destino, "banco")).filter(f => f.endsWith(".db")).length, 1);
  assert.equal(await be.copiar(), null, "uma vez por dia");

  fs.rmSync(path.join(dados, "arquivos", "curriculos", "b.pdf"));
  const r2 = await be.copiar(true);
  assert.equal(r2.arquivos.removidos, 1);
  assert.equal(r2.arquivos.copiados, 0);
  assert.ok(!fs.existsSync(path.join(destino, "arquivos", "curriculos", "b.pdf")));
  assert.equal(be.status().ok, true);
});

test("agenda como no Google Agenda: disponibilidade semanal, horários tirados à mão e um entrevistador em duas vagas", async () => {
  const t = ambiente();
  const v1 = await criarVaga(t.staff, "Vaga A"), v2 = await criarVaga(t.staff, "Vaga B");
  // próxima segunda-feira a pelo menos 2 dias
  let seg = new Date(Date.now() + 2 * 864e5);
  while (seg.getUTCDay() !== 1) seg = new Date(seg.getTime() + 864e5);
  const dia = seg.toISOString().slice(0, 10);
  const base = { etapa_nome: "Entrevista RH", local: "Sala 2 — Rua da Conceição, 100", duracao_min: 30, intervalo_min: 15,
    participantes: "Rebeca <rebeca@innomaker.com.br>", descricao: "Traga documento com foto.", data_inicio: dia, data_fim: dia,
    disponibilidade: { "1": [["09:00", "11:00"]] } };
  assert.equal((await t.staff("agenda_salvar", Object.assign({}, base, { vaga_id: v1, disponibilidade: { "1": [["11:00", "09:00"]] } }))).ok, false, "início depois do fim");
  const a1 = await t.staff("agenda_salvar", Object.assign({}, base, { vaga_id: v1, titulo: "Entrevista RH — Vaga A" }));
  assert.equal(a1.ok, true, JSON.stringify(a1));
  // 09:00, 09:45, 10:30 (30 min + 15 de intervalo; 11:15 não cabe)
  let l1 = (await t.staff("agenda_listar", { vaga_id: v1 })).agendas[0];
  assert.deepEqual(l1.horarios.map(h => h.inicio.slice(11)), ["09:00", "09:45", "10:30"]);
  assert.equal(l1.titulo, "Entrevista RH — Vaga A");
  assert.equal(l1.instrucoes, "Traga documento com foto.");

  // tirar um horário à mão: ele não volta quando a agenda é salva de novo
  const h0945 = l1.horarios.find(h => h.inicio.endsWith("09:45"));
  await t.staff("agenda_salvar", Object.assign({}, base, { id: a1.id, vaga_id: v1, horarios_remover: [h0945.id] }));
  await t.staff("agenda_salvar", Object.assign({}, base, { id: a1.id, vaga_id: v1 }));
  l1 = (await t.staff("agenda_listar", { vaga_id: v1 })).agendas[0];
  assert.deepEqual(l1.horarios.map(h => h.inicio.slice(11)), ["09:00", "10:30"]);
  // horário avulso clicado na grade
  await t.staff("agenda_salvar", Object.assign({}, base, { id: a1.id, vaga_id: v1, horarios_novos: [dia + "T14:00"] }));
  l1 = (await t.staff("agenda_listar", { vaga_id: v1 })).agendas[0];
  assert.deepEqual(l1.horarios.map(h => h.inicio.slice(11)), ["09:00", "10:30", "14:00"]);

  // mesma entrevistadora numa segunda vaga, no mesmo dia e hora
  const a2 = await t.staff("agenda_salvar", Object.assign({}, base, { vaga_id: v2 }));
  await t.inscrever(v1, { nome: "Lia Um", email: "lia@x.com" });
  await t.inscrever(v2, { nome: "Rui Dois", email: "rui@x.com" });
  for (const v of [v1, v2]) {
    const c = (await t.staff("vaga_detalhe", { id: v })).candidatos[0];
    await t.staff("etapa_atualizar", { etapa_id: c.etapas.find(e => e.ordem === 1).id, resultado: "Aprovado", nota: 3, analise: "Currículo bom" });
    const ag = (await t.staff("agenda_listar", { vaga_id: v })).agendas[0];
    assert.equal((await t.staff("agenda_convidar", { agenda_id: ag.id, candidatura_ids: [c.id] })).enviados.length, 1);
  }
  const tok = Object.fromEntries((await t.env.DB.prepare(`SELECT e.agenda_token, c.email FROM etapas e JOIN candidaturas ca ON ca.id = e.candidatura_id
    JOIN candidatos c ON c.id = ca.candidato_id WHERE e.agenda_token IS NOT NULL`).all()).results.map(x => [x.email, x.agenda_token]));
  const verLia = (await t.chamar("/api/agendar/" + tok["lia@x.com"], { method: "GET" })).json;
  assert.equal(verLia.titulo, "Entrevista RH — Vaga A");
  assert.equal(verLia.instrucoes, "Traga documento com foto.");
  const nove = verLia.livres.find(h => h.inicio.endsWith("09:00"));
  assert.equal((await t.chamar("/api/agendar/" + tok["lia@x.com"] + "/reservar", { body: { horario_id: nove.id } })).json.ok, true);
  // para o Rui (outra vaga, mesma entrevistadora), as 09:00 somem
  const verRui = (await t.chamar("/api/agendar/" + tok["rui@x.com"], { method: "GET" })).json;
  assert.ok(!verRui.livres.some(h => h.inicio.endsWith("09:00")), "entrevistadora já ocupada às 09:00");
  assert.ok(verRui.livres.some(h => h.inicio.endsWith("09:45")));
  const nove2 = (await t.staff("agenda_listar", { vaga_id: v2 })).agendas[0].horarios.find(h => h.inicio.endsWith("09:00"));
  assert.equal(nove2.bloqueado, true, "o painel mostra o horário como ocupado em outra agenda");
  assert.equal((await t.chamar("/api/agendar/" + tok["rui@x.com"] + "/reservar", { body: { horario_id: nove2.id } })).status, 409);
  assert.ok(a2.ok);
});
