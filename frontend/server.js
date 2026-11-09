// =====================================================================
//  FRONTEND — páginas do sistema de vagas (porta 3000; é o que o Traefik publica)
//
//  Entrega as telas de public/ e repassa ao backend só o que é dele:
//    /api/*, /arquivo/*, /entrar, /sair   →  API_URL (backend, rede interna)
//
//  Páginas:  /  (site público)   /painel   /documento/<id>   /agendar/<token>   /privacidade   /erro
//  Inicie com: npm start (na raiz sobe backend + frontend) ou docker compose up -d
// =====================================================================
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORTA = Number(process.env.WEB_PORT ?? 3000);
const API = new URL(process.env.API_URL || "http://127.0.0.1:3001");
const PUBLICO = path.join(__dirname, "public");
// muda a cada reinício: os navegadores baixam CSS/JS novos depois de uma atualização
const VERSAO = process.env.VERSAO_ASSETS || Date.now().toString(36);

const PAGINAS = {
  "/": "index.html",
  "/painel": "painel.html",
  "/documento": "documento.html",
  "/erro": "erro.html",
  "/privacidade": "privacidade.html"
};
const PROTEGIDAS = new Set(["painel.html", "documento.html", "agendar.html"]); // não podem abrir dentro de outro site (iframe)

const TIPOS = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8"
};

const CAB_SEGURANCA = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };

// As páginas são lidas uma vez e guardadas com a versão dos arquivos já trocada
const cachePaginas = new Map();
function pagina(arquivo) {
  if (!cachePaginas.has(arquivo)) {
    const html = fs.readFileSync(path.join(PUBLICO, arquivo), "utf8").replace(/__VERSAO__/g, VERSAO);
    cachePaginas.set(arquivo, html);
  }
  return cachePaginas.get(arquivo);
}

function enviarPagina(res, arquivo, metodo) {
  const cab = Object.assign({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }, CAB_SEGURANCA);
  if (PROTEGIDAS.has(arquivo)) cab["x-frame-options"] = "DENY";
  res.writeHead(200, cab);
  res.end(metodo === "HEAD" ? undefined : pagina(arquivo));
}

function estatico(req, res, caminho) {
  if (!caminho.startsWith("/assets/")) return false;
  let f;
  try { f = path.resolve(PUBLICO, "." + decodeURIComponent(caminho)); } catch (e) { return false; }
  if (!f.startsWith(path.join(PUBLICO, "assets") + path.sep)) return false;
  let st;
  try { st = fs.statSync(f); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const cab = Object.assign({
    "content-type": TIPOS[path.extname(f).toLowerCase()] || "application/octet-stream",
    "cache-control": "public, max-age=3600",
    "etag": etag
  }, CAB_SEGURANCA);
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, cab); res.end(); return true; }
  res.writeHead(200, Object.assign(cab, { "content-length": st.size }));
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(f).pipe(res);
  return true;
}

// Repassa ao backend sem ler o corpo (uploads grandes passam direto), mantendo Host e protocolo originais
function repassar(req, res) {
  const cab = Object.assign({}, req.headers);
  const ipCliente = req.socket.remoteAddress || "";
  cab["x-forwarded-for"] = req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"] + ", " + ipCliente : ipCliente;
  cab["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "http";
  const pedido = http.request({ hostname: API.hostname, port: API.port || 80, path: req.url, method: req.method, headers: cab }, r => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  pedido.setTimeout(120000, () => pedido.destroy(new Error("tempo esgotado")));
  pedido.on("error", e => {
    console.error("Backend não respondeu:", req.method, req.url, e.message);
    if (res.headersSent) { res.destroy(); return; }
    // 503 + "reiniciando": as telas tentam de novo sozinhas por alguns segundos
    res.writeHead(503, { "content-type": "application/json; charset=utf-8", "retry-after": "3" });
    res.end(JSON.stringify({ ok: false, reiniciando: true, erro: "O sistema está reiniciando. Tente de novo em alguns segundos." }));
  });
  req.pipe(pedido);
}

const ehDoBackend = c => c.startsWith("/api/") || c.startsWith("/arquivo/") || c === "/entrar" || c === "/sair";

const servidor = http.createServer((req, res) => {
  const caminho = (req.url || "/").split("?")[0];
  try {
    if (caminho === "/saude") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); return; }
    if (ehDoBackend(caminho)) return repassar(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return; }
    if (estatico(req, res, caminho)) return;
    if (caminho === "/favicon.ico") { res.writeHead(204); res.end(); return; }

    const limpo = caminho.replace(/\/+$/, "") || "/";
    if (PAGINAS[limpo]) return enviarPagina(res, PAGINAS[limpo], req.method);
    if (limpo.startsWith("/documento/")) return enviarPagina(res, "documento.html", req.method);
    if (limpo.startsWith("/agendar/")) return enviarPagina(res, "agendar.html", req.method);

    // Qualquer outro endereço volta para o site
    res.writeHead(302, { location: "/" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "") });
    res.end();
  } catch (e) {
    console.error("Erro no frontend", req.method, req.url, e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Erro interno.");
  }
});

servidor.listen(PORTA, () => {
  console.log(`Frontend no ar: http://localhost:${servidor.address().port}  (API: ${API.origin})`);
});

function desligar(sinal) {
  console.log(`\n${sinal}: desligando o frontend…`);
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => desligar("SIGTERM"));
process.on("SIGINT", () => desligar("SIGINT"));
