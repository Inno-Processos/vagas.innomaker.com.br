// Montagem das páginas (HTML) servidas pelo Worker.
import SITE_HTML from "../templates/site.html";
import PAINEL_HTML from "../templates/painel.html";
import { cfg, urlsLogin, SITE } from "./config.js";
import { acoesDoPapel } from "./papeis.js";

const json = v => JSON.stringify(v).replace(/</g, "\\u003c");

const HEADERS_HTML = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin"
};

export function paginaSite(env, boot) {
  const c = cfg(env);
  const html = SITE_HTML
    .replace(/__VERSAO__/g, () => c.versao)
    .replace("__BOOT__", () => json(Object.assign({}, SITE, boot)));
  return new Response(html, { headers: HEADERS_HTML });
}

export function paginaPainel(env, usuario) {
  const c = cfg(env);
  const { logoutUrl, loginUrl } = urlsLogin(c);
  const boot = {
    usuario,
    acoes: acoesDoPapel(usuario.papel),
    links: c.links,
    logoUrl: SITE.logoUrl,
    siteUrl: c.siteUrl,
    logoutUrl: "/sair",
    autheliaLogout: logoutUrl,
    loginUrl
  };
  const html = PAINEL_HTML
    .replace(/__VERSAO__/g, () => c.versao)
    .replace("__BOOT__", () => json(boot));
  return new Response(html, {
    headers: Object.assign({}, HEADERS_HTML, { "x-frame-options": "DENY" })
  });
}

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function paginaSimples(status, titulo, texto, botoes) {
  const html = `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} — Innomaker</title>
<style>
  :root{--green:#41A639;--dark:#111;--muted:rgba(36,33,34,.66);--border:rgba(0,0,0,.10)}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f4f2;color:var(--dark);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
  .box{max-width:560px;width:100%;background:#fff;border:1px solid var(--border);border-radius:20px;padding:34px}
  .codigo{font-size:13px;font-weight:800;color:var(--green);margin-bottom:10px}
  h1{margin:0 0 10px;font-size:30px;letter-spacing:-.8px;line-height:1.1}
  p{margin:0 0 22px;color:var(--muted);line-height:1.7;font-size:15px}
  .acoes{display:flex;gap:10px;flex-wrap:wrap}
  a{display:inline-flex;align-items:center;min-height:44px;padding:11px 20px;border-radius:999px;font-weight:800;font-size:14px;text-decoration:none}
  .prim{background:var(--green);color:#fff}.sec{border:1px solid var(--border);color:#222}
</style></head>
<body><div class="box">
  <div class="codigo">Erro ${status}</div>
  <h1>${esc(titulo)}</h1>
  <p>${esc(texto)}</p>
  <div class="acoes">${(botoes || []).map((b, i) => `<a class="${i ? "sec" : "prim"}" href="${esc(b.href)}">${esc(b.texto)}</a>`).join("")}</div>
</div></body></html>`;
  return new Response(html, { status, headers: HEADERS_HTML });
}

export function pagina403(env, usuario) {
  const quem = usuario && usuario.login ? `A conta "${usuario.login}"` : "Sua conta";
  return paginaSimples(403, "Acesso negado",
    `${quem} entrou no Authelia, mas não pertence a nenhum grupo com acesso ao painel (funcionário, gerente ou RH). Peça ao RH para incluir você no grupo correto.`,
    [{ href: "/", texto: "Voltar ao site de vagas" }, { href: "/sair", texto: "Sair e entrar com outra conta" }]);
}

export function paginaErro(status, texto) {
  return paginaSimples(status, "Algo deu errado", texto || "Tente novamente em instantes.",
    [{ href: "/", texto: "Voltar ao site de vagas" }]);
}
