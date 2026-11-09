// =====================================================================
//  Site público e área do candidato
//  POST /api/candidato/<acao>
// =====================================================================
import {
  ErroApi, json, lerJson, agora, hojeISO, dataBR, emailValido, texto, normalizar, soDigitos, parseJson, ehDataISO, esc
} from "../lib/http.js";
import { um, todos, executar, prep, novoId, registrarLog, lerConfig, historicoMais } from "../lib/db.js";
import { hashSenha, novoSalt, gerarSenha, cookieSessao, cookieSair, candidatoDaSessao, sha256Hex } from "../lib/senha.js";
import { enviarEmail, layout, textoSimples } from "../lib/email.js";
import { salvarArquivo, apagarArquivo, ehArquivo } from "../lib/arquivos.js";
import { estadoDasEtapas } from "../lib/etapas.js";
import { cfg, CAMINHO_AREA } from "../lib/config.js";
import { excluirCandidato, bloqueioExclusao } from "../lib/lgpd.js";
import { agoraLocal } from "../lib/agenda.js";
import {
  ADM_CANDIDATO_PREENCHE, CAMPOS_PROPOSTA, lerCadastro, validarCadastro, cpfValido, documentosExigidos, documentosFaltando,
  categoriaValida, CATEGORIA_ANTIGA, nomeCategoria
} from "../lib/admissao.js";

// De onde o candidato soube da vaga (indicadores do RH)
export const ORIGENS = { site: "Site de vagas", indicacao: "Indicação de funcionário", linkedin: "LinkedIn", instagram: "Instagram",
  universidade: "Universidade / empresa júnior", talentos: "Convite do banco de talentos", outro: "Outro" };

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MIN = 15;
const INTERVALO_NOVA_SENHA_MS = 2 * 60 * 1000;

const linkArea = env => cfg(env).siteUrl + CAMINHO_AREA;
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
const ACOES = { inscrever, login, sair, esqueci, senha: trocarSenha, area, proposta, cadastro, privacidade, excluir, rascunho, anexar, desanexar };

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
  if (f("aceite_privacidade") !== "1") throw new ErroApi("Para se inscrever, leia e aceite a Política de privacidade.");
  const querBanco = f("banco_talentos") === "1";
  const origem = ORIGENS[f("origem", 20)] ? f("origem", 20) : "site";
  const indicadoPor = origem === "indicacao" ? f("indicado_por", 150) : "";
  if (origem === "indicacao" && !indicadoPor) throw new ErroApi("Informe o nome de quem indicou você.");

  // Conta do candidato (criada na 1ª inscrição, com senha enviada por e-mail)
  let cand = await um(env, "SELECT * FROM candidatos WHERE email = ?", email);
  let senhaNova = "";
  if (!cand) {
    senhaNova = gerarSenha();
    const salt = novoSalt();
    const id = await novoId(env, "CAN", 6);
    await executar(env,
      `INSERT INTO candidatos (id, email, nome, telefone, senha_hash, senha_salt, senha_enviada_em, criado_em,
                               consentimento_em, banco_talentos, banco_talentos_em, ultima_atividade) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, email, nome, telefone, await hashSenha(senhaNova, salt), salt, agora(), agora(), agora(), querBanco ? 1 : 0, querBanco ? agora() : null, agora());
    cand = await um(env, "SELECT * FROM candidatos WHERE id = ?", id);
  } else {
    // Nova inscrição renova o aceite; o banco de talentos só liga aqui (desligar é pela Área do candidato)
    await executar(env,
      `UPDATE candidatos SET telefone = CASE WHEN telefone = '' THEN ? ELSE telefone END, consentimento_em = ?, ultima_atividade = ?,
              banco_talentos = CASE WHEN ? = 1 THEN 1 ELSE banco_talentos END,
              banco_talentos_em = CASE WHEN ? = 1 THEN ? ELSE banco_talentos_em END WHERE id = ?`,
      telefone, agora(), agora(), querBanco ? 1 : 0, querBanco ? 1 : 0, agora(), cand.id);
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
      prep(env, `INSERT INTO candidaturas (id, candidato_id, vaga_id, periodo_curso, previsao_formatura, mensagem, curriculo_id, criado_em, atualizado_em,
                                         origem, indicado_por, convite_talento)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        cdtId, cand.id, vaga.id, f("periodo_curso", 80), f("previsao_formatura", 40), texto(fd.get("mensagem"), 2000), arq.id, t, t,
        origem, indicadoPor, origem === "talentos" ? 1 : 0),
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

  await executar(env, "UPDATE candidatos SET tentativas = 0, bloqueado_ate = NULL, ultimo_login = ?, ultima_atividade = ? WHERE id = ?", agora(), agora(), c.id);
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

// ---------- Privacidade (LGPD) ----------
// Liga/desliga o banco de talentos (consentimento separado do da inscrição)
async function privacidade(request, env) {
  const c = await exigirSessao(env, request);
  const b = await lerJson(request);
  const quer = b.banco_talentos === true;
  await executar(env, "UPDATE candidatos SET banco_talentos = ?, banco_talentos_em = ?, ultima_atividade = ? WHERE id = ?",
    quer ? 1 : 0, quer ? agora() : null, agora(), c.id);
  await registrarLog(env, c.email, quer ? "BANCO_TALENTOS_ACEITO" : "BANCO_TALENTOS_RETIRADO", "candidato", c.id, "");
  return { ok: true, banco_talentos: quer };
}

// "Excluir meus dados": confirma com a senha e apaga tudo (exceto o que tem guarda obrigatória)
async function excluir(request, env, ctx) {
  const c = await exigirSessao(env, request);
  const b = await lerJson(request);
  if (String(b.confirmacao || "").trim().toUpperCase() !== "EXCLUIR") return { ok: false, erro: "Digite EXCLUIR para confirmar." };
  if (await hashSenha(String(b.senha || "").trim(), c.senha_salt) !== c.senha_hash) return { ok: false, erro: "Senha incorreta." };
  const r = await excluirCandidato(env, ctx, c.id, "candidato " + c.id, "a pedido do candidato");
  ctx.waitUntil(enviarEmail(env, {
    para: c.email,
    registroPara: "(e-mail excluído)", // o Histórico não guarda o e-mail de quem pediu a exclusão
    assunto: "Seus dados foram excluídos — Innomaker",
    html: layout({ titulo: "Seus dados foram excluídos", paragrafos: [
      `Olá, <b>${String(c.nome).split(" ")[0]}</b>. Conforme o seu pedido, excluímos sua conta da Área do candidato, seus currículos e suas candidaturas (${r.candidaturas}).`,
      "Se quiser participar de novos processos seletivos, é só se inscrever de novo pelo site."] }),
    texto: "Seus dados foram excluídos da Área do candidato Innomaker, conforme o seu pedido."
  }));
  return json({ ok: true }, 200, { "set-cookie": cookieSair() });
}

// ---------- Área do candidato ----------
const CAMPOS_PROPOSTA_PUBLICOS = Object.keys(CAMPOS_PROPOSTA).filter(k => CAMPOS_PROPOSTA[k][3]);

async function area(request, env) {
  const c = await exigirSessao(env, request);
  const config = await lerConfig(env);

  const cdts = await todos(env,
    `SELECT ca.id, ca.vaga_id, ca.status, ca.criado_em, v.titulo
       FROM candidaturas ca JOIN vagas v ON v.id = ca.vaga_id
      WHERE ca.candidato_id = ? ORDER BY ca.criado_em DESC`, c.id);
  const ets = await todos(env,
    `SELECT e.id, e.candidatura_id, e.ordem, e.nome, e.resultado, e.data_prevista, e.data_realizada, e.agenda_token, e.hora_prevista, e.local_prevista,
            (SELECT a.ativo FROM agendas a WHERE a.id = e.agenda_id) AS agenda_ativa,
            (SELECT h.inicio FROM agenda_horarios h WHERE h.etapa_id = e.id) AS horario
       FROM etapas e JOIN candidaturas ca ON ca.id = e.candidatura_id WHERE ca.candidato_id = ?`, c.id);

  const candidaturas = cdts.map(ca => {
    const minhas = ets.filter(e => e.candidatura_id === ca.id);
    const est = estadoDasEtapas(minhas);
    let status = est.status;
    // Etapa atual com agenda: link para escolher (ou ver) o horário
    const atual = ca.status === "Em processo" ? minhas.find(e => e.nome === est.etapaAtual && e.resultado === "Pendente") : null;
    const agenda = atual && atual.agenda_token && (atual.agenda_ativa || atual.horario)
      ? { url: "/agendar/" + atual.agenda_token, etapa: atual.nome, horario: atual.horario || "", passou: !!atual.horario && atual.horario < agoraLocal() }
      : null;
    if (ca.status === "Desistiu") status = "Desistência registrada";
    if (ca.status === "Contratado") status = "Contratado";
    return {
      id: ca.id, vaga_id: ca.vaga_id, titulo_vaga: ca.titulo, data_inscricao: ca.criado_em,
      status_publico: status, etapa_atual: est.etapaAtual, mensagem: est.mensagem, etapas: est.etapas, agenda,
      marcada: atual && atual.data_prevista && !agenda ? { data: atual.data_prevista, hora: atual.hora_prevista || "", local: atual.local_prevista || "" } : null
    };
  });

  const adms = await todos(env,
    `SELECT a.*, v.titulo, v.localidade, v.principais_funcoes
       FROM admissoes a JOIN vagas v ON v.id = a.vaga_id
      WHERE a.candidato_id = ? ORDER BY a.criado_em DESC`, c.id);
  const arquivos = adms.length ? await todos(env,
    `SELECT id, nome, categoria, admissao_id, criado_em FROM arquivos WHERE admissao_id IN (SELECT id FROM admissoes WHERE candidato_id = ?)`, c.id) : [];

  const configAdm = await lerConfig(env);
  const admissoes = adms.map(a => {
    const p = parseJson(a.proposta, {});
    const proposta = {};
    CAMPOS_PROPOSTA_PUBLICOS.forEach(k => { proposta[k] = p[k] || ""; });
    proposta.localidade = a.localidade;
    proposta.principais_funcoes = a.principais_funcoes;
    const hist = parseJson(a.historico, []);
    const ultimaCorrecao = hist.filter(h => h.acao === "Correção solicitada").pop();
    const recusa = hist.filter(h => h.acao === "Recusada pelo RH" || h.acao === "Cancelada pelo RH").pop();
    const corr = parseJson(a.correcoes, {});
    const rasc = parseJson(a.rascunho, {});
    return {
      id: a.id, status: a.status, titulo_vaga: a.titulo, proposta, prazo_resposta: a.prazo_resposta || "",
      alteracoes: hist.filter(h => h.acao === "Proposta alterada" || h.acao === "Proposta reaberta").map(h => ({ quando: h.quando, texto: h.texto })),
      cadastro: Object.keys(rasc).length ? rasc : parseJson(a.cadastro, {}),
      arquivos: arquivos.filter(x => x.admissao_id === a.id).map(x => ({ id: x.id, nome: x.nome, categoria: x.categoria, criado_em: x.criado_em,
        categoria_nome: nomeCategoria(configAdm, x.categoria) })),
      documentos_exigidos: documentosExigidos(configAdm, p.tipo_contratacao),
      correcao: ultimaCorrecao ? ultimaCorrecao.texto : "",
      correcoes: a.status === "CORRECAO_SOLICITADA" ? { em: corr.em || "", texto: corr.texto || "", itens: (corr.itens || []).map(i => ({ tipo: i.tipo, chave: i.chave, rotulo: i.rotulo, comentario: i.comentario })) } : null,
      recusa: recusa ? recusa.texto : ""
    };
  });


  return {
    ok: true,
    conta: { nome: c.nome, email: c.email },
    privacidade: {
      consentimento_em: c.consentimento_em || "", banco_talentos: !!c.banco_talentos, banco_talentos_em: c.banco_talentos_em || "",
      motivoNaoExclui: await bloqueioExclusao(env, c.id)
    },
    candidaturas, admissoes,
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
  if (a.prazo_resposta && a.prazo_resposta < hojeISO()) return { ok: false, erro: "O prazo para responder esta proposta venceu. Fale com o RH." };

  const aceitar = b.decisao === "aceitar";
  if (!aceitar && b.decisao !== "recusar") return { ok: false, erro: "Decisão inválida." };
  const novo = aceitar ? "COMPLETANDO_CADASTRO" : "PROPOSTA_RECUSADA";

  await env.DB.batch([
    prep(env, "UPDATE admissoes SET status = ?, historico = ?, atualizado_em = ?, lembretes = 0, lembrete_em = NULL, rascunho = CASE WHEN rascunho = '{}' THEN cadastro ELSE rascunho END WHERE id = ?",
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
// O formulário salva sozinho (rascunho) e cada documento sobe na hora em que é escolhido;
// "cadastro" só confere tudo e envia ao RH.
export { cpfValido };

async function admissaoEditavel(env, c, id) {
  const a = await admissaoDoCandidato(env, c, id);
  if (ADM_CANDIDATO_PREENCHE.indexOf(a.status) < 0) throw new ErroApi("Este cadastro não pode ser alterado agora.");
  return a;
}

async function rascunho(request, env) {
  const c = await exigirSessao(env, request);
  const b = await lerJson(request);
  const a = await admissaoEditavel(env, c, b.admissao_id);
  await executar(env, "UPDATE admissoes SET rascunho = ? WHERE id = ?", JSON.stringify(lerCadastro(b.dados || {})), a.id);
  return { ok: true, salvo_em: agora() };
}

async function anexar(request, env) {
  const c = await exigirSessao(env, request);
  let fd;
  try { fd = await request.formData(); } catch (e) { throw new ErroApi("Envio inválido. Tente de novo."); }
  const a = await admissaoEditavel(env, c, fd.get("admissao_id"));
  const cat = texto(fd.get("categoria"), 40);
  const config = await lerConfig(env);
  if (!categoriaValida(config, cat) || CATEGORIA_ANTIGA[cat]) throw new ErroApi("Tipo de documento inválido.");
  const ja = await um(env, "SELECT COUNT(*) AS n FROM arquivos WHERE admissao_id = ?", a.id);
  const files = fd.getAll("arquivo").filter(ehArquivo);
  if (!files.length) throw new ErroApi("Escolha um arquivo.");
  if (ja.n + files.length > 30) throw new ErroApi("Limite de 30 arquivos por admissão. Remova algum antes de enviar outro.");
  const salvos = [];
  for (const f of files) salvos.push(Object.assign(await salvarArquivo(env, f, { categoria: cat, candidatoId: c.id, admissaoId: a.id }), { categoria: cat }));
  return { ok: true, arquivos: salvos };
}

async function desanexar(request, env) {
  const c = await exigirSessao(env, request);
  const b = await lerJson(request);
  const a = await admissaoEditavel(env, c, b.admissao_id);
  const arq = await um(env, "SELECT id FROM arquivos WHERE id = ? AND admissao_id = ?", texto(b.arquivo_id, 60), a.id);
  if (!arq) throw new ErroApi("Arquivo não encontrado.");
  await apagarArquivo(env, arq.id);
  return { ok: true };
}

async function cadastro(request, env, ctx) {
  const c = await exigirSessao(env, request);
  const b = await lerJson(request);
  const a = await admissaoEditavel(env, c, b.admissao_id);
  const dados = lerCadastro(b.dados || {});
  // guarda o que foi digitado, mesmo se faltar algo
  await executar(env, "UPDATE admissoes SET rascunho = ? WHERE id = ?", JSON.stringify(dados), a.id);
  const v = validarCadastro(dados);
  if (!v.ok) return { ok: false, erro: v.erro, campos: v.campos };

  const config = await lerConfig(env);
  const p = parseJson(a.proposta, {});
  const arquivos = await todos(env, "SELECT categoria, criado_em FROM arquivos WHERE admissao_id = ?", a.id);
  const faltam = documentosFaltando(documentosExigidos(config, p.tipo_contratacao), arquivos);
  if (faltam.length) return { ok: false, erro: "Anexe: " + faltam.map(d => d.nome).join("; ") + ".", campos: faltam.map(d => d.id) };

  // Correção: documentos apontados pelo RH precisam de um arquivo novo
  const eraCorrecao = a.status === "CORRECAO_SOLICITADA";
  const corr = parseJson(a.correcoes, {});
  if (eraCorrecao && corr.em) {
    const semNovo = (corr.itens || []).filter(i => i.tipo === "arquivo" && !arquivos.some(x => x.categoria === i.chave && x.criado_em > corr.em));
    if (semNovo.length) {
      return { ok: false, erro: "Envie um arquivo novo para: " + semNovo.map(i => i.rotulo).join("; ") + ".", campos: semNovo.map(i => i.chave) };
    }
  }

  await executar(env, "UPDATE admissoes SET status = 'AGUARDANDO_APROVACAO', cadastro = ?, historico = ?, atualizado_em = ?, lembretes = 0, lembrete_em = NULL WHERE id = ?",
    JSON.stringify(dados), historicoMais(a.historico, c.email, eraCorrecao ? "Cadastro corrigido" : "Cadastro enviado", ""), agora(), a.id);
  await registrarLog(env, c.email, eraCorrecao ? "CADASTRO_CORRIGIDO" : "CADASTRO_ENVIADO", "admissao", a.id, "");

  await emailRH(env, ctx, (eraCorrecao ? "Cadastro corrigido — " : "Cadastro para conferir — ") + dados.nome, "Cadastro aguardando aprovação",
    [`<b>${esc(dados.nome)}</b> ${eraCorrecao ? "corrigiu" : "enviou"} o cadastro de admissão (${a.id}).`,
      eraCorrecao ? "Os itens que você apontou aparecem destacados, com o valor anterior e o novo." : "Revise todos os campos e documentos antes de aprovar (RHC-PROC-2026-003, item 4.5)."],
    "admissao/" + a.id);

  if (config.link_onboarding && !eraCorrecao) {
    ctx.waitUntil(enviarEmail(env, {
      para: dados.email_pessoal,
      assunto: "Cadastro recebido — próximos passos na Innomaker",
      html: layout({
        titulo: "Cadastro recebido",
        paragrafos: [`Olá, <b>${esc(dados.nome.split(" ")[0])}</b>! Recebemos seu cadastro e seus documentos. O RH vai conferir tudo.`,
          "Enquanto isso, você já pode agendar seu onboarding:"],
        botao: { texto: "Agendar onboarding", url: config.link_onboarding }
      }),
      texto: textoSimples("Cadastro recebido", ["Agende seu onboarding:"], config.link_onboarding)
    }));
  }
  return { ok: true, status: "AGUARDANDO_APROVACAO" };
}

