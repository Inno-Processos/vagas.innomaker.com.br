// =====================================================================
//  Rotas do BACKEND — vagas.innomaker.com.br
//  Só API (JSON), download de arquivos e login/logout. Nenhuma página HTML:
//  as telas ficam no frontend, que repassa estas rotas para cá.
//
//  GET  /api/site/inicio         dados do site público (vagas, candidato logado, se há sessão de funcionário)
//  GET  /api/vagas               vagas abertas
//  POST /api/candidato/<acao>    inscrição e área do candidato
//  GET  /api/painel/sessao       quem está logado no painel (401 sem login, 403 sem grupo)
//  POST /api/staff/<acao>        ações do painel interno
//  GET  /api/agendar/<token>     horários livres para o candidato (link do e-mail, sem login)
//  POST /api/agendar/<token>/reservar | liberar
//  GET  /api/privacidade         prazos de guarda e contato (página Política de privacidade)
//  GET  /arquivo/<id>            currículos e documentos enviados (com permissão)
//  GET  /entrar, /sair           login e logout no Authelia
// =====================================================================
import { cfg, urlsLogin } from "./lib/config.js";
import { lerSessao, esquecerSessao } from "./lib/auth.js";
import { ACOES, podeExecutar, acoesDoPapel } from "./lib/papeis.js";
import { json, redirecionar, mesmaOrigem, lerJson, lerCookie } from "./lib/http.js";
import { um, lerConfig } from "./lib/db.js";
import { candidatoDaSessao, COOKIE_CANDIDATO } from "./lib/senha.js";
import { respostaArquivo } from "./lib/arquivos.js";
import { apiCandidato, vagasPublicas } from "./api/candidato.js";
import { apiStaff, podeVerVaga } from "./api/staff.js";
import { apiAgendamento } from "./api/agendamento.js";
import { prazosLgpd } from "./lib/lgpd.js";
import { gerarXlsx } from "./lib/xlsx.js";
import { COLUNAS, linhaRegistro } from "./lib/registro.js";
import { todos } from "./lib/db.js";
import { hojeISO } from "./lib/http.js";

const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

export async function rotear(request, env, ctx) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (p === "/api/vagas") return json({ ok: true, vagas: await vagasPublicas(env) });
    if (p === "/api/site/inicio") return siteInicio(request, env);
    if (p === "/api/painel/sessao") return painelSessao(request, env);
    if (p.startsWith("/api/agendar/")) return apiAgendamento(request, env, ctx, p.slice("/api/agendar/".length));
    if (p === "/api/privacidade") {
      const [prazos, config] = await Promise.all([prazosLgpd(env), lerConfig(env)]);
      return json({ ok: true, prazos, contato: config.email_rh || "" });
    }

    if (p.startsWith("/api/candidato/")) {
      if (request.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);
      if (!mesmaOrigem(request, url)) return json({ ok: false, erro: "Origem não permitida." }, 403);
      if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD_BYTES) {
        return json({ ok: false, erro: "Os arquivos passam do limite total de 60 MB." }, 413);
      }
      return apiCandidato(request, env, ctx, p.slice("/api/candidato/".length));
    }

    if (p.startsWith("/api/staff/")) return staff(request, env, ctx, url, p.slice("/api/staff/".length));
    if (p === "/api/funcionarios.xlsx") return funcionariosXlsx(request, env, url);

    if (p.startsWith("/arquivo/")) return arquivo(request, env, p.slice("/arquivo/".length));

    if (p === "/entrar") return redirecionar(urlsLogin(cfg(env)).loginUrl);
    if (p === "/sair") {
      await esquecerSessao(request, env);
      return redirecionar(urlsLogin(cfg(env)).logoutUrl);
    }

    return json({ ok: false, erro: "Rota inexistente." }, 404);
  } catch (e) {
    console.log("erro", p, e && e.stack);
    return json({ ok: false, erro: "Erro interno no servidor. Tente novamente em instantes." }, 500);
  }
}

// Site público: vagas, candidato logado (para preencher a inscrição) e se há cookie do Authelia (botão "Painel")
async function siteInicio(request, env) {
  const cookies = request.headers.get("cookie");
  const cand = lerCookie(cookies, COOKIE_CANDIDATO) ? await candidatoDaSessao(env, request) : null;
  let vagas = [], erro = "";
  try { vagas = await vagasPublicas(env); } catch (e) { erro = "Não foi possível carregar as vagas agora."; console.log("vagas", e && e.stack); }
  return json({
    ok: true, vagas, erro,
    candidato: cand ? { nome: cand.nome, email: cand.email, telefone: cand.telefone } : null,
    staff: { temSessao: !!lerCookie(cookies, cfg(env).autheliaCookie) }
  });
}

// Painel: quem está logado. O frontend manda para o login (401) ou mostra a página 403.
async function painelSessao(request, env) {
  const c = cfg(env);
  const login = urlsLogin(c);
  const s = await lerSessao(request, env);
  if (s.estado === "anonimo") return json({ ok: false, sessaoExpirada: true, loginUrl: login.loginUrl }, 401);
  if (s.estado === "erro") return json({ ok: false, erro: s.erro }, 502);
  if (s.estado !== "ok") return json({ ok: false, semPermissao: true, login: s.usuario && s.usuario.login || "", sairUrl: "/sair" }, 403);
  const config = await lerConfig(env);
  return json({
    ok: true,
    usuario: s.usuario,
    acoes: acoesDoPapel(s.usuario.papel),
    links: config.links_colaborador || [],
    siteUrl: c.siteUrl,
    loginUrl: login.loginUrl
  });
}

async function staff(request, env, ctx, url, acao) {
  if (request.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);
  if (!mesmaOrigem(request, url)) return json({ ok: false, erro: "Origem não permitida." }, 403);
  if (!ACOES[acao]) return json({ ok: false, erro: "Ação desconhecida." }, 404);

  const s = await lerSessao(request, env);
  if (s.estado === "anonimo") return json({ ok: false, sessaoExpirada: true, erro: "Faça login novamente.", loginUrl: urlsLogin(cfg(env)).loginUrl }, 401);
  if (s.estado === "erro") return json({ ok: false, erro: s.erro }, 502);
  if (s.estado !== "ok") return json({ ok: false, erro: "Acesso negado." }, 403);
  if (!podeExecutar(s.usuario.papel, acao)) {
    return json({ ok: false, erro: "Seu perfil (" + s.usuario.papelNome + ") não pode fazer esta ação." }, 403);
  }
  // anexos (etapas): formulário com arquivos
  if (/multipart\/form-data/i.test(request.headers.get("content-type") || "")) {
    if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD_BYTES) return json({ ok: false, erro: "Os arquivos passam do limite total de 60 MB." }, 413);
    let fd;
    try { fd = await request.formData(); } catch (e) { return json({ ok: false, erro: "Envio inválido. Tente de novo." }); }
    return apiStaff(env, ctx, acao, fd, s.usuario);
  }
  return apiStaff(env, ctx, acao, await lerJson(request), s.usuario);
}

// Registro dos funcionários em Excel (mesmas 64 colunas da aba Registros). ?matricula= baixa só um.
async function funcionariosXlsx(request, env, url) {
  const s = await lerSessao(request, env);
  if (s.estado === "anonimo") return redirecionar(urlsLogin(cfg(env)).loginUrl);
  if (s.estado !== "ok" || s.usuario.papel !== "rh") return json({ ok: false, erro: "Só o RH pode baixar os registros." }, 403);
  const mat = parseInt(url.searchParams.get("matricula"), 10) || 0;
  const fs = mat ? await todos(env, "SELECT * FROM funcionarios WHERE matricula = ?", mat) : await todos(env, "SELECT * FROM funcionarios ORDER BY matricula");
  if (mat && !fs.length) return json({ ok: false, erro: "Funcionário não encontrado." }, 404);
  const arq = gerarXlsx("Registros", COLUNAS, fs.map(f => linhaRegistro(f)));
  const nome = mat ? `registro-${mat}-${String(fs[0].nome || "").normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.xlsx` : `registros-${hojeISO()}.xlsx`;
  return new Response(arq, { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${nome}"`, "cache-control": "no-store"
  } });
}


// Currículos e documentos: dono (candidato), RH, ou gerente da vaga (só currículos).
// É aberto direto pelo navegador: em caso de erro, manda para a página de erro do frontend.
async function arquivo(request, env, id) {
  const erro = codigo => redirecionar("/erro?c=" + codigo);
  const a = await um(env, "SELECT * FROM arquivos WHERE id = ?", decodeURIComponent(id));
  if (!a) return erro(404);

  const cand = await candidatoDaSessao(env, request);
  if (cand && cand.id === a.candidato_id && a.categoria !== "etapa") return respostaArquivo(env, a);

  const s = await lerSessao(request, env);
  if (s.estado === "ok") {
    if (s.usuario.papel === "rh") return respostaArquivo(env, a);
    if (s.usuario.papel === "gerente" && a.categoria === "curriculos") {
      const ca = await um(env, "SELECT v.* FROM candidaturas c JOIN vagas v ON v.id = c.vaga_id WHERE c.curriculo_id = ?", a.id);
      if (ca && await podeVerVaga(env, s.usuario, ca)) return respostaArquivo(env, a);
    }
    if (s.usuario.papel === "gerente" && a.categoria === "etapa" && a.etapa_id) {
      const v = await um(env, "SELECT v.* FROM etapas e JOIN candidaturas c ON c.id = e.candidatura_id JOIN vagas v ON v.id = c.vaga_id WHERE e.id = ?", a.etapa_id);
      if (v && await podeVerVaga(env, s.usuario, v)) return respostaArquivo(env, a);
    }
  }
  return erro(403);
}
