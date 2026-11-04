// =====================================================================
//  Servidor Node (self-hosted, como o SAC) — vagas.innomaker.com.br
//
//  Roda o mesmo código de src/ que antes ia para o Cloudflare, trocando:
//    D1 (banco)        → SQLite em data/vagas.db            (servidor/banco.js)
//    R2 (arquivos)     → pasta data/arquivos/               (servidor/arquivos.js)
//    e-mail            → SMTP do .env (Gmail), nodemailer   (servidor/correio.js)
//    Cron Trigger      → relógio interno, de hora em hora (+ backup diário em data/backups)
//    [assets]          → public/ servido aqui mesmo
//
//  Inicie com: npm start  (ou docker compose up -d)
// =====================================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import { rotinaDiaria } from "../src/cron.js";
import { abrirBanco } from "./banco.js";
import { criarArmazenamento } from "./arquivos.js";
import { criarCorreio } from "./correio.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLICO = path.join(RAIZ, "public");
const DADOS = path.resolve(process.env.DATA_DIR || path.join(RAIZ, "data"));
const PORTA = Number(process.env.PORT ?? 3000);
const LIMITE_CORPO = 65 * 1024 * 1024;
const UMA_HORA = 60 * 60 * 1000;

const banco = abrirBanco(DADOS, path.join(RAIZ, "migrations"));
const env = Object.assign({}, process.env, {
  DB: banco,
  ARQUIVOS: criarArmazenamento(path.join(DADOS, "arquivos")),
  CORREIO: criarCorreio(process.env),
  // muda a cada reinício: os navegadores baixam CSS/JS novos depois de uma atualização
  VERSAO_ASSETS: process.env.VERSAO_ASSETS || Date.now().toString(36)
});

// ctx.waitUntil do Cloudflare: tarefas em segundo plano (e-mails) que não seguram a resposta
const pendentes = new Set();
const ctx = {
  waitUntil(p) {
    const t = Promise.resolve(p).catch(e => console.error("Tarefa em segundo plano falhou:", e)).finally(() => pendentes.delete(t));
    pendentes.add(t);
  },
  passThroughOnException() {}
};

// ---------- Arquivos estáticos (public/assets) ----------
const TIPOS = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8"
};

function estatico(req, res, caminhoUrl) {
  if (!caminhoUrl.startsWith("/assets/")) return false;
  let f;
  try { f = path.resolve(PUBLICO, "." + decodeURIComponent(caminhoUrl)); } catch (e) { return false; }
  if (!f.startsWith(PUBLICO + path.sep)) return false;
  let st;
  try { st = fs.statSync(f); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const cab = {
    "content-type": TIPOS[path.extname(f).toLowerCase()] || "application/octet-stream",
    "cache-control": "public, max-age=3600",
    "etag": etag,
    "x-content-type-options": "nosniff"
  };
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, cab); res.end(); return true; }
  res.writeHead(200, Object.assign(cab, { "content-length": st.size }));
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(f).pipe(res);
  return true;
}

// ---------- Node (http) ⇄ Request/Response do padrão web ----------
const SALTO = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "expect", "proxy-connection", "te", "trailer"]);

async function paraRequest(req) {
  // Atrás do Traefik: o Host original chega intacto e o protocolo vem em X-Forwarded-Proto
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
  const url = proto + "://" + (req.headers.host || "localhost") + req.url;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (SALTO.has(k) || v == null) continue;
    for (const x of [].concat(v)) headers.append(k, x);
  }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
  headers.set("cf-connecting-ip", ip);

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const partes = [];
    let total = 0;
    for await (const c of req) {
      total += c.length;
      if (total > LIMITE_CORPO) throw Object.assign(new Error("corpo grande demais"), { status: 413 });
      partes.push(c);
    }
    body = Buffer.concat(partes);
  }
  return new Request(url, { method: req.method, headers, body });
}

async function enviarResposta(res, r, metodo) {
  const cab = {};
  r.headers.forEach((v, k) => { if (k !== "set-cookie") cab[k] = v; });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) cab["set-cookie"] = cookies;
  res.writeHead(r.status, cab);
  if (!r.body || metodo === "HEAD") { res.end(); return; }
  Readable.fromWeb(r.body).on("error", () => res.destroy()).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  const caminhoUrl = (req.url || "/").split("?")[0];
  try {
    if (caminhoUrl === "/saude") {
      banco.db.prepare("SELECT 1").get();
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && estatico(req, res, caminhoUrl)) return;
    const r = await worker.fetch(await paraRequest(req), env, ctx);
    await enviarResposta(res, r, req.method);
  } catch (e) {
    if (e && e.status === 413) {
      res.writeHead(413, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, erro: "Os arquivos passam do limite total de 60 MB." }));
      return;
    }
    console.error("Erro na requisição", req.method, req.url, e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Erro interno.");
  }
});

// ---------- Rotina (no lugar do Cron Trigger) ----------
// Fecha vagas vencidas e avisa contratos perto do fim (as duas coisas só agem uma vez) e faz o backup do dia.
let rodando = false;
async function rotina() {
  if (rodando) return;
  rodando = true;
  try {
    await rotinaDiaria(env);
    const b = banco.backup();
    if (b) console.log("Backup do banco:", b);
  } catch (e) {
    console.error("Rotina falhou:", e);
  } finally {
    rodando = false;
  }
}
const relogio = setInterval(rotina, UMA_HORA);
const primeira = setTimeout(rotina, 15 * 1000);

servidor.listen(PORTA, () => {
  const p = servidor.address().port;
  console.log(`Vagas Innomaker no ar: http://localhost:${p}  (dados em ${DADOS})`);
  console.log("Login: Authelia " + (env.AUTHELIA_URL || "https://auth.innomaker.com.br") + (env.DEV_USUARIO_FALSO ? "  + usuário falso em localhost" : ""));
  console.log("E-mail: " + (env.CORREIO ? `SMTP ${env.SMTP_HOST || "smtp.gmail.com"} como ${env.SMTP_FROM || env.SMTP_USER}` : "sem SMTP (os e-mails ficam só no Histórico do painel)"));
});

// ---------- Desligar com calma (docker stop / Ctrl+C) ----------
async function desligar(sinal) {
  console.log(`\n${sinal}: desligando…`);
  clearInterval(relogio);
  clearTimeout(primeira);
  servidor.close();
  await Promise.race([Promise.allSettled([...pendentes]), new Promise(r => setTimeout(r, 10000))]);
  banco.fechar();
  process.exit(0);
}
process.on("SIGTERM", () => desligar("SIGTERM"));
process.on("SIGINT", () => desligar("SIGINT"));
