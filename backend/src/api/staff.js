// =====================================================================
//  Painel interno (login pelo Authelia)
//  POST /api/staff/<acao>   — permissões em src/lib/papeis.js
// =====================================================================
import {
  ErroApi, json, agora, hojeISO, dataBR, somarAnos, emailValido, texto, parseJson, ehDataISO, esc
} from "../lib/http.js";
import { um, todos, executar, prep, novoId, registrarLog, lerConfig, historicoMais, quemE } from "../lib/db.js";
import { enviarEmail, layout, textoSimples, anexoIcs, smtpConfigurado } from "../lib/email.js";
import { estadoDasEtapas } from "../lib/etapas.js";
import { icsEvento, somarMinutos } from "../lib/agenda.js";
import { acoesDoPapel } from "../lib/papeis.js";
import { cfg, caminhoVaga, CAMINHO_AREA } from "../lib/config.js";
import {
  agendaListar, agendaSalvar, agendaEncerrar, agendaConvidar, agendaCancelarReserva, agendaParticipante, liberarReservasDaCandidatura
} from "./agendamento.js";
import { excluirCandidato, prazosLgpd, candidatosVencidos } from "../lib/lgpd.js";
import { ORIGENS } from "./candidato.js";
import {
  CAMPOS_PROPOSTA, CAMPOS_DATA_PROPOSTA, CAMPOS_CADASTRO, ehEtapaProposta, etapaAgendavel, lerHorariosInicio, ADM_ENCERRADAS, ADM_ANTES_DA_APROVACAO, ADM_CANDIDATO_PREENCHE, PASSOS_MANUAIS,
  trilha, documentosExigidos, documentosFaltando, listaDocumentos, nomeCategoria, categoriaValida
} from "../lib/admissao.js";

const STATUS_VAGA = ["Aberta", "Pausada", "Fechada", "Concluída"];
const TIPOS_LISTA = ["etapa", "tipo_contratacao", "tipo_vaga", "horario", "situacao", "auxilio", "cargo", "funcao", "setor", "grau_instrucao"];

const linkPainel = (env, hash) => cfg(env).siteUrl + "/painel#" + hash;
const linkArea = env => cfg(env).siteUrl + CAMINHO_AREA;
const linkVaga = (env, id, titulo) => cfg(env).siteUrl + caminhoVaga(id, titulo);

export async function apiStaff(env, ctx, acao, b, u) {
  const fn = HANDLERS[acao];
  if (!fn) return json({ ok: false, erro: "Ação desconhecida." }, 404);
  try {
    return json(await fn(env, ctx, b || {}, u));
  } catch (e) {
    if (e instanceof ErroApi) return json({ ok: false, erro: e.message }, e.status === 403 ? 403 : 200);
    console.log("apiStaff", acao, e && e.stack);
    return json({ ok: false, erro: "Erro interno: " + (e && e.message ? e.message : e) }, 500);
  }
}

function notificar(env, ctx, para, assunto, titulo, paragrafos, botao, extra) {
  if (!para || (Array.isArray(para) && !para.filter(Boolean).length)) return;
  ctx.waitUntil(enviarEmail(env, Object.assign({
    para, assunto,
    html: layout({ titulo, paragrafos, botao }),
    texto: textoSimples(titulo, paragrafos, botao && botao.url)
  }, extra || {})));
}

const obrigatorio = (v, nome) => { if (!String(v == null ? "" : v).trim()) throw new ErroApi("Preencha: " + nome + "."); };

// =====================================================================
//  Geral
// =====================================================================
async function me(env, ctx, b, u) {
  const config = await lerConfig(env);
  return { ok: true, usuario: u, acoes: acoesDoPapel(u.papel), links: config.links_colaborador };
}

async function opcoes(env) {
  const listas = {};
  (await todos(env, "SELECT tipo, valor FROM listas ORDER BY tipo, ordem, valor")).forEach(l => {
    (listas[l.tipo] = listas[l.tipo] || []).push(l.valor);
  });
  const departamentos = await todos(env, "SELECT nome, gestor_nome, gestor_email FROM departamentos WHERE ativo = 1 ORDER BY nome");
  return { ok: true, listas, departamentos };
}

async function vagasAbertas(env, ctx, b, u) {
  const ind = u && u.nome ? "?origem=indicacao&ind=" + encodeURIComponent(u.nome) : "";
  const linhas = await todos(env,
    `SELECT id, titulo, localidade, tipo_contratacao, carga_horaria, remuneracao, data_limite FROM vagas
      WHERE status = 'Aberta' AND (data_limite IS NULL OR data_limite = '' OR data_limite >= ?) ORDER BY data_limite`, hojeISO());
  return { ok: true, vagas: linhas.map(v => Object.assign(v, { link: linkVaga(env, v.id, v.titulo) + ind, prazo: dataBR(v.data_limite) })) };
}

// =====================================================================
//  Solicitações de contratação (RHC-PROC-2026-002)
// =====================================================================
const CAMPOS_SOLIC = {
  departamento: [120, "Departamento"], titulo: [150, "Título do cargo"], quantidade: [4, "Quantidade de vagas"],
  data_limite: [10, "Data limite de inscrição"], localidade: [120, "Localidade"], tipo_vaga: [60, "Tipo de vaga"],
  tipo_contratacao: [60, "Tipo de contratação"], carga_horaria: [80, "Carga horária"], remuneracao: [150, "Remuneração / bolsa"],
  descricao: [5000, "Descrição"], habilidades_obrigatorias: [3000, "Habilidades obrigatórias"],
  habilidades_diferenciais: [3000], principais_funcoes: [3000, "Principais funções"], competencias: [2000],
  motivo: [120, "Motivo da solicitação"], urgencia: [20], gestor_responsavel: [150, "Gestor responsável"], observacoes: [3000]
};

function lerSolicitacao(d) {
  const s = {};
  Object.keys(CAMPOS_SOLIC).forEach(k => {
    const [max, nome] = CAMPOS_SOLIC[k];
    s[k] = texto(d[k], max);
    if (nome) obrigatorio(s[k], nome);
  });
  s.quantidade = parseInt(s.quantidade, 10);
  if (!(s.quantidade >= 1)) throw new ErroApi("Quantidade de vagas inválida.");
  if (!ehDataISO(s.data_limite)) throw new ErroApi("Data limite inválida.");
  if (s.data_limite < hojeISO()) throw new ErroApi("A data limite de inscrição já passou.");
  return s;
}

async function solicCriar(env, ctx, b, u) {
  if (!emailValido(u.email)) throw new ErroApi("Sua conta no Authelia não tem e-mail. Peça ao RH para cadastrar, pois as respostas chegam por e-mail.");
  if (b.concordancia !== true) throw new ErroApi("Confirme a declaração de concordância.");
  const s = lerSolicitacao(b);
  const id = await novoId(env, "SOL", 6);
  const t = agora();
  const cols = Object.keys(s);
  await executar(env,
    `INSERT INTO solicitacoes (id, ${cols.join(", ")}, solicitante_login, solicitante_nome, solicitante_email, historico, criado_em, atualizado_em)
     VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?, ?, ?, ?, ?)`,
    id, ...cols.map(k => s[k]), u.login, u.nome, u.email.toLowerCase(), historicoMais("[]", quemE(u), "Solicitação criada", ""), t, t);
  await registrarLog(env, quemE(u), "SOLICITACAO_CRIADA", "solicitacao", id, s.titulo);

  const config = await lerConfig(env);
  notificar(env, ctx, config.email_rh, `Nova solicitação de contratação — ${s.titulo} (${id})`, "Nova solicitação de contratação",
    [`<b>${u.nome}</b> (${s.departamento}) solicitou <b>${s.quantidade}</b> vaga(s) de <b>${s.titulo}</b>.`,
      `Urgência: ${s.urgencia || "não informada"}. Motivo: ${s.motivo}.`],
    { texto: "Analisar no painel", url: linkPainel(env, "solicitacao/" + id) });
  return { ok: true, id };
}

async function solicEditar(env, ctx, b, u) {
  const atual = await um(env, "SELECT * FROM solicitacoes WHERE id = ?", texto(b.id, 30));
  if (!atual) throw new ErroApi("Solicitação não encontrada.");
  const dono = atual.solicitante_email === String(u.email || "").toLowerCase();
  if (!dono) throw new ErroApi("Só quem fez a solicitação pode corrigi-la.", 403);
  // Depois de enviada, a solicitação só pode ser alterada se o RH recusar com alteração
  if (atual.status !== "REAJUSTE") {
    throw new ErroApi(atual.status === "PENDENTE"
      ? "A solicitação já foi enviada ao RH e não pode ser alterada. Ela só volta para correção se o RH recusar com alteração."
      : "Esta solicitação não pode mais ser alterada.");
  }

  const s = lerSolicitacao(b);
  const cols = Object.keys(s);
  await executar(env,
    `UPDATE solicitacoes SET ${cols.map(k => k + " = ?").join(", ")}, status = 'PENDENTE', historico = ?, atualizado_em = ? WHERE id = ?`,
    ...cols.map(k => s[k]), historicoMais(atual.historico, quemE(u), "Corrigida e reenviada", ""), agora(), atual.id);
  await registrarLog(env, quemE(u), "SOLICITACAO_EDITADA", "solicitacao", atual.id, "");

  const config = await lerConfig(env);
  notificar(env, ctx, config.email_rh, `Solicitação corrigida e reenviada — ${s.titulo} (${atual.id})`, "Solicitação reenviada",
    [`<b>${u.nome}</b> corrigiu a solicitação <b>${atual.id}</b> (${s.titulo}) e reenviou para análise.`],
    { texto: "Analisar no painel", url: linkPainel(env, "solicitacao/" + atual.id) });
  return { ok: true, id: atual.id };
}

function solicPublica(s) {
  return Object.assign({}, s, { historico: parseJson(s.historico, []) });
}

async function solicMinhas(env, ctx, b, u) {
  const linhas = await todos(env, "SELECT * FROM solicitacoes WHERE solicitante_email = ? ORDER BY criado_em DESC", String(u.email || "").toLowerCase());
  return { ok: true, itens: linhas.map(solicPublica) };
}

async function solicListar(env) {
  return { ok: true, itens: (await todos(env, "SELECT * FROM solicitacoes ORDER BY criado_em DESC")).map(solicPublica) };
}

async function solicDecidir(env, ctx, b, u) {
  const s = await um(env, "SELECT * FROM solicitacoes WHERE id = ?", texto(b.id, 30));
  if (!s) throw new ErroApi("Solicitação não encontrada.");
  if (s.status === "REAJUSTE") throw new ErroApi("Esta solicitação foi recusada com alteração e está com o gestor para correção.");
  if (s.status !== "PENDENTE") throw new ErroApi("Esta solicitação já foi decidida.");
  const decisao = b.decisao;
  const comentario = texto(b.comentario, 3000);
  const novo = { aprovar: "APROVADA", reajuste: "REAJUSTE", recusar: "RECUSADA" }[decisao];
  if (!novo) throw new ErroApi("Decisão inválida.");
  if (decisao !== "aprovar" && comentario.length < 5) {
    throw new ErroApi(decisao === "reajuste" ? "Escreva o que o gestor precisa alterar." : "Escreva o motivo da recusa para o gestor.");
  }

  const rotulo = { aprovar: "Aprovada pelo RH", reajuste: "Recusada com alteração", recusar: "Recusada pelo RH" }[decisao];
  await executar(env, "UPDATE solicitacoes SET status = ?, decidido_por = ?, decidido_em = ?, historico = ?, atualizado_em = ? WHERE id = ?",
    novo, quemE(u), agora(), historicoMais(s.historico, quemE(u), rotulo, comentario), agora(), s.id);
  await registrarLog(env, quemE(u), "SOLICITACAO_" + novo, "solicitacao", s.id, comentario);

  const textos = {
    aprovar: ["Sua solicitação foi <b>aprovada</b>. O RH vai criar e publicar a vaga."],
    reajuste: ["O RH <b>recusou com alteração</b> a sua solicitação. Para ela ser analisada de novo, altere o seguinte:", comentario.replace(/\n/g, "<br>"), "Abra a solicitação no painel, corrija e reenvie. Só neste caso a solicitação pode ser alterada."],
    recusar: ["Sua solicitação foi <b>recusada</b>.", comentario.replace(/\n/g, "<br>")]
  }[decisao];
  notificar(env, ctx, s.solicitante_email, `${rotulo} — ${s.titulo} (${s.id})`, rotulo,
    [`Olá, ${String(s.solicitante_nome).split(" ")[0]}.`, ...textos].concat(comentario && decisao === "aprovar" ? ["Observação: " + comentario] : []),
    { texto: "Ver no painel", url: linkPainel(env, "minhas") });

  return { ok: true, status: novo };
}

// =====================================================================
//  Vagas (RHC-PROC-2026-001)
// =====================================================================
const CAMPOS_VAGA = {
  titulo: [150, "Título"], data_limite: [10, "Inscrições até"], departamento: [120], gestor_nome: [150], gestor_email: [200],
  localidade: [120, "Localidade"], tipo_vaga: [60], tipo_contratacao: [60, "Tipo de contratação"], carga_horaria: [80, "Carga horária"],
  remuneracao: [150], descricao: [5000, "Descrição"], requisitos: [5000, "Requisitos"], principais_funcoes: [5000, "Principais funções"]
};

const comContagem = `SELECT v.*,
    (SELECT COUNT(*) FROM candidaturas c WHERE c.vaga_id = v.id) AS inscritos,
    (SELECT COUNT(*) FROM candidaturas c WHERE c.vaga_id = v.id AND c.status IN ('Em processo', 'Aprovado', 'Proposta')) AS em_processo,
    (SELECT COUNT(*) FROM candidaturas c WHERE c.vaga_id = v.id AND c.status = 'Contratado') AS contratados
  FROM vagas v`;

function vagaPublica(env, v) {
  const hoje = hojeISO();
  return Object.assign({}, v, {
    etapas: parseJson(v.etapas, ["Triagem"]),
    aberta_site: v.status === "Aberta" && (!v.data_limite || v.data_limite >= hoje),
    link_publico: linkVaga(env, v.id, v.titulo)
  });
}

async function vagasTodas(env) {
  return { ok: true, statusOpcoes: STATUS_VAGA, vagas: (await todos(env, comContagem + " ORDER BY v.criado_em DESC")).map(v => vagaPublica(env, v)) };
}

async function minhasVagas(env, ctx, b, u) {
  const e = String(u.email || "").toLowerCase();
  const linhas = await todos(env, comContagem +
    ` WHERE lower(v.gestor_email) = ? OR v.solicitacao_id IN (SELECT id FROM solicitacoes WHERE solicitante_email = ?) ORDER BY v.criado_em DESC`, e, e);
  return { ok: true, vagas: linhas.map(v => vagaPublica(env, v)) };
}

async function vagaSalvar(env, ctx, b, u) {
  const v = {};
  Object.keys(CAMPOS_VAGA).forEach(k => {
    const [max, nome] = CAMPOS_VAGA[k];
    v[k] = texto(b[k], max);
    if (nome) obrigatorio(v[k], nome);
  });
  if (!ehDataISO(v.data_limite)) throw new ErroApi("Data de inscrições inválida.");
  v.quantidade = Math.max(1, parseInt(b.quantidade, 10) || 1);
  v.status = STATUS_VAGA.indexOf(b.status) >= 0 ? b.status : "Aberta";
  if (v.gestor_email && !emailValido(v.gestor_email)) throw new ErroApi("E-mail do gestor inválido.");
  v.gestor_email = v.gestor_email.toLowerCase();

  if (v.departamento && !v.gestor_email) {
    const d = await um(env, "SELECT gestor_nome, gestor_email FROM departamentos WHERE nome = ?", v.departamento);
    if (d) { v.gestor_nome = v.gestor_nome || d.gestor_nome; v.gestor_email = d.gestor_email; }
  }

  let etapas = (Array.isArray(b.etapas) ? b.etapas : []).map(x => texto(x, 80)).filter(Boolean);
  etapas = ["Triagem"].concat(etapas.filter(x => x.toLowerCase() !== "triagem")).slice(0, 10);
  v.etapas = JSON.stringify(etapas);

  const t = agora();
  const cols = Object.keys(v);

  if (b.id) {
    const atual = await um(env, "SELECT * FROM vagas WHERE id = ?", texto(b.id, 30));
    if (!atual) throw new ErroApi("Vaga não encontrada.");
    await executar(env, `UPDATE vagas SET ${cols.map(k => k + " = ?").join(", ")}, atualizado_em = ? WHERE id = ?`, ...cols.map(k => v[k]), t, atual.id);
    await registrarLog(env, quemE(u), "VAGA_EDITADA", "vaga", atual.id, atual.status !== v.status ? `status: ${atual.status} → ${v.status}` : "");
    return { ok: true, id: atual.id };
  }

  let solic = null;
  if (b.solicitacao_id) {
    solic = await um(env, "SELECT * FROM solicitacoes WHERE id = ?", texto(b.solicitacao_id, 30));
    if (!solic) throw new ErroApi("Solicitação não encontrada.");
    if (solic.status !== "APROVADA") throw new ErroApi("A solicitação precisa estar aprovada para virar vaga.");
  }

  const id = await novoId(env, "VAG", 4);
  const stmts = [prep(env, `INSERT INTO vagas (id, solicitacao_id, ${cols.join(", ")}, criado_por, criado_em, atualizado_em)
                           VALUES (?, ?, ${cols.map(() => "?").join(", ")}, ?, ?, ?)`,
    id, solic ? solic.id : null, ...cols.map(k => v[k]), quemE(u), t, t)];
  if (solic) {
    stmts.push(prep(env, "UPDATE solicitacoes SET status = 'VAGA_CRIADA', vaga_id = ?, historico = ?, atualizado_em = ? WHERE id = ?",
      id, historicoMais(solic.historico, quemE(u), "Vaga criada", id), t, solic.id));
  }
  await env.DB.batch(stmts);
  await registrarLog(env, quemE(u), "VAGA_CRIADA", "vaga", id, v.titulo);

  const avisar = [solic && solic.solicitante_email, v.gestor_email].filter(Boolean);
  notificar(env, ctx, [...new Set(avisar)], `Vaga publicada — ${v.titulo} (${id})`, "Vaga publicada",
    [`A vaga <b>${v.titulo}</b> foi publicada no site de vagas, com inscrições até <b>${dataBR(v.data_limite)}</b>.`,
      "Você acompanha os candidatos no painel interno."],
    { texto: "Ver a vaga no site", url: linkVaga(env, id, v.titulo) });

  return { ok: true, id };
}

async function podeVerVaga(env, u, vaga) {
  if (u.papel === "rh") return true;
  const e = String(u.email || "").toLowerCase();
  if (e && String(vaga.gestor_email || "").toLowerCase() === e) return true;
  if (vaga.solicitacao_id) {
    const s = await um(env, "SELECT solicitante_email FROM solicitacoes WHERE id = ?", vaga.solicitacao_id);
    if (s && s.solicitante_email === e) return true;
  }
  return false;
}

async function vagaDetalhe(env, ctx, b, u) {
  const vaga = await um(env, comContagem + " WHERE v.id = ?", texto(b.id, 30));
  if (!vaga) throw new ErroApi("Vaga não encontrada.");
  if (!(await podeVerVaga(env, u, vaga))) throw new ErroApi("Esta vaga não é da sua área.", 403);

  const cands = await todos(env,
    `SELECT ca.*, c.nome, c.email, c.telefone, c.banco_talentos, c.talento_marcado, c.talento_nota, c.talento_tags,
            (SELECT a.id FROM admissoes a WHERE a.candidatura_id = ca.id ORDER BY a.criado_em DESC LIMIT 1) AS admissao_id,
            (SELECT a.status FROM admissoes a WHERE a.candidatura_id = ca.id ORDER BY a.criado_em DESC LIMIT 1) AS admissao_status
       FROM candidaturas ca JOIN candidatos c ON c.id = ca.candidato_id
      WHERE ca.vaga_id = ? ORDER BY ca.criado_em DESC`, vaga.id);
  const ets = await todos(env,
    "SELECT e.* FROM etapas e JOIN candidaturas ca ON ca.id = e.candidatura_id WHERE ca.vaga_id = ? ORDER BY e.ordem", vaga.id);

  const candidatos = cands.map(c => {
    const etapas = ets.filter(e => e.candidatura_id === c.id);
    const est = estadoDasEtapas(etapas);
    return Object.assign(c, { etapas, etapa_atual: est.etapaAtual, status_publico: est.status, origem_nome: ORIGENS[c.origem] || c.origem });
  });

  return { ok: true, vaga: vagaPublica(env, vaga), candidatos, podeEditar: u.papel === "rh" };
}

// ---------- Etapas do processo seletivo ----------
// Avaliação de uma etapa (RHC-PROC-2026-001, 5.4–5.6): estrelas, análise/feedback e decisão.
// Recusado encerra o processo e envia o feedback ao candidato por e-mail (sempre).
async function etapaAtualizar(env, ctx, b, u) {
  const e = await um(env, "SELECT * FROM etapas WHERE id = ?", parseInt(b.etapa_id, 10) || 0);
  if (!e) throw new ErroApi("Etapa não encontrada.");
  const ca = await um(env,
    `SELECT ca.*, c.nome, c.email, v.titulo FROM candidaturas ca
       JOIN candidatos c ON c.id = ca.candidato_id JOIN vagas v ON v.id = ca.vaga_id WHERE ca.id = ?`, e.candidatura_id);
  if (["Proposta", "Contratado", "Desistiu"].indexOf(ca.status) >= 0) {
    throw new ErroApi("Este candidato já está em " + ca.status.toLowerCase() + ": as etapas não podem mais ser alteradas.");
  }

  // Ordem do processo: só avalia a etapa atual (ou corrige uma já avaliada)
  const todas = await todos(env, "SELECT id, ordem, nome, resultado FROM etapas WHERE candidatura_id = ? ORDER BY ordem", ca.id);
  const anteriores = todas.filter(x => x.ordem < e.ordem);
  const pendenteAntes = anteriores.find(x => x.resultado !== "Aprovado");
  if (pendenteAntes) throw new ErroApi(`Avalie antes a etapa "${pendenteAntes.nome}".`);
  const recusadaDepois = todas.find(x => x.ordem > e.ordem && x.resultado === "Reprovado");
  if (recusadaDepois && b.resultado === "Reprovado") throw new ErroApi("O candidato já foi recusado em outra etapa.");

  const resultado = ["Aprovado", "Reprovado", "Pendente"].indexOf(b.resultado) >= 0 ? b.resultado : "";
  if (!resultado) throw new ErroApi("Escolha Aprovado ou Recusado.");
  const nota = parseInt(b.nota, 10);
  if (resultado !== "Pendente" && !(nota >= 1 && nota <= 3)) throw new ErroApi("Dê a nota da etapa (1 a 3 estrelas).");
  const analise = texto(b.analise != null ? b.analise : b.motivo, 3000);
  if (resultado !== "Pendente" && analise.length < 5) {
    throw new ErroApi(resultado === "Reprovado" ? "Escreva o feedback: ele será enviado ao candidato." : "Escreva a análise da etapa.");
  }
  for (const k of ["data_prevista", "data_realizada"]) {
    if (b[k] && !ehDataISO(b[k])) throw new ErroApi("Data inválida.");
  }
  // Triagem não tem data prevista (é a análise do currículo)
  const dataPrevista = e.ordem === 1 || /triagem/i.test(e.nome) ? "" : texto(b.data_prevista, 10);
  const dataRealizada = resultado === "Pendente" ? texto(b.data_realizada, 10) : (texto(b.data_realizada, 10) || hojeISO());

  await executar(env,
    `UPDATE etapas SET resultado = ?, nota = ?, motivo = ?, mensagem = '', responsavel = ?, data_prevista = ?, data_realizada = ?, obs = ?, avaliado_em = ?
      WHERE id = ?`,
    resultado, resultado === "Pendente" ? 0 : nota, analise, texto(b.responsavel, 150) || u.nome || "", dataPrevista, dataRealizada,
    texto(b.obs, 2000), resultado === "Pendente" ? null : agora(), e.id);

  const depois = await todos(env, "SELECT resultado FROM etapas WHERE candidatura_id = ?", ca.id);
  const novoStatus = depois.some(x => x.resultado === "Reprovado") ? "Encerrado"
    : depois.every(x => x.resultado === "Aprovado") ? "Aprovado" : "Em processo";
  if (novoStatus !== ca.status) await executar(env, "UPDATE candidaturas SET status = ?, atualizado_em = ? WHERE id = ?", novoStatus, agora(), ca.id);
  if (novoStatus === "Encerrado") await liberarReservasDaCandidatura(env, ctx, ca.id, "o candidato não segue no processo");
  await registrarLog(env, quemE(u), "ETAPA_" + resultado.toUpperCase(), "candidatura", ca.id, e.nome + (nota ? " — " + nota + " estrela(s)" : ""));

  // E-mail: recusa sempre (com o feedback); aprovação se o RH marcar "avisar o candidato"
  const primeiro = String(ca.nome).split(" ")[0];
  const proxima = todas.find(x => x.ordem > e.ordem);
  let emailEnviado = false;
  if (resultado === "Reprovado" && e.resultado !== "Reprovado") {
    notificar(env, ctx, ca.email, "Retorno do processo seletivo — " + ca.titulo, "Retorno sobre sua candidatura",
      [`Olá, <b>${primeiro}</b>.`,
        `Agradecemos sua participação no processo seletivo para <b>${ca.titulo}</b>. Neste momento, sua candidatura não seguirá para as próximas etapas.`,
        "<b>Retorno sobre a etapa " + esc(e.nome) + ":</b><br>" + esc(analise).replace(/\n/g, "<br>"),
        "Desejamos sucesso e esperamos ver você em outras oportunidades da Innomaker."],
      { texto: "Ver minha candidatura", url: linkArea(env) });
    emailEnviado = true;
  } else if (resultado === "Aprovado" && b.avisar_candidato === true && e.resultado !== "Aprovado") {
    notificar(env, ctx, ca.email, "Atualização do processo seletivo — " + ca.titulo, "Você avançou no processo seletivo",
      [`Olá, <b>${primeiro}</b>!`,
        `Você foi aprovado(a) na etapa <b>${e.nome}</b> do processo seletivo para <b>${ca.titulo}</b>.`,
        proxima ? `Próxima etapa: <b>${proxima.nome}</b>. Em breve entraremos em contato com os detalhes.` : "Você concluiu todas as etapas. Em breve entraremos em contato com os próximos passos."],
      { texto: "Ver minha candidatura", url: linkArea(env) });
    emailEnviado = true;
  }
  if (emailEnviado) await executar(env, "UPDATE etapas SET notificado_em = ? WHERE id = ?", agora(), e.id);
  return { ok: true, status: novoStatus, emailEnviado };
}

async function candidaturaStatus(env, ctx, b, u) {
  const status = ["Em processo", "Aprovado", "Encerrado", "Desistiu"].indexOf(b.status) >= 0 ? b.status : "";
  if (!status) throw new ErroApi("Situação inválida.");
  const r = await executar(env, "UPDATE candidaturas SET status = ?, obs = ?, atualizado_em = ? WHERE id = ?",
    status, texto(b.obs, 2000), agora(), texto(b.id, 30));
  if (!r.meta || !r.meta.changes) throw new ErroApi("Candidatura não encontrada.");
  if (status === "Desistiu" || status === "Encerrado") await liberarReservasDaCandidatura(env, ctx, texto(b.id, 30), "o candidato saiu do processo seletivo");
  await registrarLog(env, quemE(u), "CANDIDATURA_STATUS", "candidatura", b.id, status);
  return { ok: true };
}

// =====================================================================
//  Admissão (RHC-PROC-2026-003)
// =====================================================================

// ---------- Proposta: ler, comparar, prazo ----------
function lerProposta(src, base) {
  const p = Object.assign({}, base || {});
  Object.keys(CAMPOS_PROPOSTA).forEach(k => {
    if (src[k] === undefined && base) return;
    const [max, rotulo, obrig] = CAMPOS_PROPOSTA[k];
    p[k] = texto(src[k], max);
    if (obrig) obrigatorio(p[k], rotulo);
  });
  CAMPOS_DATA_PROPOSTA.forEach(k => { if (p[k] && !ehDataISO(p[k])) throw new ErroApi("Data inválida em " + CAMPOS_PROPOSTA[k][1] + "."); });
  if (p.data_final_bolsa && p.data_inicio && p.data_final_bolsa < p.data_inicio) throw new ErroApi("O fim da bolsa / contrato não pode ser antes do início.");
  if (p.gestor_email && !emailValido(p.gestor_email)) throw new ErroApi("E-mail do gestor inválido.");
  return p;
}

function lerPrazo(v) {
  const prazo = texto(v, 10) || hojeISO(5);
  if (!ehDataISO(prazo)) throw new ErroApi("Prazo para responder inválido.");
  if (prazo < hojeISO()) throw new ErroApi("O prazo para responder não pode ser no passado.");
  return prazo;
}

const valorProposta = (k, v) => CAMPOS_DATA_PROPOSTA.indexOf(k) >= 0 ? dataBR(v) : v;
// [{ campo, rotulo, antes, depois, visivel }]
function diferencas(antes, depois) {
  return Object.keys(CAMPOS_PROPOSTA).filter(k => String(antes[k] || "") !== String(depois[k] || "")).map(k => ({
    campo: k, rotulo: CAMPOS_PROPOSTA[k][1], visivel: CAMPOS_PROPOSTA[k][3],
    antes: valorProposta(k, antes[k] || "") || "(vazio)", depois: valorProposta(k, depois[k] || "") || "(vazio)"
  }));
}

// RH edita a proposta antes da aprovação. Se o candidato já tinha aceitado e mudou algo que ele vê, ele precisa aceitar de novo
// (o cadastro já preenchido é mantido). Proposta vencida volta a valer com o novo prazo.
async function admPropostaSalvar(env, ctx, b, u) {
  const a = await um(env, SELECT_ADM + " WHERE a.id = ?", texto(b.id, 30));
  if (!a) throw new ErroApi("Admissão não encontrada.");
  if (ADM_ANTES_DA_APROVACAO.concat(["PROPOSTA_EXPIRADA"]).indexOf(a.status) < 0) throw new ErroApi("Esta proposta não pode mais ser alterada (" + a.status + ").");
  const antes = parseJson(a.proposta, {});
  const p = lerProposta(b.proposta || {}, antes);
  p.gestor_email = (p.gestor_email || "").toLowerCase();
  p.horarios_inicio = lerHorariosInicio(p.horarios_inicio).join(", ");
  if (!p.horarios_inicio) throw new ErroApi("Informe pelo menos um horário de início para o candidato escolher.");
  if (p.data_inicio !== antes.data_inicio || lerHorariosInicio(p.horarios_inicio).indexOf(antes.hora_inicio) < 0) p.hora_inicio = "";
  const email = texto(b.email_contato || a.email_contato, 200).toLowerCase();
  if (!emailValido(email)) throw new ErroApi("E-mail pessoal do candidato inválido.");
  if (/@id\.uff\.br$/i.test(email)) throw new ErroApi("Não é permitido usar e-mail @id.uff.br. Use o e-mail pessoal.");
  const difs = diferencas(antes, p);
  const visiveis = difs.filter(d => d.visivel);
  const reabre = a.status === "PROPOSTA_EXPIRADA";
  const precisaAceitar = reabre || a.status === "PROPOSTA_ENVIADA" || visiveis.length > 0;
  const prazo = precisaAceitar ? lerPrazo(b.prazo_resposta || a.prazo_resposta) : a.prazo_resposta;
  const mudouPrazo = prazo !== a.prazo_resposta;
  const mudouEmail = email !== a.email_contato;
  if (!difs.length && !mudouPrazo && !mudouEmail) throw new ErroApi("Nada mudou na proposta.");

  const novoStatus = precisaAceitar ? "PROPOSTA_ENVIADA" : a.status;
  // O histórico da admissão é visto pelo candidato: só o que ele vê; os campos internos ficam no Histórico (log) do painel
  const resumoVisivel = visiveis.map(d => `${d.rotulo}: ${d.antes} → ${d.depois}`).concat(mudouPrazo ? ["Prazo para responder: " + dataBR(prazo)] : [])
    .concat(mudouEmail ? ["E-mail: " + a.email_contato + " → " + email] : []).join("; ");
  const internos = difs.filter(d => !d.visivel);
  const resumo = [resumoVisivel, internos.map(d => `${d.rotulo}: ${d.antes} → ${d.depois}`).join("; ")].filter(Boolean).join("; ");
  const acaoHist = reabre ? "Proposta reaberta" : resumoVisivel ? "Proposta alterada" : "Proposta ajustada (interno)";
  await env.DB.batch([
    prep(env, `UPDATE admissoes SET proposta = ?, prazo_resposta = ?, email_contato = ?, status = ?, historico = ?, atualizado_em = ?, lembretes = 0, lembrete_em = NULL WHERE id = ?`,
      JSON.stringify(p), prazo, email, novoStatus,
      historicoMais(a.historico, quemE(u), acaoHist, resumoVisivel || internos.map(d => d.rotulo).join(", ")), agora(), a.id),
    prep(env, "UPDATE candidaturas SET status = 'Proposta', atualizado_em = ? WHERE id = ?", agora(), a.candidatura_id)
  ]);
  await registrarLog(env, quemE(u), reabre ? "PROPOSTA_REABERTA" : "PROPOSTA_ALTERADA", "admissao", a.id, resumo);

  if (visiveis.length || reabre || mudouEmail || (mudouPrazo && novoStatus === "PROPOSTA_ENVIADA")) {
    const jaAceitou = ADM_CANDIDATO_PREENCHE.concat(["AGUARDANDO_APROVACAO"]).indexOf(a.status) >= 0;
    notificar(env, ctx, email, "Sua proposta foi atualizada — " + a.titulo_vaga, reabre ? "Sua proposta foi reaberta" : "Sua proposta foi atualizada",
      [`Olá, <b>${esc(String(a.candidato_nome).split(" ")[0])}</b>.`,
        visiveis.length ? "O RH alterou a proposta para <b>" + esc(a.titulo_vaga) + "</b>:<br>" + visiveis.map(d => `• <b>${esc(d.rotulo)}:</b> ${esc(d.antes)} → <b>${esc(d.depois)}</b>`).join("<br>") : "",
        jaAceitou ? "Como as condições mudaram, confirme de novo na Área do candidato. O cadastro que você já preencheu foi mantido." : "",
        `Responda até <b>${dataBR(prazo)}</b>.`].filter(Boolean),
      { texto: "Ver proposta", url: linkArea(env) });
  }
  return { ok: true, status: novoStatus, mudancas: difs.length, precisaAceitar };
}

// Cancela a admissão antes da aprovação (ex.: vaga suspensa, candidato errado). O candidato volta a "Aprovado no processo".
async function admCancelar(env, ctx, b, u) {
  const a = await um(env, SELECT_ADM + " WHERE a.id = ?", texto(b.id, 30));
  if (!a) throw new ErroApi("Admissão não encontrada.");
  if (ADM_ANTES_DA_APROVACAO.concat(["PROPOSTA_EXPIRADA"]).indexOf(a.status) < 0) throw new ErroApi("Só é possível cancelar antes da aprovação do cadastro.");
  const motivo = texto(b.motivo, 2000);
  if (motivo.length < 5) throw new ErroApi("Escreva o motivo do cancelamento.");
  await env.DB.batch([
    prep(env, "UPDATE admissoes SET status = 'CANCELADA', historico = ?, atualizado_em = ? WHERE id = ?",
      historicoMais(a.historico, quemE(u), "Cancelada pelo RH", motivo), agora(), a.id),
    prep(env, "UPDATE candidaturas SET status = 'Aprovado', atualizado_em = ? WHERE id = ? AND status = 'Proposta'", agora(), a.candidatura_id)
  ]);
  await registrarLog(env, quemE(u), "ADMISSAO_CANCELADA", "admissao", a.id, motivo);
  if (b.avisar !== false) {
    notificar(env, ctx, a.email_contato, "Atualização da sua proposta — Innomaker", "Sua proposta foi cancelada",
      [`Olá, <b>${esc(String(a.candidato_nome).split(" ")[0])}</b>.`, `A proposta para <b>${esc(a.titulo_vaga)}</b> foi cancelada pelo RH.`,
        "<b>Motivo:</b><br>" + esc(motivo).replace(/\n/g, "<br>"), "Se tiver dúvidas, responda este e-mail."],
      { texto: "Abrir Área do candidato", url: linkArea(env) });
  }
  return { ok: true };
}

// ---------- Trilha pós-aprovação ----------
async function contextoTrilha(env, a) {
  const f = a.funcionario_id ? await um(env, "SELECT * FROM funcionarios WHERE matricula = ?", a.funcionario_id) : null;
  return { f, docs: null };
}

// Marca/desmarca um passo manual (conferência, ponto, acessos, onboarding). Grava no funcionário e a data na admissão.
async function admPasso(env, ctx, b, u) {
  const a = await um(env, "SELECT * FROM admissoes WHERE id = ?", texto(b.id, 30));
  if (!a) throw new ErroApi("Admissão não encontrada.");
  const coluna = PASSOS_MANUAIS[b.passo];
  if (!coluna) throw new ErroApi("Passo inválido.");
  if (a.status !== "APROVADA" || !a.funcionario_id) throw new ErroApi("Este passo vem depois da aprovação do cadastro.");
  const feito = b.feito !== false;
  await marcarPasso(env, a, b.passo, feito, u);
  await executar(env, `UPDATE funcionarios SET ${coluna} = ?, atualizado_em = ? WHERE matricula = ?`, feito ? 1 : 0, agora(), a.funcionario_id);
  await registrarLog(env, quemE(u), feito ? "ADMISSAO_PASSO" : "ADMISSAO_PASSO_DESFEITO", "admissao", a.id, b.passo);
  const atual = await um(env, "SELECT * FROM admissoes WHERE id = ?", a.id);
  const x = await contextoTrilha(env, atual);
  return { ok: true, trilha: trilha(atual, x.f, x.docs) };
}

async function marcarPasso(env, a, passo, feito, u) {
  const chk = parseJson(a.checklist, {});
  if (feito) chk[passo] = { em: agora(), por: u.nome || u.login || "" }; else delete chk[passo];
  await executar(env, "UPDATE admissoes SET checklist = ? WHERE id = ?", JSON.stringify(chk), a.id);
}

// Pede a criação de e-mail e acessos para quem cuida disso (Configurações → Admissão)
async function admPedirAcessos(env, ctx, b, u) {
  const a = await um(env, SELECT_ADM + " WHERE a.id = ?", texto(b.id, 30));
  if (!a || a.status !== "APROVADA" || !a.funcionario_id) throw new ErroApi("Peça os acessos depois de aprovar o cadastro.");
  const config = await lerConfig(env);
  const para = texto(b.para || config.email_acessos, 200).toLowerCase();
  if (!emailValido(para)) throw new ErroApi("Informe o e-mail de quem cria os acessos (ou cadastre em Configurações → Admissão).");
  const f = await um(env, "SELECT * FROM funcionarios WHERE matricula = ?", a.funcionario_id);
  const obs = texto(b.observacao, 2000);
  const linhas = [`<b>Nome:</b> ${esc(f.nome)}`, `<b>Matrícula:</b> ${f.matricula}`, `<b>Cargo / função:</b> ${esc([f.cargo, f.funcao].filter(Boolean).join(" — "))}`,
    `<b>Departamento:</b> ${esc([f.departamento, f.setor].filter(Boolean).join(" / "))}`, `<b>Início:</b> ${dataBR(f.data_efetivacao)}`,
    `<b>E-mail pessoal:</b> ${esc(f.email)}`, f.email_innomaker ? `<b>E-mail Innomaker informado:</b> ${esc(f.email_innomaker)}` : ""].filter(Boolean);
  notificar(env, ctx, para, `Novo colaborador: criar acessos — ${f.nome} (início ${dataBR(f.data_efetivacao)})`, "Criar acessos do novo colaborador",
    [`${esc(u.nome || "O RH")} pediu a criação do e-mail Innomaker e dos acessos aos sistemas para:`, linhas.join("<br>"),
      obs ? "<b>Observação:</b><br>" + esc(obs).replace(/\n/g, "<br>") : "", "Quando terminar, avise o RH para marcar \"Acessos criados\" na admissão."].filter(Boolean),
    { texto: "Ver admissão no painel", url: linkPainel(env, "admissao/" + a.id) }, { responderPara: u.email || "" });
  const chk = parseJson(a.checklist, {});
  chk.acessos_pedido = { em: agora(), por: u.nome || u.login || "", para };
  await executar(env, "UPDATE admissoes SET checklist = ? WHERE id = ?", JSON.stringify(chk), a.id);
  await registrarLog(env, quemE(u), "ACESSOS_PEDIDOS", "admissao", a.id, para);
  return { ok: true, para };
}

// Gestor: admissões das vagas da área dele (sem dados pessoais)
async function admArea(env, ctx, b, u) {
  const linhas = await todos(env, SELECT_ADM + " ORDER BY a.atualizado_em DESC");
  const itens = [];
  for (const a of linhas) {
    const vaga = await um(env, "SELECT id, gestor_email, solicitacao_id FROM vagas WHERE id = ?", a.vaga_id);
    if (!vaga || !(await podeVerVaga(env, u, vaga))) continue;
    const p = parseJson(a.proposta, {});
    const x = await contextoTrilha(env, a);
    itens.push({ id: a.id, status: a.status, candidato_nome: a.candidato_nome, titulo_vaga: a.titulo_vaga, vaga_id: a.vaga_id,
      funcao: p.funcao, data_inicio: p.data_inicio, prazo_resposta: a.prazo_resposta, atualizado_em: a.atualizado_em, trilha: trilha(a, x.f, x.docs) });
  }
  return { ok: true, itens };
}

// Configurações → Admissão: quem cria os acessos e os documentos exigidos por tipo de contrato
async function cfgSalvarAdmissao(env, ctx, b, u) {
  const email = texto(b.email_acessos, 200).toLowerCase();
  if (email && !emailValido(email)) throw new ErroApi("E-mail de quem cria os acessos inválido.");
  const vistos = new Set();
  const docs = (Array.isArray(b.documentos) ? b.documentos : []).slice(0, 30).map((d, i) => {
    const nome = texto(d.nome, 120);
    let id = /^doc_[a-z0-9_]{1,30}$/.test(String(d.id || "")) ? d.id : "doc_extra_" + Date.now().toString(36) + i;
    if (vistos.has(id) || id === "doc_pessoais") id = "doc_extra_" + Date.now().toString(36) + i;
    vistos.add(id);
    const para = (Array.isArray(d.obrigatorio_para) ? d.obrigatorio_para : []).map(t => texto(t, 60)).filter(Boolean).slice(0, 20);
    return { id, nome, obrigatorio_para: para.indexOf("todos") >= 0 ? ["todos"] : para, ativo: d.ativo !== false };
  }).filter(d => d.nome);
  if (!docs.length) throw new ErroApi("Deixe pelo menos um documento na lista.");
  await env.DB.batch([["email_acessos", email], ["admissao_documentos", JSON.stringify(docs)]].map(([k, v]) => prep(env,
    "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor", k, v)));
  await registrarLog(env, quemE(u), "CONFIG_ADMISSAO", "config", "", docs.length + " documento(s)");
  return { ok: true };
}

async function propostaCriar(env, ctx, b, u) {
  const ca = await um(env,
    `SELECT ca.*, c.nome, c.email, v.titulo, v.gestor_nome, v.gestor_email, v.departamento AS vaga_departamento
       FROM candidaturas ca JOIN candidatos c ON c.id = ca.candidato_id JOIN vagas v ON v.id = ca.vaga_id WHERE ca.id = ?`, texto(b.candidatura_id, 30));
  if (!ca) throw new ErroApi("Candidatura não encontrada.");
  if (["Encerrado", "Desistiu", "Contratado"].indexOf(ca.status) >= 0) throw new ErroApi("Esta candidatura está " + ca.status.toLowerCase() + ".");
  const etapasCa = await todos(env, "SELECT * FROM etapas WHERE candidatura_id = ? ORDER BY ordem", ca.id);
  const faltam = etapasCa.filter(x => x.resultado !== "Aprovado" && !ehEtapaProposta(x.nome));
  if (faltam.length) throw new ErroApi("Antes da proposta, conclua a etapa " + faltam[0].nome + ".");
  const ativa = await um(env, `SELECT id FROM admissoes WHERE candidatura_id = ? AND status NOT IN (${ADM_ENCERRADAS.map(() => "?").join(",")})`, ca.id, ...ADM_ENCERRADAS);
  if (ativa) throw new ErroApi("Já existe uma admissão em andamento para este candidato (" + ativa.id + ").");

  const email = texto(b.email_contato || ca.email, 200).toLowerCase();
  if (!emailValido(email)) throw new ErroApi("E-mail pessoal do candidato inválido.");
  if (/@id\.uff\.br$/i.test(email)) throw new ErroApi("Não é permitido enviar proposta para e-mail @id.uff.br. Use o e-mail pessoal.");

  const p = lerProposta(b.proposta || {});
  p.horarios_inicio = lerHorariosInicio(p.horarios_inicio).join(", ");
  if (!p.horarios_inicio) throw new ErroApi("Informe pelo menos um horário de início para o candidato escolher (ex.: 09:00, 10:00).");
  const prazo = lerPrazo(b.prazo_resposta);
  p.gestor_nome = p.gestor_nome || ca.gestor_nome;
  p.gestor_email = (p.gestor_email || ca.gestor_email || "").toLowerCase();

  const id = await novoId(env, "ADM", 6);
  const t = agora();
  await env.DB.batch([
    prep(env, `INSERT INTO admissoes (id, candidatura_id, candidato_id, vaga_id, status, email_contato, proposta, historico, criado_por, criado_em, atualizado_em, prazo_resposta)
               VALUES (?, ?, ?, ?, 'PROPOSTA_ENVIADA', ?, ?, ?, ?, ?, ?, ?)`,
      id, ca.id, ca.candidato_id, ca.vaga_id, email, JSON.stringify(p), historicoMais("[]", quemE(u), "Proposta enviada", "responder até " + dataBR(prazo)), quemE(u), t, t, prazo),
    prep(env, "UPDATE candidaturas SET status = 'Proposta', atualizado_em = ? WHERE id = ?", t, ca.id),
    // a etapa "Proposta" se conclui com o envio (não tem entrevista nem nota)
    prep(env, "UPDATE etapas SET resultado = 'Aprovado', motivo = ?, responsavel = ?, data_realizada = ?, avaliado_em = ? WHERE candidatura_id = ? AND resultado = 'Pendente' AND lower(nome) LIKE '%proposta%'",
      "Proposta enviada (" + id + ")", u.nome || "", hojeISO(), t, ca.id)
  ]);
  await registrarLog(env, quemE(u), "PROPOSTA_ENVIADA", "admissao", id, ca.nome);
  enviarEmailProposta(env, ctx, { nome: ca.nome, email, titulo: ca.titulo, p, prazo });
  return { ok: true, id };
}

// Convite de calendário do primeiro dia (onboarding), no horário que o candidato escolheu
export function conviteInicio(env, a, p, nome, email) {
  if (!p.data_inicio || !p.hora_inicio) return null;
  const ini = p.data_inicio + "T" + p.hora_inicio;
  return { metodo: "REQUEST", ics: icsEvento({ uid: "inicio-" + a.id + "@vagas.innomaker.com.br", metodo: "REQUEST", sequencia: Math.floor(Date.now() / 1000),
    inicio: ini, fim: somarMinutos(ini, 120), titulo: "Primeiro dia (onboarding) · " + nome + " · " + (a.titulo_vaga || p.funcao || ""),
    descricao: ["Primeiro dia na Innomaker: onboarding", "Colaborador: " + nome, p.funcao ? "Função: " + p.funcao : "", p.departamento ? "Departamento: " + p.departamento : "",
      p.local_inicio ? "Local: " + p.local_inicio : ""].filter(Boolean).join("\n"), local: p.local_inicio || "",
    organizador: { nome: env.EMAIL_NOME || "Innomaker Recrutamento", email: String(env.SMTP_FROM || env.SMTP_USER || "rh.innomaker@gmail.com").trim() },
    participantes: [{ nome, email }] }) };
}

function enviarEmailProposta(env, ctx, { nome, email, titulo, p, prazo }) {
  notificar(env, ctx, email, "Proposta — " + titulo, "Você recebeu uma proposta",
    [`Olá, <b>${String(nome).split(" ")[0]}</b>! Parabéns: você concluiu o processo seletivo e recebeu uma proposta para <b>${titulo}</b>.`,
      `<b>Contratação:</b> ${p.tipo_contratacao}<br><b>Função:</b> ${p.funcao}<br><b>Horário:</b> ${p.horario_trabalho}<br>` +
      `<b>Bolsa / remuneração:</b> ${p.bolsa_valor}<br><b>Início:</b> ${dataBR(p.data_inicio)}${p.horarios_inicio ? " — você escolhe o horário: " + p.horarios_inicio : ""}`,
      (prazo ? `Responda até <b>${dataBR(prazo)}</b>. ` : "") + "Para aceitar ou recusar, entre na Área do candidato com seu e-mail e senha. Ao aceitar, você preenche o cadastro e envia os documentos."],
    { texto: "Ver proposta", url: linkArea(env) });
}

const SELECT_ADM = `SELECT a.*, c.nome AS candidato_nome, c.email AS candidato_email, c.telefone AS candidato_telefone,
    v.titulo AS titulo_vaga, v.principais_funcoes
  FROM admissoes a JOIN candidatos c ON c.id = a.candidato_id JOIN vagas v ON v.id = a.vaga_id`;

function admPublica(a) {
  return Object.assign({}, a, {
    proposta: parseJson(a.proposta, {}), cadastro: parseJson(a.cadastro, {}), historico: parseJson(a.historico, [])
  });
}

async function admListar(env) {
  const linhas = await todos(env, SELECT_ADM + " ORDER BY a.atualizado_em DESC");
  const itens = [];
  for (const a of linhas) {
    const x = admPublica(a);
    const t = await contextoTrilha(env, a);
    itens.push({
      id: x.id, status: x.status, candidato_nome: x.candidato_nome, email_contato: x.email_contato, titulo_vaga: x.titulo_vaga,
      data_inicio: x.proposta.data_inicio, funcao: x.proposta.funcao, atualizado_em: x.atualizado_em, funcionario_id: x.funcionario_id,
      prazo_resposta: x.prazo_resposta || "", trilha: trilha(a, t.f, t.docs)
    });
  }
  return { ok: true, hoje: hojeISO(), itens };
}

async function admDetalhe(env, ctx, b) {
  const a = await um(env, SELECT_ADM + " WHERE a.id = ?", texto(b.id, 30));
  if (!a) throw new ErroApi("Admissão não encontrada.");
  const arquivos = await todos(env, "SELECT id, nome, categoria, tamanho, criado_em FROM arquivos WHERE admissao_id = ? ORDER BY categoria, criado_em", a.id);
  if (a.status === "PROPOSTA_ENVIADA" && a.prazo_resposta && a.prazo_resposta < hojeISO()) a.prazo_vencido = true;
  const config = await lerConfig(env);
  const x = admPublica(a);
  const exigidos = documentosExigidos(config, x.proposta.tipo_contratacao);
  const t = await contextoTrilha(env, a);
  return {
    ok: true, admissao: Object.assign(x, { correcoes: parseJson(a.correcoes, {}), checklist: parseJson(a.checklist, {}) }), hoje: hojeISO(),
    arquivos: arquivos.map(f => Object.assign(f, { categoria_nome: nomeCategoria(config, f.categoria) })),
    documentosExigidos: exigidos, documentosFaltando: documentosFaltando(exigidos, arquivos).map(d => d.id),
    camposCadastro: Object.keys(CAMPOS_CADASTRO).map(k => ({ chave: k, rotulo: CAMPOS_CADASTRO[k][2], obrigatorio: CAMPOS_CADASTRO[k][1], etapa: CAMPOS_CADASTRO[k][3] })),
    trilha: trilha(a, t.f, t.docs), emailAcessos: config.email_acessos || ""
  };
}

async function admReenviar(env, ctx, b, u) {
  const a = await um(env, SELECT_ADM + " WHERE a.id = ?", texto(b.id, 30));
  if (!a) throw new ErroApi("Admissão não encontrada.");
  if (["PROPOSTA_ENVIADA", "COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA"].indexOf(a.status) < 0) {
    throw new ErroApi("Não há proposta pendente para reenviar.");
  }
  if (a.status === "PROPOSTA_ENVIADA" && a.prazo_resposta && a.prazo_resposta < hojeISO()) throw new ErroApi("O prazo venceu. Use Editar proposta para dar um novo prazo.");
  enviarEmailProposta(env, ctx, { nome: a.candidato_nome, email: a.email_contato, titulo: a.titulo_vaga, p: parseJson(a.proposta, {}), prazo: a.status === "PROPOSTA_ENVIADA" ? a.prazo_resposta : "" });
  await executar(env, "UPDATE admissoes SET historico = ?, atualizado_em = ? WHERE id = ?", historicoMais(a.historico, quemE(u), "Proposta reenviada", ""), agora(), a.id);
  return { ok: true };
}




async function admDecidir(env, ctx, b, u) {
  const a = await um(env, SELECT_ADM + " WHERE a.id = ?", texto(b.id, 30));
  if (!a) throw new ErroApi("Admissão não encontrada.");
  if (a.status !== "AGUARDANDO_APROVACAO") throw new ErroApi("Só é possível decidir cadastros aguardando aprovação.");
  const textoLivre = texto(b.texto, 3000);
  const primeiro = String(a.candidato_nome).split(" ")[0];

  if (b.decisao === "correcao" || b.decisao === "recusar") {
    const correcao = b.decisao === "correcao";
    // Correção por item: campos e documentos apontados, cada um com o que ajustar
    const cad = parseJson(a.cadastro, {});
    const config = await lerConfig(env);
    const itens = correcao ? (Array.isArray(b.itens) ? b.itens : []).slice(0, 60).map(i => {
      const tipo = i.tipo === "arquivo" ? "arquivo" : "campo";
      const chave = texto(i.chave, 40);
      if (tipo === "campo" && !CAMPOS_CADASTRO[chave]) throw new ErroApi("Campo inválido: " + chave);
      if (tipo === "arquivo" && !categoriaValida(config, chave)) throw new ErroApi("Documento inválido: " + chave);
      const comentario = texto(i.comentario, 500);
      if (comentario.length < 3) throw new ErroApi("Escreva o que ajustar em: " + (tipo === "campo" ? CAMPOS_CADASTRO[chave][2] : nomeCategoria(config, chave)) + ".");
      return { tipo, chave, comentario, rotulo: tipo === "campo" ? CAMPOS_CADASTRO[chave][2] : nomeCategoria(config, chave), valor_antes: tipo === "campo" ? (cad[chave] || "") : "" };
    }) : [];
    if (correcao && !itens.length && textoLivre.length < 5) throw new ErroApi("Marque os itens a corrigir ou descreva o que precisa ser ajustado.");
    if (!correcao && textoLivre.length < 5) throw new ErroApi("Escreva a justificativa.");
    const resumo = correcao ? itens.map(i => i.rotulo + ": " + i.comentario).concat(textoLivre ? [textoLivre] : []).join("; ") : textoLivre;
    const stmts = [prep(env, "UPDATE admissoes SET status = ?, historico = ?, atualizado_em = ?, correcoes = ?, rascunho = CASE WHEN rascunho = '{}' THEN cadastro ELSE rascunho END, lembretes = 0, lembrete_em = NULL WHERE id = ?",
      correcao ? "CORRECAO_SOLICITADA" : "RECUSADA",
      historicoMais(a.historico, quemE(u), correcao ? "Correção solicitada" : "Recusada pelo RH", resumo), agora(),
      correcao ? JSON.stringify({ em: agora(), por: u.nome || u.login || "", texto: textoLivre, itens }) : a.correcoes || "{}", a.id)];
    if (!correcao) stmts.push(prep(env, "UPDATE candidaturas SET status = 'Encerrado', atualizado_em = ? WHERE id = ?", agora(), a.candidatura_id));
    await env.DB.batch(stmts);
    await registrarLog(env, quemE(u), correcao ? "ADMISSAO_CORRECAO" : "ADMISSAO_RECUSADA", "admissao", a.id, resumo);
    notificar(env, ctx, a.email_contato,
      correcao ? "Ajustes no seu cadastro — Innomaker" : "Atualização da sua admissão — Innomaker",
      correcao ? "Precisamos de alguns ajustes no seu cadastro" : "Sua admissão não foi aprovada",
      [`Olá, <b>${esc(primeiro)}</b>.`,
        correcao && itens.length ? "<b>O que precisa ser ajustado:</b><br>" + itens.map(i => `• <b>${esc(i.rotulo)}:</b> ${esc(i.comentario)}`).join("<br>") : "",
        textoLivre ? (correcao ? "<b>Observação do RH:</b><br>" : "<b>Justificativa:</b><br>") + esc(textoLivre).replace(/\n/g, "<br>") : "",
        correcao ? "Entre na Área do candidato: os itens aparecem destacados. Corrija e envie de novo." : "Se tiver dúvidas, responda este e-mail."].filter(Boolean),
      { texto: "Abrir Área do candidato", url: linkArea(env) });
    return { ok: true };
  }

  if (b.decisao !== "aprovar") throw new ErroApi("Decisão inválida.");
  const p = parseJson(a.proposta, {});
  const c = parseJson(a.cadastro, {});
  const t = agora();
  const dados = {};
  ["cpf", "rg", "cnh", "ctps", "sexo", "data_nascimento", "cep", "endereco", "bairro", "cidade", "estado", "banco", "agencia", "conta",
    "tipo_conta", "pix_numero", "pix_banco", "grau_instrucao", "area_formacao", "instituicao_ensino", "cr", "matricula_uff",
    "curriculo_lattes", "nome_emergencia", "telefone_emergencia"].forEach(k => { dados[k] = c[k] || ""; });

  const func = {
    admissao_id: a.id, candidato_id: a.candidato_id, nome: c.nome || a.candidato_nome, email: c.email_pessoal || a.email_contato,
    email_innomaker: c.email_innomaker || "", telefone: c.telefone || a.candidato_telefone || "",
    situacao: p.situacao, cargo: p.cargo, funcao: p.funcao, departamento: p.departamento, setor: p.setor,
    horario_trabalho: p.horario_trabalho, tipo_contratacao: p.tipo_contratacao, bolsa_valor: p.bolsa_valor, auxilio: p.auxilio,
    responsavel: p.responsavel, entidade_vinculada: p.entidade_vinculada, principais_funcoes: a.principais_funcoes || "",
    data_efetivacao: p.data_inicio, data_final_contrato: p.data_final_bolsa || somarAnos(p.data_inicio, 1),
    dados: JSON.stringify(dados)
  };

  // Registro do funcionário (Funcionários): a matrícula é a próxima do sistema
  const cols = Object.keys(func);
  const r = await executar(env, `INSERT INTO funcionarios (${cols.join(", ")}, criado_em, atualizado_em) VALUES (${cols.map(() => "?").join(", ")}, ?, ?)`,
    ...cols.map(k => func[k]), t, t);
  const matricula = func.matricula || r.meta.last_row_id;
  const f = await um(env, "SELECT * FROM funcionarios WHERE matricula = ?", matricula);

  await env.DB.batch([
    prep(env, "UPDATE admissoes SET status = 'APROVADA', funcionario_id = ?, historico = ?, atualizado_em = ? WHERE id = ?",
      matricula, historicoMais(a.historico, quemE(u), "Aprovada pelo RH", "Matrícula " + matricula), t, a.id),
    prep(env, "UPDATE candidaturas SET status = 'Contratado', atualizado_em = ? WHERE id = ?", t, a.candidatura_id)
  ]);
  await registrarLog(env, quemE(u), "ADMISSAO_APROVADA", "admissao", a.id, "matrícula " + matricula);

  const ics = p.hora_inicio ? null : anexoIcs("Início — " + f.nome, f.data_efetivacao, `Início de ${f.nome} (${a.titulo_vaga}). Função: ${f.funcao}. Departamento: ${f.departamento}.`);
  const convite = conviteInicio(env, a, p, f.nome, f.email);
  notificar(env, ctx, f.email, "Admissão aprovada — bem-vindo(a) à Innomaker", "Sua admissão foi aprovada",
    [`Olá, <b>${esc(primeiro)}</b>! Seu cadastro foi aprovado. Sua matrícula na Innomaker é <b>${matricula}</b>.`,
      `Seu primeiro dia (onboarding) será em <b>${dataBR(f.data_efetivacao)}${p.hora_inicio ? " às " + p.hora_inicio : ""}</b>${p.local_inicio ? ", em " + esc(p.local_inicio) : ""}. O convite está anexado.`],
    { texto: "Abrir a Área do candidato", url: linkArea(env) }, convite ? { convite } : ics ? { anexos: [ics] } : null);

  const config = await lerConfig(env);
  const gestores = [p.gestor_email, config.email_rh].filter(Boolean);
  notificar(env, ctx, [...new Set(gestores)], `Admissão aprovada — ${f.nome}`, "Admissão aprovada",
    [`<b>${f.nome}</b> foi aprovado(a) para <b>${a.titulo_vaga}</b> (matrícula ${matricula}).`,
      `Início: <b>${dataBR(f.data_efetivacao)}${p.hora_inicio ? " às " + p.hora_inicio : ""}</b>. Função: ${f.funcao}. Departamento: ${f.departamento}.`],
    { texto: "Ver no painel", url: linkPainel(env, "funcionario/" + matricula) }, convite ? { convite } : ics ? { anexos: [ics] } : null);

  return { ok: true, matricula };
}

// =====================================================================
//  Funcionários
// =====================================================================
async function funcListar(env) {
  const linhas = await todos(env,
    `SELECT f.matricula, f.nome, f.email, f.email_innomaker, f.cargo, f.funcao, f.departamento, f.tipo_contratacao,
            f.data_efetivacao, f.data_final_contrato, f.ponto_cadastrado, f.onboarding_ok, f.acessos_ok, f.ativo, f.admissao_id
       FROM funcionarios f ORDER BY f.matricula DESC`);
  return { ok: true, hoje: hojeISO(), itens: linhas };
}



async function funcDetalhe(env, ctx, b) {
  const f = await um(env, "SELECT * FROM funcionarios WHERE matricula = ?", parseInt(b.matricula, 10) || 0);
  if (!f) throw new ErroApi("Funcionário não encontrado.");
  const config = await lerConfig(env);
  const arquivos = f.admissao_id ? (await todos(env, "SELECT id, nome, categoria, criado_em FROM arquivos WHERE admissao_id = ? ORDER BY categoria, criado_em", f.admissao_id))
    .map(x => Object.assign(x, { categoria_nome: nomeCategoria(config, x.categoria) })) : [];
  const cdt = f.admissao_id ? await um(env, "SELECT ca.periodo_curso, ca.previsao_formatura, ca.curriculo_id FROM admissoes a JOIN candidaturas ca ON ca.id = a.candidatura_id WHERE a.id = ?", f.admissao_id) : null;
  return {
    ok: true, funcionario: Object.assign(f, { dados: parseJson(f.dados, {}) }), arquivos, candidatura: cdt || {},
    camposCadastro: Object.keys(CAMPOS_CADASTRO).map(k => ({ chave: k, rotulo: CAMPOS_CADASTRO[k][2], etapa: CAMPOS_CADASTRO[k][3] }))
  };
}

const CAMPOS_FUNC_TEXTO = ["nome", "email", "email_innomaker", "telefone", "situacao", "cargo", "funcao", "departamento", "setor",
  "horario_trabalho", "tipo_contratacao", "bolsa_valor", "auxilio", "responsavel", "entidade_vinculada", "principais_funcoes",
  "data_efetivacao", "data_final_contrato"];
const CAMPOS_FUNC_FLAG = ["ponto_cadastrado", "onboarding_ok", "acessos_ok", "ativo"];
const CAMPOS_DADOS = ["cpf", "rg", "cnh", "ctps", "sexo", "data_nascimento", "cep", "endereco", "bairro", "cidade", "estado", "banco",
  "agencia", "conta", "tipo_conta", "pix_numero", "pix_banco", "grau_instrucao", "area_formacao", "instituicao_ensino", "cr",
  "matricula_uff", "curriculo_lattes", "nome_emergencia", "telefone_emergencia"];

async function funcAtualizar(env, ctx, b, u) {
  const f = await um(env, "SELECT * FROM funcionarios WHERE matricula = ?", parseInt(b.matricula, 10) || 0);
  if (!f) throw new ErroApi("Funcionário não encontrado.");
  const sets = [];
  const vals = [];
  CAMPOS_FUNC_TEXTO.forEach(k => {
    if (b[k] === undefined) return;
    const v = texto(b[k], 3000);
    if ((k === "data_efetivacao" || k === "data_final_contrato") && v && !ehDataISO(v)) throw new ErroApi("Data inválida.");
    sets.push(k + " = ?"); vals.push(v);
  });
  CAMPOS_FUNC_FLAG.forEach(k => { if (b[k] !== undefined) { sets.push(k + " = ?"); vals.push(b[k] ? 1 : 0); } });
  if (b.dados && typeof b.dados === "object") {
    const atual = parseJson(f.dados, {});
    CAMPOS_DADOS.forEach(k => { if (b.dados[k] !== undefined) atual[k] = texto(b.dados[k], 300); });
    sets.push("dados = ?"); vals.push(JSON.stringify(atual));
  }
  if (b.data_final_contrato !== undefined && b.data_final_contrato !== f.data_final_contrato) {
    sets.push("lembrete_renovacao_em = NULL");
  }
  if (!sets.length) return { ok: true };
  await executar(env, `UPDATE funcionarios SET ${sets.join(", ")}, atualizado_em = ? WHERE matricula = ?`, ...vals, agora(), f.matricula);
  // mesma data na trilha da admissão
  if (f.admissao_id) {
    const a = await um(env, "SELECT * FROM admissoes WHERE id = ?", f.admissao_id);
    if (a) for (const [passo, col] of Object.entries(PASSOS_MANUAIS)) {
      if (b[col] !== undefined && !!b[col] !== !!f[col]) await marcarPasso(env, await um(env, "SELECT * FROM admissoes WHERE id = ?", a.id), passo, !!b[col], u);
    }
  }
  await registrarLog(env, quemE(u), "FUNCIONARIO_ATUALIZADO", "funcionario", f.matricula, Object.keys(b).filter(k => k !== "matricula").join(", "));
  return { ok: true };
}



// =====================================================================
//  Configurações e log
// =====================================================================
async function cfgObter(env) {
  const config = await lerConfig(env);
  const departamentos = await todos(env, "SELECT * FROM departamentos ORDER BY ativo DESC, nome");
  const listas = {};
  TIPOS_LISTA.forEach(t => { listas[t] = []; });
  (await todos(env, "SELECT tipo, valor FROM listas ORDER BY ordem, valor")).forEach(l => { (listas[l.tipo] = listas[l.tipo] || []).push(l.valor); });
  return { ok: true, config, departamentos, listas, tiposLista: TIPOS_LISTA, lgpd: await prazosLgpd(env), admissaoDocumentos: listaDocumentos(config),
    lgpdVencidos: (await candidatosVencidos(env)).length,
    backup: env.BACKUP ? env.BACKUP.status() : null };
}

async function cfgSalvarGeral(env, ctx, b, u) {
  const email = texto(b.email_rh, 200);
  if (!emailValido(email)) throw new ErroApi("E-mail do RH inválido.");
  const url = v => { const s = texto(v, 500); if (s && !/^https:\/\//.test(s)) throw new ErroApi("Os links precisam começar com https://"); return s; };
  const links = (Array.isArray(b.links_colaborador) ? b.links_colaborador : []).slice(0, 20).map(l => ({
    titulo: texto(l.titulo, 80), descricao: texto(l.descricao, 200), url: url(l.url)
  })).filter(l => l.titulo && l.url);
  const pares = { email_rh: email, link_cartilha: url(b.link_cartilha), links_colaborador: JSON.stringify(links) };
  await env.DB.batch(Object.keys(pares).map(k => prep(env,
    "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor", k, pares[k])));
  await registrarLog(env, quemE(u), "CONFIG_SALVA", "config", "", "");
  return { ok: true };
}

async function depSalvar(env, ctx, b, u) {
  const nome = texto(b.nome, 120);
  const gEmail = texto(b.gestor_email, 200).toLowerCase();
  obrigatorio(nome, "Nome do departamento");
  if (gEmail && !emailValido(gEmail)) throw new ErroApi("E-mail do gestor inválido.");
  if (b.id) {
    await executar(env, "UPDATE departamentos SET nome = ?, gestor_nome = ?, gestor_email = ?, ativo = ? WHERE id = ?",
      nome, texto(b.gestor_nome, 150), gEmail, b.ativo === false ? 0 : 1, parseInt(b.id, 10));
  } else {
    try {
      await executar(env, "INSERT INTO departamentos (nome, gestor_nome, gestor_email) VALUES (?, ?, ?)", nome, texto(b.gestor_nome, 150), gEmail);
    } catch (e) { throw new ErroApi("Já existe um departamento com esse nome."); }
  }
  await registrarLog(env, quemE(u), "DEPARTAMENTO_SALVO", "departamento", nome, gEmail);
  return { ok: true };
}

async function listaSalvar(env, ctx, b, u) {
  if (TIPOS_LISTA.indexOf(b.tipo) < 0) throw new ErroApi("Lista inválida.");
  const valores = [...new Set((Array.isArray(b.valores) ? b.valores : []).map(v => texto(v, 120)).filter(Boolean))].slice(0, 200);
  if (b.tipo === "etapa" && valores[0] !== "Triagem") valores.unshift("Triagem");
  await env.DB.batch([
    prep(env, "DELETE FROM listas WHERE tipo = ?", b.tipo),
    ...valores.map((v, i) => prep(env, "INSERT INTO listas (tipo, valor, ordem) VALUES (?, ?, ?)", b.tipo, v, i + 1))
  ]);
  await registrarLog(env, quemE(u), "LISTA_SALVA", "lista", b.tipo, valores.length + " itens");
  return { ok: true };
}


// ---------- Privacidade (LGPD) ----------
async function cfgSalvarLgpd(env, ctx, b, u) {
  const r = parseInt(b.lgpd_meses_retencao, 10), bt = parseInt(b.lgpd_meses_banco, 10);
  if (!(r >= 3 && r <= 120)) throw new ErroApi("Prazo de guarda: de 3 a 120 meses.");
  if (!(bt >= r && bt <= 120)) throw new ErroApi("O prazo do banco de talentos precisa ser igual ou maior que o prazo de guarda (até 120 meses).");
  await env.DB.batch([["lgpd_meses_retencao", r], ["lgpd_meses_banco", bt]].map(([k, v]) => prep(env,
    "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor", k, String(v))));
  await registrarLog(env, quemE(u), "CONFIG_LGPD", "config", "", r + " / " + bt + " meses");
  return { ok: true };
}

// RH exclui os dados de um candidato (pedido recebido por e-mail, por exemplo)
async function candidatoExcluir(env, ctx, b, u) {
  const id = texto(b.candidato_id, 30);
  if (String(b.confirmacao || "").trim().toUpperCase() !== "EXCLUIR") throw new ErroApi("Digite EXCLUIR para confirmar.");
  const r = await excluirCandidato(env, ctx, id, quemE(u), texto(b.motivo, 300) || "pedido ao RH");
  return Object.assign({ ok: true }, r);
}

// =====================================================================
//  Banco de talentos
//  Aparece quem aceitou (consentimento) ou foi marcado pelo RH. Convite por e-mail só para quem aceitou.
// =====================================================================
async function talentosListar(env) {
  const p = await prazosLgpd(env);
  const cands = await todos(env,
    `SELECT id, nome, email, telefone, banco_talentos, banco_talentos_em, talento_marcado, talento_nota, talento_tags, talento_por, talento_em, criado_em
       FROM candidatos WHERE banco_talentos = 1 OR talento_marcado = 1 ORDER BY talento_marcado DESC, nome`);
  if (!cands.length) return { ok: true, itens: [], prazoBanco: p.banco };
  const cdts = await todos(env,
    `SELECT ca.id, ca.candidato_id, ca.status, ca.criado_em, ca.curriculo_id, ca.periodo_curso, ca.previsao_formatura, v.titulo, v.departamento,
            (SELECT COALESCE(sum(e.nota), 0) FROM etapas e WHERE e.candidatura_id = ca.id) AS estrelas,
            (SELECT count(*) FROM etapas e WHERE e.candidatura_id = ca.id AND e.nota > 0) AS avaliadas,
            (SELECT e.nome FROM etapas e WHERE e.candidatura_id = ca.id AND e.resultado <> 'Aprovado' ORDER BY e.ordem LIMIT 1) AS parou_em
       FROM candidaturas ca JOIN vagas v ON v.id = ca.vaga_id
      WHERE ca.candidato_id IN (SELECT id FROM candidatos WHERE banco_talentos = 1 OR talento_marcado = 1)
      ORDER BY ca.criado_em DESC`);
  const itens = cands.map(c => {
    const minhas = cdts.filter(x => x.candidato_id === c.id);
    const ultimo = minhas[0] || {};
    return Object.assign(c, {
      candidaturas: minhas.map(x => ({ id: x.id, titulo: x.titulo, departamento: x.departamento, status: x.status, criado_em: x.criado_em,
        estrelas: x.estrelas, avaliadas: x.avaliadas, parou_em: x.parou_em || "" })),
      curriculo_id: ultimo.curriculo_id || "", periodo_curso: ultimo.periodo_curso || "", previsao_formatura: ultimo.previsao_formatura || "",
      melhor: minhas.reduce((m, x) => x.avaliadas ? Math.max(m, x.estrelas / x.avaliadas) : m, 0),
      em_processo: minhas.some(x => ["Em processo", "Aprovado", "Proposta"].indexOf(x.status) >= 0),
      contratado: minhas.some(x => x.status === "Contratado")
    });
  });
  return { ok: true, itens, prazoBanco: p.banco };
}

async function talentoSalvar(env, ctx, b, u) {
  const c = await um(env, "SELECT id FROM candidatos WHERE id = ?", texto(b.candidato_id, 30));
  if (!c) throw new ErroApi("Candidato não encontrado.");
  const tags = [...new Set(String(b.tags || "").split(/[,;\n]+/).map(t => texto(t, 40).toLowerCase()).filter(Boolean))].slice(0, 15).join(", ");
  const marcado = b.marcado === true ? 1 : 0;
  await executar(env, "UPDATE candidatos SET talento_marcado = ?, talento_nota = ?, talento_tags = ?, talento_por = ?, talento_em = ? WHERE id = ?",
    marcado, texto(b.nota, 2000), tags, marcado ? (u.nome || u.login || "") : "", marcado ? agora() : null, c.id);
  await registrarLog(env, quemE(u), marcado ? "TALENTO_MARCADO" : "TALENTO_DESMARCADO", "candidato", c.id, tags);
  return { ok: true };
}

async function talentoConvidar(env, ctx, b, u) {
  const vaga = await um(env, "SELECT * FROM vagas WHERE id = ?", texto(b.vaga_id, 30));
  if (!vaga || vaga.status !== "Aberta" || (vaga.data_limite && vaga.data_limite < hojeISO())) throw new ErroApi("Escolha uma vaga aberta e com prazo em dia.");
  const ids = (Array.isArray(b.candidato_ids) ? b.candidato_ids : []).map(x => texto(x, 30)).filter(Boolean).slice(0, 100);
  if (!ids.length) throw new ErroApi("Escolha pelo menos um candidato.");
  const extra = texto(b.mensagem, 1500);
  const link = linkVaga(env, vaga.id, vaga.titulo) + "?origem=talentos";
  const enviados = [], ignorados = [];
  for (const id of ids) {
    const c = await um(env, "SELECT id, nome, email, banco_talentos FROM candidatos WHERE id = ?", id);
    if (!c) continue;
    if (!c.banco_talentos) { ignorados.push({ nome: c.nome, motivo: "não autorizou o banco de talentos" }); continue; }
    if (await um(env, "SELECT id FROM candidaturas WHERE candidato_id = ? AND vaga_id = ?", c.id, vaga.id)) {
      ignorados.push({ nome: c.nome, motivo: "já se inscreveu nesta vaga" }); continue;
    }
    notificar(env, ctx, c.email, "Uma vaga na Innomaker combina com você — " + vaga.titulo, "Temos uma vaga para você",
      [`Olá, <b>${esc(String(c.nome).split(" ")[0])}</b>!`,
        `Você está no nosso banco de talentos e lembramos de você para a vaga <b>${esc(vaga.titulo)}</b>${vaga.localidade ? " (" + esc(vaga.localidade) + ")" : ""}.`,
        extra ? esc(extra).replace(/\n/g, "<br>") : "",
        vaga.data_limite ? "Inscrições até <b>" + dataBR(vaga.data_limite) + "</b>." : "",
        "Se tiver interesse, veja os detalhes e se inscreva pelo botão abaixo. Se não quiser mais receber convites, desligue o banco de talentos na sua Área do candidato."].filter(Boolean),
      { texto: "Ver a vaga e me inscrever", url: link });
    enviados.push(c.nome);
  }
  await registrarLog(env, quemE(u), "TALENTOS_CONVIDADOS", "vaga", vaga.id, enviados.length + " convite(s)");
  return { ok: true, enviados, ignorados };
}

// =====================================================================
//  Indicadores (RH)
// =====================================================================
const diasEntre = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 864e5;
const media = l => l.length ? Math.round(l.reduce((t, x) => t + x, 0) / l.length * 10) / 10 : null;
const mediana = l => { if (!l.length) return null; const o = l.slice().sort((x, y) => x - y); const m = o.length >> 1; return Math.round((o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2) * 10) / 10; };

async function indicadores(env, ctx, b) {
  const dias = [30, 90, 180, 365, 0].indexOf(parseInt(b.dias, 10)) >= 0 ? parseInt(b.dias, 10) : 90;
  const desde = dias ? new Date(Date.now() - dias * 864e5).toISOString() : "0000";

  const cdts = await todos(env,
    `SELECT ca.id, ca.vaga_id, ca.status, ca.origem, ca.criado_em, ca.atualizado_em FROM candidaturas ca WHERE ca.criado_em >= ?`, desde);
  const ids = new Set(cdts.map(c => c.id));
  const ets = (await todos(env,
    `SELECT e.candidatura_id, e.ordem, e.nome, e.resultado, e.nota FROM etapas e JOIN candidaturas ca ON ca.id = e.candidatura_id WHERE ca.criado_em >= ?`, desde))
    .filter(e => ids.has(e.candidatura_id));

  // Funil: quantos chegaram a cada etapa, quantos passaram, foram recusados ou ainda estão nela
  const funil = new Map();
  const porCdt = new Map();
  ets.forEach(e => { if (!porCdt.has(e.candidatura_id)) porCdt.set(e.candidatura_id, []); porCdt.get(e.candidatura_id).push(e); });
  const statusDe = new Map(cdts.map(c => [c.id, c.status]));
  porCdt.forEach((lista, cid) => {
    lista.sort((x, y) => x.ordem - y.ordem);
    for (const e of lista) {
      const k = e.nome;
      if (!funil.has(k)) funil.set(k, { etapa: k, ordem: e.ordem, chegaram: 0, aprovados: 0, recusados: 0, desistiram: 0, aguardando: 0, notas: [] });
      const f = funil.get(k);
      f.ordem = Math.min(f.ordem, e.ordem);
      f.chegaram++;
      if (e.nota) f.notas.push(e.nota);
      if (e.resultado === "Aprovado") { f.aprovados++; continue; }
      if (e.resultado === "Reprovado") f.recusados++;
      else if (statusDe.get(cid) === "Desistiu") f.desistiram++;
      else f.aguardando++;
      break;
    }
  });
  const etapas = [...funil.values()].sort((a, b2) => a.ordem - b2.ordem || b2.chegaram - a.chegaram)
    .map(f => ({ etapa: f.etapa, chegaram: f.chegaram, aprovados: f.aprovados, recusados: f.recusados, desistiram: f.desistiram, aguardando: f.aguardando,
      nota_media: media(f.notas) }));

  // Origem das candidaturas e quantas viraram contratação
  const origens = Object.keys(ORIGENS).map(k => ({
    origem: k, nome: ORIGENS[k],
    candidaturas: cdts.filter(c => (c.origem || "site") === k).length,
    contratados: cdts.filter(c => (c.origem || "site") === k && c.status === "Contratado").length
  })).filter(o => o.candidaturas);

  // Tempo até a contratação: da inscrição até a aprovação da admissão
  const adms = await todos(env,
    `SELECT a.id, a.atualizado_em, a.historico, ca.criado_em AS inscricao, v.criado_em AS vaga_criada, v.id AS vaga_id
       FROM admissoes a JOIN candidaturas ca ON ca.id = a.candidatura_id JOIN vagas v ON v.id = a.vaga_id
      WHERE a.status = 'APROVADA' AND a.atualizado_em >= ?`, desde);
  const aprovadaEm = a => {
    const h = parseJson(a.historico, []).filter(x => /aprovad/i.test(x.acao || "")).pop();
    return h && h.quando ? h.quando : a.atualizado_em;
  };
  const tInscricao = adms.map(a => diasEntre(a.inscricao, aprovadaEm(a))).filter(x => x >= 0);
  const tVaga = adms.map(a => diasEntre(a.vaga_criada, aprovadaEm(a))).filter(x => x >= 0);

  // Candidatos por vaga (vagas com inscrições no período ou abertas)
  const vagas = await todos(env,
    `SELECT v.id, v.titulo, v.status, v.departamento, v.criado_em,
            (SELECT count(*) FROM candidaturas c WHERE c.vaga_id = v.id AND c.criado_em >= ?) AS inscritos,
            (SELECT count(*) FROM candidaturas c WHERE c.vaga_id = v.id AND c.criado_em >= ? AND c.status IN ('Em processo', 'Aprovado', 'Proposta')) AS em_processo,
            (SELECT count(*) FROM candidaturas c WHERE c.vaga_id = v.id AND c.criado_em >= ? AND c.status = 'Contratado') AS contratados
       FROM vagas v
      WHERE v.status IN ('Aberta', 'Pausada') OR EXISTS (SELECT 1 FROM candidaturas c WHERE c.vaga_id = v.id AND c.criado_em >= ?)
      ORDER BY inscritos DESC, v.criado_em DESC LIMIT 30`, desde, desde, desde, desde);

  const total = cdts.length;
  const conta = st => cdts.filter(c => c.status === st).length;
  return {
    ok: true, dias,
    resumo: {
      candidaturas: total,
      contratados: conta("Contratado"),
      desistencias: conta("Desistiu"),
      encerrados: conta("Encerrado"),
      em_andamento: cdts.filter(c => ["Em processo", "Aprovado", "Proposta"].indexOf(c.status) >= 0).length,
      dias_ate_contratar: media(tInscricao), dias_ate_contratar_mediana: mediana(tInscricao),
      dias_vaga_ate_contratar: media(tVaga), admissoes_aprovadas: adms.length,
      indicacoes: cdts.filter(c => c.origem === "indicacao").length,
      inscritos_por_vaga: vagas.length ? Math.round(vagas.reduce((t, v) => t + v.inscritos, 0) / vagas.length * 10) / 10 : null
    },
    etapas, origens, vagas
  };
}


// ---------- Data da etapa: RH marca dia/hora/local e o candidato recebe por e-mail (com convite de calendário) ----------
async function etapaAgendar(env, ctx, b, u) {
  const e = await um(env, "SELECT * FROM etapas WHERE id = ?", parseInt(b.etapa_id, 10) || 0);
  if (!e) throw new ErroApi("Etapa não encontrada.");
  if (e.ordem === 1 || /triagem/i.test(e.nome)) throw new ErroApi("A Triagem não tem data marcada.");
  if (ehEtapaProposta(e.nome)) throw new ErroApi("A Proposta não tem reunião: envie a proposta com o dia de início.");
  if (e.resultado !== "Pendente") throw new ErroApi("Esta etapa já foi avaliada.");
  const ca = await um(env, `SELECT ca.*, c.nome, c.email, v.titulo FROM candidaturas ca JOIN candidatos c ON c.id = ca.candidato_id
    JOIN vagas v ON v.id = ca.vaga_id WHERE ca.id = ?`, e.candidatura_id);
  if (ca.status !== "Em processo") throw new ErroApi("O candidato não está em processo.");
  const data = texto(b.data, 10), hora = texto(b.hora, 5), local = texto(b.local, 500), msg = texto(b.mensagem, 1500);
  if (!ehDataISO(data)) throw new ErroApi("Escolha a data.");
  if (data < hojeISO()) throw new ErroApi("A data não pode ser no passado.");
  if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new ErroApi("Hora inválida.");
  const dur = Math.min(480, Math.max(10, parseInt(b.duracao_min, 10) || 60));
  const avisar = b.avisar !== false;
  await executar(env, "UPDATE etapas SET data_prevista = ?, hora_prevista = ?, local_prevista = ?, data_enviada_em = ? WHERE id = ?",
    data, hora, local, avisar ? agora() : e.data_enviada_em, e.id);
  await registrarLog(env, quemE(u), "ETAPA_DATA_MARCADA", "candidatura", ca.id, e.nome + " — " + dataBR(data) + (hora ? " " + hora : "") + (avisar ? " (candidato avisado)" : ""));
  if (avisar) {
    const quando = dataBR(data) + (hora ? " às " + hora : "");
    const titulo = e.nome + " · " + ca.nome + " · " + ca.titulo;
    let extra = null;
    if (hora) {
      const ini = data + "T" + hora;
      extra = { convite: { metodo: "REQUEST", ics: icsEvento({ uid: "etapa-" + e.id + "@vagas.innomaker.com.br", metodo: "REQUEST", sequencia: Math.floor(Date.now() / 1000),
        inicio: ini, fim: somarMinutos(ini, dur), titulo, descricao: [msg, local ? "Local: " + local : ""].filter(Boolean).join("\n"), local,
        organizador: { nome: env.EMAIL_NOME || "Innomaker Recrutamento", email: String(env.SMTP_FROM || env.SMTP_USER || "rh.innomaker@gmail.com").trim() },
        participantes: [{ nome: ca.nome, email: ca.email }] }) } };
    } else {
      const ics = anexoIcs(titulo, data, [msg, local].filter(Boolean).join("\n"));
      if (ics) extra = { anexos: [ics] };
    }
    const online = /^https?:\/\//i.test(local);
    notificar(env, ctx, ca.email, "Data marcada: " + e.nome + " — " + ca.titulo, "Sua próxima etapa tem data marcada",
      [`Olá, <b>${esc(String(ca.nome).split(" ")[0])}</b>!`,
        `A etapa <b>${esc(e.nome)}</b> do processo seletivo para <b>${esc(ca.titulo)}</b> está marcada para <b>${esc(quando)}</b>.`,
        local ? (online ? "<b>Link:</b> " : "<b>Local:</b> ") + esc(local) : "",
        msg ? esc(msg).replace(/\n/g, "<br>") : "",
        hora ? "O convite está anexado: clique em <b>Sim</b> para colocar na sua agenda." : "Se não puder comparecer, responda este e-mail."].filter(Boolean),
      { texto: "Ver minha candidatura", url: linkArea(env) }, extra);
  }
  return { ok: true, avisado: avisar };
}


// =====================================================================
//  Entrevistas: tudo o que está marcado (agenda com reserva e "Marcar data"), por dia
// =====================================================================
async function entrevistasListar(env, ctx, b, u) {
  const passadas = b.periodo === "passadas";
  const hoje = hojeISO();
  const de = passadas ? hojeISO(-30) : hoje, ate = passadas ? hojeISO(-1) : hojeISO(365);
  const reservas = await todos(env,
    `SELECT h.id, h.inicio, h.fim, a.etapa_nome, a.local, a.local_tipo, a.participantes, h.participantes_extra, v.id AS vaga_id, v.titulo AS vaga_titulo,
            v.gestor_email, v.solicitacao_id, c.nome AS candidato_nome, c.email AS candidato_email, ca.id AS candidatura_id
       FROM agenda_horarios h JOIN agendas a ON a.id = h.agenda_id JOIN vagas v ON v.id = a.vaga_id
       JOIN etapas e ON e.id = h.etapa_id JOIN candidaturas ca ON ca.id = e.candidatura_id JOIN candidatos c ON c.id = ca.candidato_id
      WHERE substr(h.inicio, 1, 10) BETWEEN ? AND ? ORDER BY h.inicio`, de, ate);
  const marcadas = await todos(env,
    `SELECT e.id, e.nome AS etapa_nome, e.data_prevista, e.hora_prevista, e.local_prevista, e.data_enviada_em, v.id AS vaga_id, v.titulo AS vaga_titulo,
            v.gestor_email, v.solicitacao_id, c.nome AS candidato_nome, c.email AS candidato_email, ca.id AS candidatura_id
       FROM etapas e JOIN candidaturas ca ON ca.id = e.candidatura_id JOIN candidatos c ON c.id = ca.candidato_id JOIN vagas v ON v.id = ca.vaga_id
      WHERE e.data_prevista BETWEEN ? AND ? AND e.resultado = 'Pendente' AND ca.status = 'Em processo'
        AND NOT EXISTS (SELECT 1 FROM agenda_horarios h WHERE h.etapa_id = e.id)`, de, ate);
  const itens = [];
  for (const r of reservas) {
    if (!(await podeVerVaga(env, u, r))) continue;
    itens.push({ origem: "agenda", quando: r.inicio, data: r.inicio.slice(0, 10), hora: r.inicio.slice(11, 16), fim: r.fim.slice(11, 16),
      etapa: r.etapa_nome, local: r.local, online: r.local_tipo === "online", vaga_id: r.vaga_id, vaga_titulo: r.vaga_titulo,
      candidato_nome: r.candidato_nome, candidato_email: r.candidato_email, candidatura_id: r.candidatura_id,
      participantes: [...parseJson(r.participantes, []), ...parseJson(r.participantes_extra, [])].map(p => p.nome || p.email) });
  }
  for (const r of marcadas) {
    if (!(await podeVerVaga(env, u, r))) continue;
    itens.push({ origem: "data", quando: r.data_prevista + "T" + (r.hora_prevista || "99:99"), data: r.data_prevista, hora: r.hora_prevista || "", fim: "",
      etapa: r.etapa_nome, local: r.local_prevista || "", online: /^https?:/i.test(r.local_prevista || ""), vaga_id: r.vaga_id, vaga_titulo: r.vaga_titulo,
      candidato_nome: r.candidato_nome, candidato_email: r.candidato_email, candidatura_id: r.candidatura_id, avisado: !!r.data_enviada_em, participantes: [] });
  }
  itens.sort((x, y) => passadas ? (x.quando < y.quando ? 1 : -1) : (x.quando < y.quando ? -1 : 1));
  return { ok: true, hoje, itens };
}

// Aba "Agenda de entrevistas": agendas de horários de todas as vagas que a pessoa pode ver
async function agendasTodas(env, ctx, b, u) {
  const filtro = texto(b.vaga_id, 30);
  const vagas = await todos(env, `SELECT * FROM vagas WHERE id IN (SELECT DISTINCT vaga_id FROM agendas)${filtro ? " AND id = ?" : ""} ORDER BY criado_em DESC`, ...(filtro ? [filtro] : []));
  const grupos = [];
  for (const v of vagas) {
    if (!(await podeVerVaga(env, u, v))) continue;
    const r = await agendaListar(env, ctx, { vaga_id: v.id });
    grupos.push({ vaga: { id: v.id, titulo: v.titulo, status: v.status }, agendas: r.agendas, etapasAgendaveis: r.etapasAgendaveis, sugestaoParticipantes: r.sugestaoParticipantes });
  }
  // vagas em andamento com etapas depois da Triagem (para criar uma agenda nova)
  const abertas = [];
  for (const v of await todos(env, "SELECT * FROM vagas WHERE status <> 'Concluída' ORDER BY criado_em DESC")) {
    if (parseJson(v.etapas, []).filter(etapaAgendavel).length && await podeVerVaga(env, u, v)) abertas.push({ id: v.id, titulo: v.titulo });
  }
  return { ok: true, grupos, vagas: abertas, podeEditar: u.papel === "rh" };
}

async function logListar(env) {
  return {
    ok: true,
    log: await todos(env, "SELECT * FROM log ORDER BY id DESC LIMIT 300"),
    emails: await todos(env, "SELECT id, quando, para, assunto, status, erro FROM emails ORDER BY id DESC LIMIT 150")
  };
}

async function emailTeste(env, ctx, b, u) {
  const para = texto(b.para || u.email, 200);
  if (!emailValido(para)) throw new ErroApi("Informe um e-mail válido para o teste.");
  if (!smtpConfigurado(env)) return { ok: false, erro: "SMTP_USER e SMTP_PASS (conta e senha de app do Gmail) não estão configurados. Os e-mails não estão saindo." };
  const r = await enviarEmail(env, {
    para,
    assunto: "Teste de e-mail — sistema de vagas Innomaker",
    html: layout({ titulo: "Os e-mails estão funcionando", paragrafos: [`Este é um teste enviado por ${u.nome} pelo painel.`, "Se você recebeu esta mensagem, candidatos, gestores e RH também vão receber os avisos do sistema."] }),
    texto: "Teste de e-mail do sistema de vagas Innomaker. Os e-mails estão funcionando."
  });
  if (!r.ok) {
    let erro = r.erro || r.status;
    if (/\b535\b|Username and Password not accepted/i.test(erro))
      erro = "usuário ou senha de app recusados. Gere uma nova senha de app em myaccount.google.com/apppasswords. (" + erro + ")";
    return { ok: false, erro: "O Gmail recusou o envio: " + erro };
  }
  return { ok: true, para };
}

const HANDLERS = {
  me, opcoes, vagas_abertas: vagasAbertas,
  solic_criar: solicCriar, solic_editar: solicEditar, solic_minhas: solicMinhas, solic_listar: solicListar, solic_decidir: solicDecidir,
  vagas_todas: vagasTodas, minhas_vagas: minhasVagas, vaga_salvar: vagaSalvar, vaga_detalhe: vagaDetalhe,
  etapa_atualizar: etapaAtualizar, candidatura_status: candidaturaStatus,
  proposta_criar: propostaCriar, adm_listar: admListar, adm_detalhe: admDetalhe, adm_decidir: admDecidir, adm_reenviar: admReenviar,
  func_listar: funcListar, func_detalhe: funcDetalhe, func_atualizar: funcAtualizar,
  cfg_obter: cfgObter, cfg_salvar_geral: cfgSalvarGeral, dep_salvar: depSalvar, lista_salvar: listaSalvar,
  log_listar: logListar, email_teste: emailTeste, entrevistas_listar: entrevistasListar,
  agenda_listar: async (env, ctx, b, u) => {
    const vaga = await um(env, "SELECT * FROM vagas WHERE id = ?", texto(b.vaga_id, 30));
    if (!vaga) throw new ErroApi("Vaga não encontrada.");
    if (!(await podeVerVaga(env, u, vaga))) throw new ErroApi("Esta vaga não é da sua área.", 403);
    return Object.assign(await agendaListar(env, ctx, b), { podeEditar: u.papel === "rh" });
  },
  agenda_salvar: agendaSalvar, agenda_encerrar: agendaEncerrar, agenda_convidar: agendaConvidar,
  agenda_cancelar_reserva: agendaCancelarReserva, agenda_participante: agendaParticipante,
  talentos_listar: talentosListar, talento_salvar: talentoSalvar, talento_convidar: talentoConvidar,
  indicadores, cfg_salvar_lgpd: cfgSalvarLgpd, candidato_excluir: candidatoExcluir,
  adm_proposta_salvar: admPropostaSalvar, adm_cancelar: admCancelar, adm_passo: admPasso, adm_pedir_acessos: admPedirAcessos,
  adm_area: admArea, cfg_salvar_admissao: cfgSalvarAdmissao,
  etapa_agendar: etapaAgendar, agendas_todas: agendasTodas
};

export { podeVerVaga };
