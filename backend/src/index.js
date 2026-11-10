// =====================================================================
//  BACKEND — API do sistema de vagas (porta 3001, só na rede interna)
//
//  Regras de negócio em api/ e lib/; rotas em rotas.js. Aqui ficam:
//    banco      → SQLite em data/vagas.db          (infra/banco.js)
//    arquivos   → pasta data/arquivos/             (infra/arquivos.js)
//    e-mail     → SMTP do .env (Gmail), nodemailer (infra/correio.js)
//    rotina     → de hora em hora: vagas vencidas, contratos perto do fim, backup diário
//
//  Quem fala com o navegador é o frontend; ele repassa /api, /arquivo, /entrar e /sair para cá.
//  Inicie com: npm start (na raiz sobe backend + frontend) ou docker compose up -d
// =====================================================================
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { rotear } from "./rotas.js";
import { rotinaDiaria } from "./cron.js";
import { abrirBanco } from "./infra/banco.js";
import { criarArmazenamento } from "./infra/arquivos.js";
import { criarCorreio } from "./infra/correio.js";
import { criarBackupExterno } from "./infra/backupExterno.js";
import { enviarEmail, layout, textoSimples, reenviarEmails } from "./lib/email.js";
import { lerConfig } from "./lib/db.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DADOS = path.resolve(process.env.DATA_DIR || path.join(RAIZ, "..", "data"));
const PORTA = Number(process.env.API_PORT ?? 3001);
const LIMITE_CORPO = 65 * 1024 * 1024;
const UMA_HORA = 60 * 60 * 1000;

const banco = abrirBanco(DADOS, path.join(RAIZ, "migrations"));
const env = Object.assign({}, process.env, {
  DB: banco,
  ARQUIVOS: criarArmazenamento(path.join(DADOS, "arquivos")),
  CORREIO: criarCorreio(process.env),
  BACKUP: criarBackupExterno(DADOS, process.env.BACKUP_EXTERNO_DIR ? path.resolve(process.env.BACKUP_EXTERNO_DIR) : "")
});

// Tarefas em segundo plano (e-mails) que não seguram a resposta
const pendentes = new Set();
const ctx = {
  waitUntil(p) {
    const t = Promise.resolve(p).catch(e => console.error("Tarefa em segundo plano falhou:", e)).finally(() => pendentes.delete(t));
    pendentes.add(t);
  }
};

// ---------- Node (http) ⇄ Request/Response do padrão web ----------
const SALTO = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "expect", "proxy-connection", "te", "trailer"]);

async function paraRequest(req) {
  // O frontend repassa o Host original e o protocolo (X-Forwarded-Proto, vindo do Traefik)
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
  const url = proto + "://" + (req.headers.host || "localhost") + req.url;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (SALTO.has(k) || v == null) continue;
    for (const x of [].concat(v)) headers.append(k, x);
  }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
  headers.set("cf-connecting-ip", ip); // IP do candidato (registrado nas assinaturas)

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

const json = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };

const servidor = http.createServer(async (req, res) => {
  try {
    if ((req.url || "").split("?")[0] === "/saude") {
      banco.db.prepare("SELECT 1").get();
      return json(res, 200, { ok: true });
    }
    await enviarResposta(res, await rotear(await paraRequest(req), env, ctx), req.method);
  } catch (e) {
    if (e && e.status === 413) return json(res, 413, { ok: false, erro: "Os arquivos passam do limite total de 60 MB." });
    console.error("Erro na requisição", req.method, req.url, e);
    if (!res.headersSent) json(res, 500, { ok: false, erro: "Erro interno no servidor." });
    else res.end();
  }
});

// ---------- Rotina de hora em hora ----------
// Fecha vagas vencidas e avisa contratos perto do fim (as duas coisas só agem uma vez) e faz o backup do dia.
let rodando = false;
async function rotina() {
  if (rodando) return;
  rodando = true;
  try {
    // a rotina (vagas, avisos, LGPD) não pode impedir o backup: cada parte tem o seu try
    try { await rotinaDiaria(env); } catch (e) { console.error("Rotina falhou:", e); }
    try {
      const b = banco.backup();
      if (b) console.log("Backup do banco:", b);
    } catch (e) {
      console.error("Backup do banco falhou:", e);
      await avisarFalhaBackup({ dia: "banco-" + new Date().toISOString().slice(0, 10), erro: "backup do banco: " + (e && e.message || e) }).catch(() => {});
    }
    try {
      const ext = await env.BACKUP.copiar();
      if (ext && ext.ok) console.log("Cópia externa:", env.BACKUP.destino, ext.arquivos);
      if (ext && !ext.ok) await avisarFalhaBackup(ext);
    } catch (e) { console.error("Cópia externa falhou:", e); }
  } finally {
    rodando = false;
  }
}

// E-mails que falharam: nova tentativa a cada 5 minutos
const filaEmails = setInterval(() => { reenviarEmails(env).catch(e => console.error("Reenvio de e-mails falhou:", e)); }, 5 * 60 * 1000);
// Cópia externa falhou: avisa o RH (uma vez por dia)
let avisoBackupDia = "";
async function avisarFalhaBackup(s) {
  console.error("Cópia externa do backup falhou:", s.erro);
  if (avisoBackupDia === s.dia) return;
  avisoBackupDia = s.dia;
  const config = await lerConfig(env);
  if (!config.email_rh) return;
  const ps = ["A cópia do backup para fora do servidor não foi feita hoje.", "<b>Erro:</b> " + String(s.erro).replace(/[<>&]/g, ""),
    s.ultimoOk ? "Última cópia que deu certo: " + new Date(s.ultimoOk).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Ainda não houve cópia que desse certo.",
    "Peça para quem cuida do servidor conferir se o disco/pasta de destino está montado (BACKUP_EXTERNO_DIR)."];
  await enviarEmail(env, { para: config.email_rh, assunto: "Atenção: backup externo do sistema de vagas falhou",
    html: layout({ titulo: "Backup externo falhou", paragrafos: ps }), texto: textoSimples("Backup externo falhou", ps) });
}

const relogio = setInterval(rotina, UMA_HORA);
filaEmails.unref && filaEmails.unref();
const primeira = setTimeout(rotina, 15 * 1000);

servidor.listen(PORTA, () => {
  console.log(`Backend (API) no ar: http://localhost:${servidor.address().port}  (dados em ${DADOS})`);
  console.log("Login: Authelia " + (env.AUTHELIA_URL || "https://auth.innomaker.com.br") + (env.DEV_USUARIO_FALSO ? "  + usuário falso em localhost" : ""));
  console.log("Backup externo: " + (env.BACKUP.destino || "NÃO configurado (defina BACKUP_EXTERNO_DIR)"));
  console.log("E-mail: " + (env.CORREIO ? `SMTP ${env.SMTP_HOST || "smtp.gmail.com"} como ${env.SMTP_FROM || env.SMTP_USER}` : "sem SMTP (os e-mails ficam só no Histórico do painel)"));
});

// ---------- Desligar com calma (docker stop / Ctrl+C) ----------
async function desligar(sinal) {
  console.log(`\n${sinal}: desligando o backend…`);
  clearInterval(relogio);
  clearInterval(filaEmails);
  clearTimeout(primeira);
  servidor.close();
  await Promise.race([Promise.allSettled([...pendentes]), new Promise(r => setTimeout(r, 10000))]);
  banco.fechar();
  process.exit(0);
}
process.on("SIGTERM", () => desligar("SIGTERM"));
process.on("SIGINT", () => desligar("SIGINT"));
