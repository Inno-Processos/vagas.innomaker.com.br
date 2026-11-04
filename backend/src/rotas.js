// =====================================================================
//  Cloudflare Worker — vagas.innomaker.com.br
//  Tudo roda aqui: site, área do candidato, painel interno, banco (D1),
//  arquivos (R2) e e-mails. Sem Google Apps Script e sem Google Forms.
//
//  /                       site público de vagas
//  /painel                 painel interno (login Authelia: funcionário, gerente, RH; sem grupo → 403)
//  /documento/<id>         leitura e assinatura de documentos
//  /arquivo/<id>           download de currículos e documentos (com permissão)
//  /api/vagas              vagas abertas (JSON)
//  /api/candidato/<acao>   inscrição e área do candidato
//  /api/staff/<acao>       painel interno
//  /entrar, /sair          login e logout no Authelia
// =====================================================================
import { cfg, urlsLogin } from "./lib/config.js";
import { lerSessao, esquecerSessao } from "./lib/auth.js";
import { ACOES, podeExecutar } from "./lib/papeis.js";
import { json, redirecionar, mesmaOrigem, lerJson, lerCookie } from "./lib/http.js";
import { um, lerConfig } from "./lib/db.js";
import { candidatoDaSessao, COOKIE_CANDIDATO } from "./lib/senha.js";
import { respostaArquivo } from "./lib/arquivos.js";
import { paginaSite, paginaPainel, pagina403, paginaErro, paginaDocumento } from "./lib/paginas.js";
import { apiCandidato, vagasPublicas } from "./api/candidato.js";
import { apiStaff, podeVerVaga } from "./api/staff.js";
import { rotinaDiaria } from "./cron.js";

const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (p === "/api/vagas") return json({ ok: true, vagas: await vagasPublicas(env) });

      if (p.startsWith("/api/candidato/")) {
        if (request.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);
        if (!mesmaOrigem(request, url)) return json({ ok: false, erro: "Origem não permitida." }, 403);
        if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD_BYTES) {
          return json({ ok: false, erro: "Os arquivos passam do limite total de 60 MB." }, 413);
        }
        return apiCandidato(request, env, ctx, p.slice("/api/candidato/".length));
      }

      if (p.startsWith("/api/staff/")) return staff(request, env, ctx, url, p.slice("/api/staff/".length));

      if (p === "/painel") {
        const s = await lerSessao(request, env);
        if (s.estado === "anonimo") return redirecionar(urlsLogin(cfg(env)).loginUrl);
        if (s.estado === "erro") return paginaErro(502, s.erro);
        if (s.estado !== "ok") return pagina403(env, s.usuario);
        return paginaPainel(env, s.usuario, await lerConfig(env));
      }

      if (p.startsWith("/documento/")) return documento(request, env, p.slice("/documento/".length));
      if (p.startsWith("/arquivo/")) return arquivo(request, env, p.slice("/arquivo/".length));

      if (p === "/entrar") return redirecionar(urlsLogin(cfg(env)).loginUrl);
      if (p === "/sair") {
        await esquecerSessao(request, env);
        return redirecionar(urlsLogin(cfg(env)).logoutUrl);
      }
      if (p === "/favicon.ico") return new Response(null, { status: 204 });
      if (p !== "/") return redirecionar(url.origin + "/" + url.search);

      // ---------- Site público ----------
      const cand = lerCookie(request.headers.get("cookie"), COOKIE_CANDIDATO) ? await candidatoDaSessao(env, request) : null;
      return paginaSite(env, {
        page: String(url.searchParams.get("page") || "home").toLowerCase(),
        params: { vaga_id: url.searchParams.get("vaga_id") || "" },
        vagas: await vagasPublicas(env),
        candidato: cand ? { nome: cand.nome, email: cand.email, telefone: cand.telefone } : null,
        staff: { temSessao: !!lerCookie(request.headers.get("cookie"), cfg(env).autheliaCookie) }
      });
    } catch (e) {
      console.log("erro", p, e && e.stack);
      // Nas rotas de API a tela espera JSON: devolve a mensagem em JSON, não uma página HTML
      if (p.startsWith("/api/")) return json({ ok: false, erro: "Erro interno no servidor. Tente novamente em instantes." }, 500);
      return paginaErro(500, "Erro interno. Tente novamente em instantes.");
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(rotinaDiaria(env));
  }
};

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
  return apiStaff(env, ctx, acao, await lerJson(request), s.usuario);
}

// Quem pode ver: o próprio candidato ou o RH
async function documento(request, env, id) {
  const doc = await um(env, "SELECT * FROM documentos WHERE id = ?", decodeURIComponent(id));
  if (!doc) return paginaErro(404, "Documento não encontrado.");

  const cand = await candidatoDaSessao(env, request);
  if (cand && cand.id === doc.candidato_id) {
    return paginaDocumento(doc, { podeAssinar: true, voltar: "/?page=acompanhar" });
  }
  const s = await lerSessao(request, env);
  if (s.estado === "ok" && s.usuario.papel === "rh") {
    return paginaDocumento(doc, { podeAssinar: false, voltar: "/painel#funcionario/" + (doc.funcionario_matricula || "") });
  }
  if (s.estado === "anonimo" && !cand) return redirecionar("/?page=acompanhar");
  return paginaErro(403, "Você não tem acesso a este documento.");
}

// Currículos e documentos: dono (candidato), RH, ou gerente da vaga (só currículos)
async function arquivo(request, env, id) {
  const a = await um(env, "SELECT * FROM arquivos WHERE id = ?", decodeURIComponent(id));
  if (!a) return paginaErro(404, "Arquivo não encontrado.");

  const cand = await candidatoDaSessao(env, request);
  if (cand && cand.id === a.candidato_id) return respostaArquivo(env, a);

  const s = await lerSessao(request, env);
  if (s.estado === "ok") {
    if (s.usuario.papel === "rh") return respostaArquivo(env, a);
    if (s.usuario.papel === "gerente" && a.categoria === "curriculos") {
      const ca = await um(env, "SELECT v.* FROM candidaturas c JOIN vagas v ON v.id = c.vaga_id WHERE c.curriculo_id = ?", a.id);
      if (ca && await podeVerVaga(env, s.usuario, ca)) return respostaArquivo(env, a);
    }
  }
  return paginaErro(403, "Você não tem acesso a este arquivo.");
}
