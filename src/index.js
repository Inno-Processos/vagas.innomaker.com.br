// =====================================================================
//  Cloudflare Worker — vagas.innomaker.com.br
//
//  /                 site público de vagas (candidatos)
//  /painel           painel interno (login pelo Authelia)
//                      funcionário → área do colaborador
//                      gerente     → solicitar vaga e acompanhar solicitações
//                      RH          → gerenciar solicitações, vagas e admissões
//                      sem grupo   → 403
//  /api              API pública (inscrição, área do candidato) → Apps Script
//  /api/vagas        lista pública de vagas (cache)
//  /api/staff/<acao> API do painel (verifica sessão e papel) → Apps Script
//  /entrar, /sair    login e logout no Authelia
//  /assets/*         CSS/JS estáticos (pasta public/)
// =====================================================================
import { cfg, urlsLogin } from "./lib/config.js";
import { lerSessao, esquecerSessao, temCookieAuthelia } from "./lib/auth.js";
import { ACOES, podeExecutar, acoesDoPapel } from "./lib/papeis.js";
import { chamarBackend, proxyPublico } from "./lib/backend.js";
import { getVagas, atualizarVagas, limparCacheVagas } from "./lib/vagas.js";
import { paginaSite, paginaPainel, pagina403, paginaErro } from "./lib/paginas.js";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function redirecionar(url) {
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
}

// Só aceita POST do próprio site (evita que outra página use a sessão do funcionário)
function mesmaOrigem(request, url) {
  const origem = request.headers.get("origin");
  if (origem) return origem === url.origin;
  const sfs = request.headers.get("sec-fetch-site");
  return !sfs || sfs === "same-origin";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (p === "/api") {
        if (request.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);
        const tam = Number(request.headers.get("content-length") || 0);
        if (tam > MAX_UPLOAD_BYTES) return json({ ok: false, erro: "O arquivo é grande demais (máx. 10 MB)." }, 413);
        return new Response(await proxyPublico(env, request), {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
        });
      }

      if (p === "/api/vagas") {
        const d = await getVagas(env, url.origin, ctx);
        return json({ ok: !d.erro, vagas: d.vagas, erro: d.erro });
      }

      if (p.startsWith("/api/staff/")) return apiStaff(request, env, ctx, url, p.slice("/api/staff/".length));

      if (p === "/painel") {
        const s = await lerSessao(request, env);
        if (s.estado === "anonimo") return redirecionar(urlsLogin(cfg(env)).loginUrl);
        if (s.estado === "erro") return paginaErro(502, s.erro);
        if (s.estado !== "ok") return pagina403(env, s.usuario);
        return paginaPainel(env, s.usuario);
      }

      if (p === "/entrar") return redirecionar(urlsLogin(cfg(env)).loginUrl);

      if (p === "/sair") {
        await esquecerSessao(request, env);
        return redirecionar(urlsLogin(cfg(env)).logoutUrl);
      }

      if (p === "/favicon.ico") return new Response(null, { status: 204 });
      if (p !== "/") return redirecionar(url.origin + "/" + url.search);

      // ---------- Site público ----------
      const page = String(url.searchParams.get("page") || "home").toLowerCase();
      const params = {
        vaga_id: url.searchParams.get("vaga_id") || "",
        cand_id: url.searchParams.get("cand_id") || "",
        t: url.searchParams.get("t") || ""
      };

      let dados = await getVagas(env, url.origin, ctx);
      if (page === "vaga" && params.vaga_id && dados.idade > 10 && !dados.vagas.some(v => v.vaga_id === params.vaga_id)) {
        dados = await atualizarVagas(env, url.origin);
      }

      return paginaSite(env, {
        page, params,
        vagas: dados.vagas,
        erro: dados.erro,
        staff: { temSessao: temCookieAuthelia(request, env) }
      });
    } catch (e) {
      return paginaErro(500, "Erro interno: " + (e && e.message ? e.message : e));
    }
  }
};

async function apiStaff(request, env, ctx, url, acao) {
  if (request.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);
  if (!mesmaOrigem(request, url)) return json({ ok: false, erro: "Origem não permitida." }, 403);
  if (!ACOES[acao]) return json({ ok: false, erro: "Ação desconhecida." }, 404);

  const s = await lerSessao(request, env);
  if (s.estado === "anonimo") return json({ ok: false, sessaoExpirada: true, erro: "Faça login novamente.", loginUrl: urlsLogin(cfg(env)).loginUrl }, 401);
  if (s.estado === "erro") return json({ ok: false, erro: s.erro }, 502);
  if (s.estado !== "ok") return json({ ok: false, erro: "Acesso negado." }, 403);
  if (!podeExecutar(s.usuario.papel, acao)) return json({ ok: false, erro: "Seu perfil (" + s.usuario.papelNome + ") não pode fazer esta ação." }, 403);

  let dados = {};
  try { dados = await request.json(); } catch (e) { dados = {}; }

  if (acao === "me") return json({ ok: true, usuario: s.usuario, acoes: acoesDoPapel(s.usuario.papel) });

  if (acao === "vagas_abertas") {
    const d = await getVagas(env, url.origin, ctx);
    const site = cfg(env).siteUrl;
    return json({
      ok: !d.erro,
      erro: d.erro,
      vagas: d.vagas.map(v => ({
        vaga_id: v.vaga_id, titulo_vaga: v.titulo_vaga, localidade: v.localidade, tipo_vaga: v.tipo_vaga,
        tipo_contratacao: v.tipo_contratacao, carga_horaria: v.carga_horaria, remuneracao_bolsa: v.remuneracao_bolsa,
        data_limite_inscricao: v.data_limite_inscricao,
        link: site + "/?page=vaga&vaga_id=" + encodeURIComponent(v.vaga_id) + "&t=" + encodeURIComponent(v.t)
      }))
    });
  }

  const def = ACOES[acao];
  const res = await chamarBackend(env, def.backend, def.action, dados, s.usuario);
  if (def.limpaCacheVagas && res && res.ok) ctx.waitUntil(limparCacheVagas(url.origin));
  return json(res, res && res.ok === false && res.status === 403 ? 403 : 200);
}
