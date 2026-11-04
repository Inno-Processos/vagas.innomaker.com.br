// =====================================================================
//  Site público e área do candidato
//  POST /api/candidato/<acao>
// =====================================================================
import {
  ErroApi, json, lerJson, agora, hojeISO, dataBR, emailValido, texto, normalizar, soDigitos, parseJson, ehDataISO
} from "../lib/http.js";
import { um, todos, executar, prep, novoId, registrarLog, lerConfig, historicoMais } from "../lib/db.js";
import { hashSenha, novoSalt, gerarSenha, cookieSessao, cookieSair, candidatoDaSessao, sha256Hex } from "../lib/senha.js";
import { enviarEmail, layout, textoSimples } from "../lib/email.js";
import { salvarArquivo, apagarArquivo, ehArquivo } from "../lib/arquivos.js";
import { estadoDasEtapas } from "../lib/etapas.js";
import { cfg } from "../lib/config.js";

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;
const INTERVALO_NOVA_SENHA_MS = 2 * 60 * 1000;

const linkArea = env => cfg(env).siteUrl + "/?page=acompanhar";
const linkPainel = (env, hash) => cfg(env).siteUrl + "/painel#" + hash;

// ---------- Vagas abertas (site público) ----------
export async function vagasPublicas(env) {
  const linhas = await todos(env,
    `SELECT id, titulo, data_limite, localidade, tipo_vaga, tipo_contratacao, carga_horaria, remuneracao,
            descricao, requisitos, principais_funcoes
       FROM vagas
      WHERE status = 'Aberta' AND (data_limite IS NULL OR data_limite = '' OR data_limite >= ?)
      ORDER BY CASE WHEN data_limite IS NULL OR data_limite = '' THEN 1 ELSE 0 END, data_limite, criado_em`, hojeISO());
  return linhas.map(v => ({
    vaga_id: v.id, titulo_vaga: v.titulo, data_limite_inscricao: dataBR(v.data_limite),
    localidade: v.localidade, tipo_vaga: v.tipo_vaga, tipo_contratacao: v.tipo_contratacao,
    carga_horaria: v.carga_horaria, remuneracao_bolsa: v.remuneracao, descricao_geral: v.descricao,
    requisitos: v.requisitos, principais_funcoes: v.principais_funcoes
  }));
}

// ---------- Roteamento ----------
const ACOES = { inscrever, login, sair, esqueci, senha: trocarSenha, area, proposta, cadastro, assinar };

export async function apiCandidato(request, env, ctx, acao) {
  const fn = ACOES[acao];
  if (!fn) return json({ ok: false, erro: "Ação desconhecida." }, 404);
  try {
    const r = await fn(request, env, ctx);
    return r instanceof Response ? r : json(r);
  } catch (e) {
    if (e instanceof ErroApi) return json({ ok: false, erro: e.message, sessaoExpirada: e.status === 401 || undefined }, e.status === 401 ? 401 : 200);
    console.log("apiCandidato", acao, e && e.stack);
    return json({ ok: false, erro: "Erro interno. Tente novamente em instantes." }, 500);
  }
}

async function exigirSessao(env, request) {
  const c = await candidatoDaSessao(env, request);
  if (!c) throw new ErroApi("Sua sessão expirou. Entre novamente.", 401);
  return c;
}

// ---------- Inscrição ----------
async function inscrever(request, env, ctx) {
  let fd;
  try { fd = await request.formData(); } catch (e) { throw new ErroApi("Envio inválido. Recarregue a página e tente de novo."); }
  const f = (k, max) => texto(fd.get(k), max || 300);

  const vaga = await um(env, "SELECT * FROM vagas WHERE id = ?", f("vaga_id"));
  if (!vaga || vaga.status !== "Aberta" || (vaga.data_limite && vaga.data_limite < hojeISO())) {
    throw new ErroApi("As inscrições para esta vaga estão encerradas.");
  }

  const nome = f("nome", 150);
  const email = f("email", 200).toLowerCase();
  const telefone = f("telefone", 40);
  if (!nome) throw new ErroApi("Preencha seu nome completo.");
  if (!emailValido(email)) throw new ErroApi("Informe um e-mail válido.");
  if (!telefone) throw new ErroApi("Preencha seu telefone ou WhatsApp.");
  if (!f("periodo_curso")) throw new ErroApi("Preencha seu período ou semestre.");
  if (!f("previsao_formatura")) throw new ErroApi("Preencha sua previsão de formatura.");
  const cv = fd.get("curriculo");
  if (!ehArquivo(cv)) throw new ErroApi("Selecione seu currículo em PDF.");

  // Conta do candidato (criada na 1ª inscrição, com senha enviada por e-mail)
  let cand = await um(env, "SELECT * FROM candidatos WHERE email = ?", email);
  let senhaNova = "";
  if (!cand) {
    senhaNova = gerarSenha();
    const salt = novoSalt();
    const id = await novoId(env, "CAN", 6);
    await executar(env,
      "INSERT INTO candidatos (id, email, nome, telefone, senha_hash, senha_salt, senha_enviada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, email, nome, telefone, await hashSenha(senhaNova, salt), salt, agora(), agora());
    cand = await um(env, "SELECT * FROM candidatos WHERE id = ?", id);
  } else if (!cand.telefone && telefone) {
    await executar(env, "UPDATE candidatos SET telefone = ? WHERE id = ?", telefone, cand.id);
  }

  if (await um(env, "SELECT id FROM candidaturas WHERE candidato_id = ? AND vaga_id = ?", cand.id, vaga.id)) {
    throw new ErroApi("Você já se inscreveu nesta vaga. Acompanhe pela Área do candidato.");
  }

  const arq = await salvarArquivo(env, cv, { categoria: "curriculos", candidatoId: cand.id, apenasPdf: true });
  const cdtId = await novoId(env, "CDT", 6);
  const etapas = parseJson(vaga.etapas, ["Triagem"]);
  const t = agora();

  try {
    await env.DB.batch([
      prep(env, `INSERT INTO candidaturas (id, candidato_id, vaga_id, periodo_curso, previsao_formatura, mensagem, curriculo_id, criado_em, atualizado_em)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        cdtId, cand.id, vaga.id, f("periodo_curso", 80), f("previsao_formatura", 40), texto(fd.get("mensagem"), 2000), arq.id, t, t),
      ...etapas.map((nomeEtapa, i) => prep(env, "INSERT INTO etapas (candidatura_id, ordem, nome) VALUES (?, ?, ?)", cdtId, i + 1, nomeEtapa))
    ]);
  } catch (e) {
    await apagarArquivo(env, arq.id);
    if (String(e && e.message).indexOf("UNIQUE") >= 0) throw new ErroApi("Você já se inscreveu nesta vaga.");
    throw e;
  }

  await registrarLog(env, email, "INSCRICAO", "candidatura", cdtId, vaga.id);

  const acesso = senhaNova
    ? `<b>Seu acesso à Área do candidato</b><br>E-mail: ${email}<br>Senha: <b style="font-family:Consolas,monospace;font-size:16px;letter-spacing:1px;">${senhaNova}</b><br><span style="color:#666;font-size:13px;">Com ela você acompanha todas as suas candidaturas. Você pode trocar a senha depois de entrar.</span>`
    : "Esta candidatura já aparece na sua Área do candidato. Entre com seu e-mail e a senha que você já recebeu.";
  ctx.waitUntil(enviarEmail(env, {
    para: email,
    assunto: "Inscrição confirmada — " + vaga.titulo,
    html: layout({
      titulo: "Inscrição confirmada",
      paragrafos: [`Olá, <b>${nome.split(" ")[0]}</b>! Recebemos sua inscrição para a vaga <b>${vaga.titulo}</b>.`],
      destaque: acesso,
      botao: { texto: "Acompanhar minha candidatura", url: linkArea(env) }
    }),
    texto: textoSimples("Inscrição confirmada — " + vaga.titulo,
      [senhaNova ? `E-mail: ${email}\nSenha: ${senhaNova}` : "Entre com seu e-mail e a senha que você já recebeu."], linkArea(env))
  }));

  return { ok: true, candidatura_id: cdtId, conta_nova: !!senhaNova };
}

// ---------- Login / senha ----------
async function login(request, env) {
  const b = await lerJson(request);
  const email = texto(b.email, 200).toLowerCase();
  const senha = String(b.senha || "").trim();
  if (!email || !senha) return { ok: false, erro: "Informe seu e-mail e sua senha." };

  const generico = { ok: false, erro: "E-mail ou senha incorretos." };
  const c = await um(env, "SELECT * FROM candidatos WHERE email = ?", email);
  if (!c || !c.senha_hash) return generico;

  if (c.bloqueado_ate && c.bloqueado_ate > agora()) {
    const min = Math.ceil((new Date(c.bloqueado_ate).getTime() - Date.now()) / 60000);
    return { ok: false, erro: `Muitas tentativas. Tente de novo em ${min} min ou use "Esqueci minha senha".` };
  }

  if (await hashSenha(senha, c.senha_salt) !== c.senha_hash) {
    const t = (c.tentativas || 0) + 1;
    if (t >= MAX_TENTATIVAS) {
      await executar(env, "UPDATE candidatos SET tentativas = 0, bloqueado_ate = ? WHERE id = ?",
        new Date(Date.now() + BLOQUEIO_MIN * 60000).toISOString(), c.id);
    } else {
      await executar(env, "UPDATE candidatos SET tentativas = ? WHERE id = ?", t, c.id);
    }
    return generico;
  }

  await executar(env, "UPDATE candidatos SET tentativas = 0, bloqueado_ate = NULL, ultimo_login = ? WHERE id = ?", agora(), c.id);
  return json({ ok: true, nome: c.nome }, 200, { "set-cookie": await cookieSessao(env, c) });
}

async function sair() {
  return json({ ok: true }, 200, { "set-cookie": cookieSair() });
}

async function esqueci(request, env, ctx) {
  const email = texto((await lerJson(request)).email, 200).toLowerCase();
  if (!emailValido(email)) return { ok: false, erro: "Informe um e-mail válido." };
  const resp = { ok: true, mensagem: "Se este e-mail tiver inscrição conosco, a nova senha chega em alguns instantes. Confira também a caixa de spam." };

  const c = await um(env, "SELECT * FROM candidatos WHERE email = ?", email);
  if (!c) return resp;
  if (c.senha_enviada_em && Date.now() - new Date(c.senha_enviada_em).getTime() < INTERVALO_NOVA_SENHA_MS) return resp;

  const senha = gerarSenha();
  const salt = novoSalt();
  await executar(env,
    "UPDATE candidatos SET senha_hash = ?, senha_salt = ?, versao_sessao = versao_sessao + 1, tentativas = 0, bloqueado_ate = NULL, senha_enviada_em = ? WHERE id = ?",
    await hashSenha(senha, salt), salt, agora(), c.id);

  ctx.waitUntil(enviarEmail(env, {
    para: email,
    assunto: "Sua nova senha — Área do candidato Innomaker",
    html: layout({
      titulo: "Sua nova senha",
      paragrafos: ["Esta é a sua nova senha para a Área do candidato. A senha anterior deixou de funcionar."],
      destaque: `E-mail: ${email}<br>Senha: <b style="font-family:Consolas,monospace;font-size:16px;letter-spacing:1px;">${senha}</b>`,
      botao: { texto: "Entrar na Área do candidato", url: linkArea(env) },
      rodape: "Se você não pediu uma nova senha, ignore este e-mail."
    }),
    texto: textoSimples("Sua nova senha", [`E-mail: ${email}`, `Senha: ${senha}`], linkArea(env))
  }));
  return resp;
}

async function trocarSenha(request, env) {
  const c = await exigirSessao(env, request);
  const b = await lerJson(request);
  const atual = String(b.atual || "").trim();
  const nova = String(b.nova || "").trim();
  if (await hashSenha(atual, c.senha_salt) !== c.senha_hash) return { ok: false, erro: "A senha atual está incorreta." };
  if (nova.length < 8) return { ok: false, erro: "A nova senha precisa ter pelo menos 8 caracteres." };

  const salt = novoSalt();
  await executar(env, "UPDATE candidatos SET senha_hash = ?, senha_salt = ?, versao_sessao = versao_sessao + 1 WHERE id = ?",
    await hashSenha(nova, salt), salt, c.id);
  const atualizado = await um(env, "SELECT * FROM candidatos WHERE id = ?", c.id);
  return json({ ok: true, mensagem: "Senha alterada." }, 200, { "set-cookie": await cookieSessao(env, atualizado) });
}

// ---------- Área do candidato ----------
const CAMPOS_PROPOSTA_PUBLICOS = ["tipo_contratacao", "cargo", "funcao", "departamento", "setor", "horario_trabalho",
  "bolsa_valor", "auxilio", "data_inicio", "data_final_bolsa"];

async function area(request, env) {
  const c = await exigirSessao(env, request);
  const config = await lerConfig(env);

  const cdts = await todos(env,
    `SELECT ca.id, ca.vaga_id, ca.status, ca.criado_em, v.titulo
       FROM candidaturas ca JOIN vagas v ON v.id = ca.vaga_id
      WHERE ca.candidato_id = ? ORDER BY ca.criado_em DESC`, c.id);
  const ets = await todos(env,
    `SELECT e.candidatura_id, e.ordem, e.nome, e.resultado, e.data_prevista, e.data_realizada
       FROM etapas e JOIN candidaturas ca ON ca.id = e.candidatura_id WHERE ca.candidato_id = ?`, c.id);

  const candidaturas = cdts.map(ca => {
    const est = estadoDasEtapas(ets.filter(e => e.candidatura_id === ca.id));
    let status = est.status;
    if (ca.status === "Desistiu") status = "Desistência registrada";
    if (ca.status === "Contratado") status = "Contratado";
    return {
      id: ca.id, vaga_id: ca.vaga_id, titulo_vaga: ca.titulo, data_inscricao: ca.criado_em,
      status_publico: status, etapa_atual: est.etapaAtual, mensagem: est.mensagem, etapas: est.etapas
    };
  });

  const adms = await todos(env,
    `SELECT a.*, v.titulo, v.localidade, v.principais_funcoes
       FROM admissoes a JOIN vagas v ON v.id = a.vaga_id
      WHERE a.candidato_id = ? ORDER BY a.criado_em DESC`, c.id);
  const arquivos = adms.length ? await todos(env,
    `SELECT id, nome, categoria, admissao_id FROM arquivos WHERE admissao_id IN (SELECT id FROM admissoes WHERE candidato_id = ?)`, c.id) : [];

  const admissoes = adms.map(a => {
    const p = parseJson(a.proposta, {});
    const proposta = {};
    CAMPOS_PROPOSTA_PUBLICOS.forEach(k => { proposta[k] = p[k] || ""; });
    proposta.localidade = a.localidade;
    proposta.principais_funcoes = a.principais_funcoes;
    const hist = parseJson(a.historico, []);
    const ultimaCorrecao = hist.filter(h => h.acao === "Correção solicitada").pop();
    const recusa = hist.filter(h => h.acao === "Recusada pelo RH").pop();
    return {
      id: a.id, status: a.status, titulo_vaga: a.titulo, proposta,
      cadastro: parseJson(a.cadastro, {}),
      arquivos: arquivos.filter(x => x.admissao_id === a.id).map(x => ({ id: x.id, nome: x.nome, categoria: x.categoria })),
      correcao: ultimaCorrecao ? ultimaCorrecao.texto : "",
      recusa: recusa ? recusa.texto : ""
    };
  });

  const documentos = await todos(env,
    "SELECT id, titulo, status, assinado_em, criado_em FROM documentos WHERE candidato_id = ? AND status <> 'CANCELADO' ORDER BY criado_em DESC", c.id);

  return {
    ok: true,
    conta: { nome: c.nome, email: c.email },
    candidaturas, admissoes, documentos,
    links: { cartilha: config.link_cartilha || "", onboarding: config.link_onboarding || "" }
  };
}

async function admissaoDoCandidato(env, c, id) {
  const a = await um(env, "SELECT * FROM admissoes WHERE id = ?", texto(id, 40));
  if (!a || a.candidato_id !== c.id) throw new ErroApi("Proposta não encontrada.");
  return a;
}

async function emailRH(env, ctx, assunto, titulo, paragrafos, hash) {
  const config = await lerConfig(env);
  if (!config.email_rh) return;
  ctx.waitUntil(enviarEmail(env, {
    para: config.email_rh,
    assunto,
    html: layout({ titulo, paragrafos, botao: { texto: "Abrir no painel", url: linkPainel(env, hash) } }),
    texto: textoSimples(titulo, paragrafos, linkPainel(env, hash))
  }));
}

async function proposta(request, env, ctx) {
  const c = await exigirSessao(env, request);
  const b = await lerJson(request);
  const a = await admissaoDoCandidato(env, c, b.admissao_id);
  if (a.status !== "PROPOSTA_ENVIADA") return { ok: false, erro: "Esta proposta já foi respondida." };

  const aceitar = b.decisao === "aceitar";
  if (!aceitar && b.decisao !== "recusar") return { ok: false, erro: "Decisão inválida." };
  const novo = aceitar ? "COMPLETANDO_CADASTRO" : "PROPOSTA_RECUSADA";

  await env.DB.batch([
    prep(env, "UPDATE admissoes SET status = ?, historico = ?, atualizado_em = ? WHERE id = ?",
      novo, historicoMais(a.historico, c.email, aceitar ? "Proposta aceita" : "Proposta recusada", texto(b.motivo, 1000)), agora(), a.id),
    ...(aceitar ? [] : [prep(env, "UPDATE candidaturas SET status = 'Desistiu', atualizado_em = ? WHERE id = ?", agora(), a.candidatura_id)])
  ]);
  await registrarLog(env, c.email, aceitar ? "PROPOSTA_ACEITA" : "PROPOSTA_RECUSADA", "admissao", a.id, "");

  await emailRH(env, ctx,
    (aceitar ? "Proposta aceita — " : "Proposta recusada — ") + c.nome,
    aceitar ? "Proposta aceita" : "Proposta recusada",
    [aceitar
      ? `<b>${c.nome}</b> aceitou a proposta (${a.id}) e está preenchendo o cadastro.`
      : `<b>${c.nome}</b> recusou a proposta (${a.id}). Selecione outro candidato e envie uma nova proposta.` +
        (b.motivo ? `<br><br>Motivo informado: ${texto(b.motivo, 1000)}` : "")],
    "admissao/" + a.id);

  return { ok: true, status: novo };
}

// ---------- Cadastro de admissão ----------
const CAMPOS_CADASTRO = {
  nome: [150, true], cpf: [20, true], rg: [30, true], cnh: [30], ctps: [30], sexo: [40], data_nascimento: [10, true],
  telefone: [40, true], email_pessoal: [200, true], curriculo_lattes: [300],
  nome_emergencia: [150, true], telefone_emergencia: [40, true],
  cep: [12, true], endereco: [250, true], bairro: [120, true], cidade: [120, true], estado: [2, true],
  grau_instrucao: [60, true], area_formacao: [150, true], instituicao_ensino: [150, true], cr: [20], matricula_uff: [40],
  email_innomaker: [200],
  banco: [80], agencia: [20], conta: [30], tipo_conta: [40], pix_numero: [120], pix_banco: [80]
};

const CATEGORIAS_ARQUIVO = {
  doc_curriculo: "Currículo atualizado",
  doc_pessoais: "Documentos pessoais",
  doc_matricula: "Regularização de matrícula",
  doc_cr: "Declaração de CR",
  doc_plano: "Plano de estudos"
};

export function cpfValido(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => {
    let s = 0;
    for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === +d[9] && dv(10) === +d[10];
}

async function cadastro(request, env, ctx) {
  const c = await exigirSessao(env, request);
  let fd;
  try { fd = await request.formData(); } catch (e) { throw new ErroApi("Envio inválido. Recarregue a página e tente de novo."); }
  const a = await admissaoDoCandidato(env, c, fd.get("admissao_id"));
  if (a.status !== "COMPLETANDO_CADASTRO" && a.status !== "CORRECAO_SOLICITADA") {
    return { ok: false, erro: "Este cadastro não pode ser alterado agora." };
  }

  const dados = {};
  const faltando = [];
  Object.keys(CAMPOS_CADASTRO).forEach(k => {
    const [max, obrig] = CAMPOS_CADASTRO[k];
    dados[k] = texto(fd.get(k), max);
    if (obrig && !dados[k]) faltando.push(k);
  });
  if (faltando.length) return { ok: false, erro: "Preencha os campos obrigatórios.", campos: faltando };
  if (!cpfValido(dados.cpf)) return { ok: false, erro: "CPF inválido.", campos: ["cpf"] };
  if (!ehDataISO(dados.data_nascimento)) return { ok: false, erro: "Data de nascimento inválida.", campos: ["data_nascimento"] };
  if (!emailValido(dados.email_pessoal)) return { ok: false, erro: "E-mail pessoal inválido.", campos: ["email_pessoal"] };
  if (/@id\.uff\.br$/i.test(dados.email_pessoal)) return { ok: false, erro: "Use um e-mail pessoal, não o IdUFF.", campos: ["email_pessoal"] };
  if (dados.email_innomaker && !emailValido(dados.email_innomaker)) return { ok: false, erro: "E-mail Innomaker inválido.", campos: ["email_innomaker"] };
  dados.estado = dados.estado.toUpperCase();

  // Remover arquivos marcados
  const remover = fd.getAll("remover").map(String);
  if (remover.length) {
    const meus = await todos(env, "SELECT id FROM arquivos WHERE admissao_id = ?", a.id);
    for (const id of remover) if (meus.some(m => m.id === id)) await apagarArquivo(env, id);
  }

  // Novos arquivos
  let qtd = 0;
  for (const cat of Object.keys(CATEGORIAS_ARQUIVO)) {
    for (const f of fd.getAll(cat)) {
      if (!ehArquivo(f)) continue;
      if (++qtd > 15) throw new ErroApi("Envie no máximo 15 arquivos por vez.");
      await salvarArquivo(env, f, { categoria: cat, candidatoId: c.id, admissaoId: a.id });
    }
  }

  const temPessoais = await um(env, "SELECT id FROM arquivos WHERE admissao_id = ? AND categoria = 'doc_pessoais' LIMIT 1", a.id);
  if (!temPessoais) return { ok: false, erro: "Anexe seus documentos pessoais (RG, CPF e comprovante de residência).", campos: ["doc_pessoais"] };

  const eraCorrecao = a.status === "CORRECAO_SOLICITADA";
  await executar(env, "UPDATE admissoes SET status = 'AGUARDANDO_APROVACAO', cadastro = ?, historico = ?, atualizado_em = ? WHERE id = ?",
    JSON.stringify(dados), historicoMais(a.historico, c.email, eraCorrecao ? "Cadastro corrigido" : "Cadastro enviado", ""), agora(), a.id);
  await registrarLog(env, c.email, eraCorrecao ? "CADASTRO_CORRIGIDO" : "CADASTRO_ENVIADO", "admissao", a.id, "");

  await emailRH(env, ctx, "Cadastro para conferir — " + dados.nome, "Cadastro aguardando aprovação",
    [`<b>${dados.nome}</b> ${eraCorrecao ? "corrigiu" : "enviou"} o cadastro de admissão (${a.id}).`,
      "Revise todos os campos e documentos antes de aprovar (RHC-PROC-2026-003, item 4.5)."],
    "admissao/" + a.id);

  const config = await lerConfig(env);
  if (config.link_onboarding && !eraCorrecao) {
    ctx.waitUntil(enviarEmail(env, {
      para: dados.email_pessoal,
      assunto: "Cadastro recebido — próximos passos na Innomaker",
      html: layout({
        titulo: "Cadastro recebido",
        paragrafos: [`Olá, <b>${dados.nome.split(" ")[0]}</b>! Recebemos seu cadastro e seus documentos. O RH vai conferir tudo.`,
          "Enquanto isso, você já pode agendar seu onboarding:"],
        botao: { texto: "Agendar onboarding", url: config.link_onboarding }
      }),
      texto: textoSimples("Cadastro recebido", ["Agende seu onboarding:"], config.link_onboarding)
    }));
  }

  return { ok: true, status: "AGUARDANDO_APROVACAO" };
}

// ---------- Assinatura eletrônica de documentos ----------
async function assinar(request, env, ctx) {
  const c = await exigirSessao(env, request);
  const b = await lerJson(request);
  const d = await um(env, "SELECT * FROM documentos WHERE id = ?", texto(b.documento_id, 60));
  if (!d || d.candidato_id !== c.id) return { ok: false, erro: "Documento não encontrado." };
  if (d.status !== "AGUARDANDO_ASSINATURA") return { ok: false, erro: "Este documento não está aguardando assinatura." };
  if (b.concordo !== true) return { ok: false, erro: "Confirme que leu e concorda com o documento." };
  if (await sha256Hex(d.conteudo) !== d.hash) return { ok: false, erro: "O documento foi alterado. Fale com o RH." };

  const f = d.funcionario_matricula ? await um(env, "SELECT nome, dados FROM funcionarios WHERE matricula = ?", d.funcionario_matricula) : null;
  const cpfEsperado = soDigitos(f ? parseJson(f.dados, {}).cpf : "");
  const nomeEsperado = f ? f.nome : c.nome;
  const nome = texto(b.nome, 150);
  if (normalizar(nome) !== normalizar(nomeEsperado)) return { ok: false, erro: "Digite seu nome completo exatamente como no cadastro: " + nomeEsperado + "." };
  if (cpfEsperado && soDigitos(b.cpf) !== cpfEsperado) return { ok: false, erro: "O CPF não confere com o do cadastro." };

  const ip = request.headers.get("cf-connecting-ip") || "";
  await executar(env,
    "UPDATE documentos SET status = 'ASSINADO', assinado_em = ?, assinado_nome = ?, assinado_cpf = ?, assinado_ip = ? WHERE id = ? AND status = 'AGUARDANDO_ASSINATURA'",
    agora(), nome, soDigitos(b.cpf), ip, d.id);
  await registrarLog(env, c.email, "DOCUMENTO_ASSINADO", "documento", d.id, d.titulo);

  if (d.funcionario_matricula) {
    const pend = await um(env, "SELECT COUNT(*) AS n FROM documentos WHERE funcionario_matricula = ? AND status = 'AGUARDANDO_ASSINATURA'", d.funcionario_matricula);
    if (pend && pend.n === 0) {
      await emailRH(env, ctx, "Documentos assinados — " + nomeEsperado, "Todos os documentos foram assinados",
        [`<b>${nomeEsperado}</b> (matrícula ${d.funcionario_matricula}) assinou todos os documentos pendentes.`,
          "Confira e registre a conferência no painel (RHC-PROC-2026-003, item 4.9)."],
        "funcionario/" + d.funcionario_matricula);
    }
  }
  return { ok: true };
}
