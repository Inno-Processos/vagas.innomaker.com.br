// Admissão: proposta com prazo/edição/cancelamento, cadastro com rascunho e documentos por tipo de contrato,
// correção por item, trilha pós-aprovação, pedido de acessos e avisos (vencimento e véspera do 1º dia).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ambiente, criarVaga } from "./apoio.js";
import { vencerPropostas, avisoVesperaInicio } from "../backend/src/cron.js";
import { trilha, documentosExigidos, documentosFaltando, validarCadastro, lerCadastro } from "../backend/src/lib/admissao.js";

const hoje = d => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + (d || 0) * 864e5));

const PROPOSTA = { tipo_contratacao: "Estágio", cargo: "Estagiário", funcao: "Estágio em Mecânica", departamento: "Engenharia",
  horario_trabalho: "30h semanais", data_inicio: hoje(20), bolsa_valor: "R$ 1.200,00", gestor_email: "gestor@innomaker.com.br" };
const CADASTRO = { nome: "Ana Admissão", cpf: "529.982.247-25", rg: "12345", data_nascimento: "2003-04-05", telefone: "21999990000",
  email_pessoal: "ana.adm@x.com", cep: "24000-000", endereco: "Rua A, 1", bairro: "Centro", cidade: "Niterói", estado: "rj",
  nome_emergencia: "Mãe", telefone_emergencia: "21988880000", grau_instrucao: "Graduando", area_formacao: "Engenharia Mecânica",
  instituicao_ensino: "UFF", pix_numero: "ana.adm@x.com" };

// Candidato aprovado em todas as etapas, pronto para a proposta
async function aprovado(t, nome, email) {
  const vaga = await criarVaga(t.staff, "Vaga " + nome, ["Triagem"]);
  assert.equal((await t.inscrever(vaga, { nome, email })).ok, true);
  const c = (await t.staff("vaga_detalhe", { id: vaga })).candidatos[0];
  assert.equal((await t.staff("etapa_atualizar", { etapa_id: c.etapas[0].id, resultado: "Aprovado", nota: 3, analise: "Ótimo currículo" })).status, "Aprovado");
  return { vaga, c };
}
const anexar = (t, s, admissao_id, categoria, nome) => {
  const fd = new FormData();
  fd.set("admissao_id", admissao_id); fd.set("categoria", categoria);
  fd.set("arquivo", new File(["%PDF-1.4 doc"], nome || categoria + ".pdf", { type: "application/pdf" }));
  return t.chamar("/api/candidato/anexar", { body: fd, headers: { cookie: s.cookie } }).then(r => r.json);
};

test("regras: documentos por tipo de contrato, validação e trilha", () => {
  const est = documentosExigidos({}, "Estágio obrigatório");
  assert.ok(est.find(d => d.id === "doc_matricula").obrigatorio, "estágio exige matrícula");
  assert.ok(!documentosExigidos({}, "CLT").find(d => d.id === "doc_matricula").obrigatorio);
  assert.ok(documentosExigidos({}, "CLT").find(d => d.id === "doc_ctps").obrigatorio);
  assert.deepEqual(documentosFaltando(est, [{ categoria: "doc_pessoais" }]).map(d => d.id).sort(), ["doc_cr", "doc_matricula"],
    "envio antigo (documentos pessoais juntos) vale por RG e comprovante");
  const cfg = { admissao_documentos: JSON.stringify([{ id: "doc_x", nome: "Atestado", obrigatorio_para: ["bolsa"] }]) };
  assert.deepEqual(documentosExigidos(cfg, "Bolsa de extensão"), [{ id: "doc_x", nome: "Atestado", obrigatorio: true }]);

  assert.equal(validarCadastro(lerCadastro(CADASTRO)).ok, true);
  assert.deepEqual(validarCadastro(lerCadastro(Object.assign({}, CADASTRO, { pix_numero: "" }))).campos, ["pix_numero", "banco", "agencia", "conta"]);
  assert.deepEqual(validarCadastro(lerCadastro(Object.assign({}, CADASTRO, { email_pessoal: "a@id.uff.br" }))).campos, ["email_pessoal"]);

  const tr = trilha({ status: "APROVADA", historico: "[]", checklist: "{}", funcionario_id: 7 }, { ponto_cadastrado: 1 });
  assert.equal(tr.total, 6);
  assert.equal(tr.passos.find(p => p.id === "aprovacao").feito, true);
  assert.equal(tr.passos.find(p => p.id === "ponto").feito, true);
  assert.equal(tr.proximo, "Acessos criados");
  const enc = trilha({ status: "CANCELADA", historico: "[]", checklist: "{}" }, null, null);
  assert.ok(enc.passos.every(p => p.feito || p.encerrado));
});

test("admissão completa: prazo, edição, rascunho, documentos, correção por item, aprovação e trilha", async () => {
  const t = ambiente();
  const { c } = await aprovado(t, "Ana Admissão", "ana.adm@x.com");

  assert.equal((await t.staff("proposta_criar", { candidatura_id: c.id, proposta: PROPOSTA, prazo_resposta: hoje(-1) })).ok, false, "prazo no passado");
  const pr = await t.staff("proposta_criar", { candidatura_id: c.id, proposta: PROPOSTA, prazo_resposta: hoje(3) });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  assert.ok(t.enviados.some(m => /Responda até/.test(m.html) && [].concat(m.para).includes("ana.adm@x.com")));

  // RH muda a bolsa antes da resposta: candidato é avisado e vê a alteração
  const ed = await t.staff("adm_proposta_salvar", { id: pr.id, proposta: { bolsa_valor: "R$ 1.500,00" } });
  assert.equal(ed.ok, true, JSON.stringify(ed));
  assert.ok(t.enviados.some(m => /proposta foi atualizada/i.test(m.assunto) && /1\.500/.test(m.html)));
  assert.equal((await t.staff("adm_proposta_salvar", { id: pr.id, proposta: {} })).ok, false, "nada mudou");

  const s = await t.entrar("ana.adm@x.com");
  let area = (await t.comoCandidato(s, "area")).json;
  let adm = area.admissoes[0];
  assert.equal(adm.prazo_resposta, hoje(3));
  assert.equal(adm.alteracoes.length, 1);
  assert.equal(adm.proposta.bolsa_valor, "R$ 1.500,00");
  assert.ok(adm.documentos_exigidos.find(d => d.id === "doc_matricula").obrigatorio, "estágio: matrícula obrigatória");
  assert.equal((await t.comoCandidato(s, "proposta", { admissao_id: pr.id, decisao: "aceitar" })).json.status, "COMPLETANDO_CADASTRO");

  // Rascunho: salva no meio e volta preenchido
  assert.equal((await t.comoCandidato(s, "rascunho", { admissao_id: pr.id, dados: { nome: "Ana Admissão", cpf: "529.982.247-25" } })).json.ok, true);
  area = (await t.comoCandidato(s, "area")).json;
  assert.equal(area.admissoes[0].cadastro.cpf, "529.982.247-25");

  // Documentos: um por vez, categoria inválida recusada, envio sem os obrigatórios recusado
  assert.equal((await anexar(t, s, pr.id, "doc_inventado")).ok, false);
  assert.equal((await anexar(t, s, pr.id, "doc_rg")).ok, true);
  let env = await t.comoCandidato(s, "cadastro", { admissao_id: pr.id, dados: CADASTRO });
  assert.equal(env.json.ok, false);
  assert.match(env.json.erro, /Comprovante de residência/);
  assert.ok(env.json.campos.includes("doc_matricula"));
  for (const cat of ["doc_comprovante", "doc_matricula", "doc_cr"]) assert.equal((await anexar(t, s, pr.id, cat)).ok, true);
  assert.equal((await t.comoCandidato(s, "cadastro", { admissao_id: pr.id, dados: Object.assign({}, CADASTRO, { cpf: "111.111.111-11" }) })).json.campos[0], "cpf");
  env = await t.comoCandidato(s, "cadastro", { admissao_id: pr.id, dados: CADASTRO });
  assert.equal(env.json.ok, true, JSON.stringify(env.json));
  assert.equal((await t.comoCandidato(s, "rascunho", { admissao_id: pr.id, dados: {} })).json.ok, false, "enviado: não edita mais");

  // Correção por item: um campo e um documento
  let det = await t.staff("adm_detalhe", { id: pr.id });
  assert.deepEqual(det.documentosFaltando, []);
  assert.equal((await t.staff("adm_decidir", { id: pr.id, decisao: "correcao", itens: [{ tipo: "campo", chave: "endereco", comentario: "" }] })).ok, false, "comentário obrigatório");
  const corr = await t.staff("adm_decidir", { id: pr.id, decisao: "correcao", texto: "Obrigado!",
    itens: [{ tipo: "campo", chave: "endereco", comentario: "Falta o número do apartamento" }, { tipo: "arquivo", chave: "doc_rg", comentario: "Foto ilegível" }] });
  assert.equal(corr.ok, true, JSON.stringify(corr));
  assert.ok(t.enviados.some(m => /Foto ilegível/.test(m.html) && /Endereço/.test(m.html)));
  adm = (await t.comoCandidato(s, "area")).json.admissoes[0];
  assert.equal(adm.status, "CORRECAO_SOLICITADA");
  assert.deepEqual(adm.correcoes.itens.map(i => i.chave), ["endereco", "doc_rg"]);
  assert.equal(adm.cadastro.endereco, "Rua A, 1", "o formulário volta preenchido");

  const corrigido = Object.assign({}, CADASTRO, { endereco: "Rua A, 1, apto 202" });
  env = await t.comoCandidato(s, "cadastro", { admissao_id: pr.id, dados: corrigido });
  assert.equal(env.json.ok, false, "documento apontado precisa de arquivo novo");
  assert.deepEqual(env.json.campos, ["doc_rg"]);
  await new Promise(r => setTimeout(r, 5));
  assert.equal((await anexar(t, s, pr.id, "doc_rg", "rg-novo.pdf")).ok, true);
  assert.equal((await t.comoCandidato(s, "cadastro", { admissao_id: pr.id, dados: corrigido })).json.ok, true);
  det = await t.staff("adm_detalhe", { id: pr.id });
  assert.equal(det.admissao.correcoes.itens[0].valor_antes, "Rua A, 1");
  assert.equal(det.admissao.cadastro.endereco, "Rua A, 1, apto 202");

  // RH muda a data de início depois do cadastro: candidato precisa aceitar de novo, mas não perde o cadastro
  const ed2 = await t.staff("adm_proposta_salvar", { id: pr.id, proposta: { data_inicio: hoje(25) }, prazo_resposta: hoje(2) });
  assert.equal(ed2.status, "PROPOSTA_ENVIADA");
  assert.equal((await t.comoCandidato(s, "proposta", { admissao_id: pr.id, decisao: "aceitar" })).json.ok, true);
  assert.equal((await t.comoCandidato(s, "area")).json.admissoes[0].cadastro.endereco, "Rua A, 1, apto 202");
  assert.equal((await t.comoCandidato(s, "cadastro", { admissao_id: pr.id, dados: corrigido })).json.ok, true);
  // mudar só o que é interno (observação) não reabre a proposta
  assert.equal((await t.staff("adm_proposta_salvar", { id: pr.id, proposta: { observacao: "Conferir notebook" } })).status, "AGUARDANDO_APROVACAO");

  // Aprovação e trilha
  const ap = await t.staff("adm_decidir", { id: pr.id, decisao: "aprovar" });
  assert.equal(ap.ok, true, JSON.stringify(ap));
  det = await t.staff("adm_detalhe", { id: pr.id });
  assert.equal(det.trilha.passos.find(p => p.id === "aprovacao").feito, true);
  assert.equal(det.trilha.proximo, "Cadastro no aplicativo de ponto");
  // o registro em Funcionários tem tudo o que o candidato preencheu e os arquivos
  const fd = await t.staff("func_detalhe", { matricula: ap.matricula });
  assert.equal(fd.funcionario.dados.endereco, "Rua A, 1, apto 202");
  assert.ok(fd.arquivos.some(x => x.categoria === "doc_rg" && x.categoria_nome));
  assert.ok(fd.camposCadastro.length > 20);
  assert.equal(fd.candidatura.periodo_curso, "5º");
  assert.equal((await t.staff("adm_passo", { id: pr.id, passo: "invalido" })).ok, false);
  const passo = await t.staff("adm_passo", { id: pr.id, passo: "ponto", feito: true });
  assert.equal(passo.trilha.passos.find(p => p.id === "ponto").feito, true);
  assert.ok(passo.trilha.passos.find(p => p.id === "ponto").quando);
  assert.equal((await t.staff("func_detalhe", { matricula: ap.matricula })).funcionario.ponto_cadastrado, 1);
  // marcar pela tela do Funcionário também registra a data na trilha
  await t.staff("func_atualizar", { matricula: ap.matricula, onboarding_ok: true });
  assert.ok((await t.staff("adm_detalhe", { id: pr.id })).trilha.passos.find(p => p.id === "onboarding").quando);

  // Pedido de acessos
  assert.equal((await t.staff("adm_pedir_acessos", { id: pr.id })).ok, false, "sem e-mail configurado");
  assert.equal((await t.staff("cfg_salvar_admissao", { email_acessos: "ti@innomaker.com.br", documentos: (await t.staff("cfg_obter")).admissaoDocumentos })).ok, true);
  const ac = await t.staff("adm_pedir_acessos", { id: pr.id, observacao: "Precisa do SolidWorks" });
  assert.equal(ac.para, "ti@innomaker.com.br");
  assert.ok(t.enviados.some(m => [].concat(m.para).includes("ti@innomaker.com.br") && /SolidWorks/.test(m.html)));

  // Véspera do 1º dia: gestor/RH e o novo colaborador, uma vez
  await t.env.DB.prepare("UPDATE funcionarios SET data_efetivacao = ? WHERE matricula = ?").bind(hoje(1), ap.matricula).run();
  assert.equal(await avisoVesperaInicio(t.env), 1);
  assert.ok(t.enviados.some(m => [].concat(m.para).includes("gestor@innomaker.com.br") && /Ainda falta/.test(m.html) && /Acessos/.test(m.html)));
  assert.ok(t.enviados.some(m => /primeiro dia/.test(m.assunto) && [].concat(m.para).includes("ana.adm@x.com")));
  assert.equal(await avisoVesperaInicio(t.env), 0);

  // Lista mostra o progresso; gerente sem relação com a vaga não vê
  const lista = await t.staff("adm_listar");
  assert.ok(lista.itens[0].trilha.feitos >= 4);
  assert.equal((await t.staff("adm_area", {}, "gerente")).itens.length, 0);
  assert.equal((await t.staff("adm_area", {}, "funcionario")).ok, false);
});

test("proposta vence sem resposta, é reaberta pelo RH, e cancelamento libera nova proposta", async () => {
  const t = ambiente();
  const { c } = await aprovado(t, "Bruno Prazo", "bruno.prazo@x.com");
  const pr = await t.staff("proposta_criar", { candidatura_id: c.id, proposta: PROPOSTA, prazo_resposta: hoje(1) });
  await t.env.DB.prepare("UPDATE admissoes SET prazo_resposta = ? WHERE id = ?").bind(hoje(-1), pr.id).run();
  const s = await t.entrar("bruno.prazo@x.com");
  assert.match((await t.comoCandidato(s, "proposta", { admissao_id: pr.id, decisao: "aceitar" })).json.erro, /prazo/);

  assert.equal(await vencerPropostas(t.env), 1);
  let det = await t.staff("adm_detalhe", { id: pr.id });
  assert.equal(det.admissao.status, "PROPOSTA_EXPIRADA");
  assert.equal((await t.staff("vaga_detalhe", { id: c.vaga_id })).candidatos[0].status, "Aprovado");
  assert.ok(t.enviados.some(m => /venceu/.test(m.assunto) && [].concat(m.para).includes("bruno.prazo@x.com")));
  assert.equal(await vencerPropostas(t.env), 0);

  const re = await t.staff("adm_proposta_salvar", { id: pr.id, proposta: {}, prazo_resposta: hoje(4) });
  assert.equal(re.status, "PROPOSTA_ENVIADA", JSON.stringify(re));
  assert.equal((await t.staff("vaga_detalhe", { id: c.vaga_id })).candidatos[0].status, "Proposta");

  assert.equal((await t.staff("adm_cancelar", { id: pr.id, motivo: "" })).ok, false);
  assert.equal((await t.staff("adm_cancelar", { id: pr.id, motivo: "Vaga suspensa pela diretoria" })).ok, true);
  det = await t.staff("adm_detalhe", { id: pr.id });
  assert.equal(det.admissao.status, "CANCELADA");
  assert.ok(t.enviados.some(m => /suspensa/.test(m.html) && [].concat(m.para).includes("bruno.prazo@x.com")));
  assert.equal((await t.comoCandidato(s, "proposta", { admissao_id: pr.id, decisao: "aceitar" })).json.ok, false);
  const nova = await t.staff("proposta_criar", { candidatura_id: c.id, proposta: PROPOSTA, prazo_resposta: hoje(3) });
  assert.equal(nova.ok, true, "cancelada não bloqueia uma nova proposta");
});

test("data da etapa enviada ao candidato e lista de entrevistas", async () => {
  const t = ambiente();
  // vaga com entrevista: RH marca data/hora e o candidato recebe com convite de agenda
  const vaga = await criarVaga(t.staff, "Vaga Entrevista");
  await t.inscrever(vaga, { nome: "Eva Data", email: "eva@x.com" });
  let c = (await t.staff("vaga_detalhe", { id: vaga })).candidatos[0];
  const [tri, ent] = c.etapas.sort((x, y) => x.ordem - y.ordem);
  assert.equal((await t.staff("etapa_agendar", { etapa_id: tri.id, data: hoje(3) })).ok, false, "Triagem não tem data");
  await t.staff("etapa_atualizar", { etapa_id: tri.id, resultado: "Aprovado", nota: 3, analise: "Bom currículo" });
  assert.equal((await t.staff("etapa_agendar", { etapa_id: ent.id, data: hoje(-1) })).ok, false, "data no passado");
  const ag = await t.staff("etapa_agendar", { etapa_id: ent.id, data: hoje(3), hora: "14:30", local: "https://meet.example/x", mensagem: "Traga seu portfólio." });
  assert.equal(ag.avisado, true, JSON.stringify(ag));
  const m = t.enviados.find(x => /^Data marcada/.test(x.assunto));
  assert.ok(m && m.convite && /DTSTART:/.test(m.convite.ics) && /portfólio/.test(m.html));
  c = (await t.staff("vaga_detalhe", { id: vaga })).candidatos[0];
  const e2 = c.etapas.find(x => x.id === ent.id);
  assert.equal(e2.hora_prevista, "14:30");
  assert.ok(e2.data_enviada_em);
  const s0 = await t.entrar("eva@x.com");
  const cd = (await t.comoCandidato(s0, "area")).json.candidaturas[0];
  assert.deepEqual(cd.marcada, { data: hoje(3), hora: "14:30", local: "https://meet.example/x" });
  assert.equal(cd.etapas.find(x => x.nome === "Entrevista RH").hora, "14:30");

  // Entrevistas: aparece na lista do RH; gerente sem relação com a vaga não vê
  const lista = await t.staff("entrevistas_listar", { periodo: "proximas" });
  assert.equal(lista.itens.length, 1);
  assert.equal(lista.itens[0].hora, "14:30");
  assert.equal(lista.itens[0].candidato_nome, "Eva Data");
  assert.equal(lista.itens[0].avisado, true);
  assert.equal((await t.staff("entrevistas_listar", {}, "gerente")).itens.length, 0);
  assert.equal((await t.staff("entrevistas_listar", {}, "funcionario")).ok, false);
});
