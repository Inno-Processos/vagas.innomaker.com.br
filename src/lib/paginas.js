// Montagem das páginas (HTML) servidas pelo Worker.
import SITE_HTML from "../templates/site.html";
import PAINEL_HTML from "../templates/painel.html";
import { cfg, urlsLogin, SITE } from "./config.js";
import { acoesDoPapel } from "./papeis.js";
import { HEADERS_HTML, esc, dataHoraBR } from "./http.js";
import { textoParaHtml } from "./documentos.js";

const json = v => JSON.stringify(v).replace(/</g, "\\u003c");

export function paginaSite(env, boot) {
  const c = cfg(env);
  const html = SITE_HTML.replace(/__VERSAO__/g, () => c.versao).replace("__BOOT__", () => json(Object.assign({}, SITE, boot)));
  return new Response(html, { headers: HEADERS_HTML });
}

export function paginaPainel(env, usuario, config) {
  const c = cfg(env);
  const boot = {
    usuario,
    acoes: acoesDoPapel(usuario.papel),
    links: config.links_colaborador || [],
    logoUrl: SITE.logoUrl,
    siteUrl: c.siteUrl,
    loginUrl: urlsLogin(c).loginUrl
  };
  const html = PAINEL_HTML.replace(/__VERSAO__/g, () => c.versao).replace("__BOOT__", () => json(boot));
  return new Response(html, { headers: Object.assign({}, HEADERS_HTML, { "x-frame-options": "DENY" }) });
}

const ESTILO = `
  :root{--green:#41A639;--dark:#111;--muted:rgba(36,33,34,.66);--border:rgba(0,0,0,.10)}
  *{box-sizing:border-box}
  body{margin:0;background:#f4f4f2;color:var(--dark);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
  a{color:#2f7d29}
`;

function paginaSimples(status, titulo, textoLivre, botoes) {
  const html = `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(titulo)} — Innomaker</title>
<style>${ESTILO}
  body{min-height:100vh;display:grid;place-items:center;padding:24px}
  .box{max-width:560px;width:100%;background:#fff;border:1px solid var(--border);border-radius:20px;padding:34px}
  .codigo{font-size:13px;font-weight:800;color:var(--green);margin-bottom:10px}
  h1{margin:0 0 10px;font-size:30px;letter-spacing:-.8px;line-height:1.1}
  p{margin:0 0 22px;color:var(--muted);line-height:1.7;font-size:15px}
  .acoes{display:flex;gap:10px;flex-wrap:wrap}
  .acoes a{display:inline-flex;align-items:center;min-height:44px;padding:11px 20px;border-radius:999px;font-weight:800;font-size:14px;text-decoration:none}
  .prim{background:var(--green);color:#fff}.sec{border:1px solid var(--border);color:#222}
</style></head>
<body><div class="box">
  <div class="codigo">Erro ${status}</div>
  <h1>${esc(titulo)}</h1>
  <p>${esc(textoLivre)}</p>
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

export function paginaErro(status, textoLivre) {
  return paginaSimples(status, status === 404 ? "Não encontrado" : "Algo deu errado", textoLivre || "Tente novamente em instantes.",
    [{ href: "/", texto: "Voltar ao site de vagas" }]);
}

// Documento para leitura, impressão e assinatura eletrônica
export function paginaDocumento(doc, opts) {
  const assinado = doc.status === "ASSINADO";
  const cancelado = doc.status === "CANCELADO";
  const cpf = String(doc.assinado_cpf || "").replace(/^(\d{3})\d{6}(\d{2})$/, "$1.***.***-$2");
  const rodape = assinado
    ? `<div class="assinatura"><b>Assinado eletronicamente</b> por ${esc(doc.assinado_nome)} (CPF ${esc(cpf)}) em ${esc(dataHoraBR(doc.assinado_em))}, IP ${esc(doc.assinado_ip || "—")}.<br>Código de verificação: <code>${esc(doc.hash)}</code></div>`
    : cancelado ? `<div class="assinatura aviso">Documento cancelado pelo RH.</div>`
    : `<div class="assinatura aviso">Aguardando assinatura. Código do documento: <code>${esc(doc.hash.slice(0, 16))}</code></div>`;

  const form = opts.podeAssinar && !assinado && !cancelado ? `
  <form id="assinar" class="assinar no-print">
    <h2>Assinar eletronicamente</h2>
    <p>Leia todo o documento. Para assinar, digite seu nome completo e CPF exatamente como no cadastro.</p>
    <label>Nome completo<input name="nome" required autocomplete="name"></label>
    <label>CPF<input name="cpf" required inputmode="numeric" placeholder="000.000.000-00"></label>
    <label class="check"><input type="checkbox" name="concordo"> Li o documento e concordo com todos os termos.</label>
    <div id="msg"></div>
    <button type="submit">Assinar documento</button>
  </form>
  <script>
    document.getElementById("assinar").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      const f = ev.target, msg = document.getElementById("msg"), bt = f.querySelector("button");
      bt.disabled = true; bt.textContent = "Assinando…"; msg.textContent = "";
      try {
        const r = await fetch("/api/candidato/assinar", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ documento_id: ${JSON.stringify(doc.id)}, nome: f.nome.value, cpf: f.cpf.value, concordo: f.concordo.checked }) });
        const j = await r.json();
        if (j.ok) return location.reload();
        msg.textContent = j.erro || "Não foi possível assinar.";
      } catch (e) { msg.textContent = "Falha de conexão. Tente novamente."; }
      bt.disabled = false; bt.textContent = "Assinar documento";
    });
  </script>` : "";

  const html = `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(doc.titulo)} — Innomaker</title>
<style>${ESTILO}
  .barra{display:flex;gap:10px;justify-content:space-between;align-items:center;max-width:860px;margin:20px auto 0;padding:0 16px}
  .barra a,.barra button{font:inherit;font-size:14px;font-weight:700;padding:9px 16px;border-radius:999px;border:1px solid var(--border);background:#fff;color:#222;text-decoration:none;cursor:pointer}
  .folha{max-width:860px;margin:14px auto 40px;background:#fff;border:1px solid var(--border);border-radius:6px;padding:56px 64px}
  .topo{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid var(--green);padding-bottom:14px;margin-bottom:28px;font-weight:800;letter-spacing:3px}
  .topo span{font-size:12px;letter-spacing:0;font-weight:600;color:var(--muted)}
  .texto{font-family:Georgia,"Times New Roman",serif;font-size:15.5px;line-height:1.75;color:#1b1b1b}
  .texto h2{font-family:inherit;text-align:center;font-size:19px;margin:0 0 22px}
  .texto h3{font-size:16px;margin:22px 0 8px}
  .texto p{margin:0 0 14px;text-align:justify}
  .assinatura{margin-top:34px;padding:14px 16px;border:1px solid #cfe6cb;background:#eef7ec;border-radius:8px;font-size:13px;line-height:1.6}
  .assinatura.aviso{border-color:#f0cf8f;background:#fff6e5}
  code{font-size:11.5px;word-break:break-all}
  .assinar{max-width:860px;margin:0 auto 60px;background:#fff;border:2px solid var(--green);border-radius:16px;padding:24px 28px}
  .assinar h2{margin:0 0 6px;font-size:20px}
  .assinar p{margin:0 0 16px;color:var(--muted)}
  .assinar label{display:block;font-weight:700;font-size:14px;margin-bottom:12px}
  .assinar input:not([type=checkbox]){display:block;width:100%;margin-top:6px;padding:11px 12px;border:1px solid #cfd4cf;border-radius:10px;font:inherit}
  .assinar .check{display:flex;gap:10px;align-items:flex-start;font-weight:600}
  .assinar .check input{width:18px;height:18px;margin-top:2px;accent-color:var(--green)}
  .assinar button{margin-top:8px;padding:13px 22px;border:0;border-radius:999px;background:var(--green);color:#fff;font:inherit;font-weight:800;cursor:pointer}
  #msg{color:#b42318;font-weight:700;min-height:1.2em}
  @media(max-width:700px){.folha{padding:28px 20px}.assinar{margin:0 12px 40px}}
  @media print{body{background:#fff}.no-print,.barra{display:none!important}.folha{border:0;margin:0;padding:0;max-width:none}}
</style></head>
<body>
  <div class="barra no-print"><a href="${esc(opts.voltar || "/")}">← Voltar</a><button onclick="window.print()">Imprimir / salvar PDF</button></div>
  <article class="folha">
    <div class="topo">INNOMAKER<span>${esc(doc.titulo)}</span></div>
    <div class="texto">${textoParaHtml(doc.conteudo)}</div>
    ${rodape}
  </article>
  ${form}
</body></html>`;
  return new Response(html, { headers: Object.assign({}, HEADERS_HTML, { "x-frame-options": "DENY" }) });
}
