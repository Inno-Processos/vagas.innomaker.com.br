#!/usr/bin/env node
// =====================================================================
//  Assistente de configuração — rode com:  npm run cf:configurar
//
//  Faz no Cloudflare, nesta ordem:
//   1. login na conta
//   2. banco D1 "vagas-db" (cria se não existir e grava o ID no wrangler.toml)
//   3. armazenamento R2 "vagas-arquivos"
//   4. tabelas do banco (migrações)
//   5. segredos: SESSION_SECRET (gerado) e SMTP_PASS (você cola)
//   6. publica o sistema em vagas.innomaker.com.br
//  Pode rodar de novo quantas vezes quiser: o que já existe é mantido.
// =====================================================================
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import readline from "node:readline/promises";

const TOML = new URL("../wrangler.toml", import.meta.url);
const BANCO = "vagas-db";
const BUCKET = "vagas-arquivos";
const WORKER = "vagas";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function wrangler(args, opts) {
  return spawnSync("npx", ["wrangler", ...args], Object.assign({ encoding: "utf8", shell: process.platform === "win32" }, opts || {}));
}
const interativo = args => wrangler(args, { stdio: "inherit" });
const passo = (n, t) => console.log(`\n━━━ ${n}/6  ${t} ━━━`);
const ok = t => console.log("✅ " + t);
function parar(msg, r) {
  console.error("\n❌ " + msg);
  if (r) console.error(String(r.stderr || "") + String(r.stdout || ""));
  rl.close();
  process.exit(1);
}

let toml = fs.readFileSync(TOML, "utf8");
const salvarToml = () => fs.writeFileSync(TOML, toml);

// ---------- 1. Login ----------
passo(1, "Conta Cloudflare");
let r = wrangler(["whoami"]);
if (/not authenticated|not logged in/i.test(r.stdout + r.stderr)) {
  console.log("Vai abrir o navegador para você entrar na conta Cloudflare da Innomaker…");
  interativo(["login"]);
  r = wrangler(["whoami"]);
}
const contas = [...new Set((r.stdout.match(/[0-9a-f]{32}/g) || []))];
if (!contas.length) parar("Não consegui identificar a conta. Rode `npx wrangler login` e tente de novo.", r);
let conta = contas[0];
if (contas.length > 1) {
  console.log(r.stdout);
  const escolha = (await rl.question("Você tem mais de uma conta. Cole o Account ID da conta da Innomaker: ")).trim();
  if (contas.indexOf(escolha) < 0) parar("Account ID inválido.");
  conta = escolha;
}
process.env.CLOUDFLARE_ACCOUNT_ID = conta;
if (/^account_id\s*=/m.test(toml)) toml = toml.replace(/^account_id\s*=.*$/m, `account_id = "${conta}"`);
else toml = toml.replace(/^main = .*$/m, m => m + `\naccount_id = "${conta}"`);
salvarToml();
ok("Conta " + conta);

// ---------- 2. Banco D1 ----------
passo(2, "Banco de dados D1");
const listarBancos = () => {
  const x = wrangler(["d1", "list", "--json"]);
  try { return JSON.parse(x.stdout); } catch (e) { parar("Não consegui listar os bancos D1.", x); }
};
let banco = listarBancos().find(b => b.name === BANCO);
if (!banco) {
  console.log("Criando o banco " + BANCO + "…");
  const c = wrangler(["d1", "create", BANCO]);
  if (c.status !== 0) parar("Não consegui criar o banco.", c);
  banco = listarBancos().find(b => b.name === BANCO);
}
if (!banco) parar("O banco não apareceu na conta.");
toml = toml.replace(/database_id = "[^"]*".*$/m, `database_id = "${banco.uuid}"`);
salvarToml();
ok("Banco " + BANCO + " (" + banco.uuid + ") — ID gravado no wrangler.toml");

// ---------- 3. R2 ----------
passo(3, "Armazenamento de arquivos R2");
r = wrangler(["r2", "bucket", "list"]);
if (/enable R2|R2 is not enabled|10042/i.test(r.stdout + r.stderr)) {
  parar("O R2 ainda não está ativado na conta. No painel do Cloudflare abra R2 → \"Começar a usar\" (é gratuito até 10 GB, mas pede um cartão), depois rode este assistente de novo.");
}
if (r.status !== 0) parar("Não consegui listar os buckets R2.", r);
if (r.stdout.indexOf(BUCKET) < 0) {
  const c = wrangler(["r2", "bucket", "create", BUCKET]);
  if (c.status !== 0) parar("Não consegui criar o bucket.", c);
}
ok("Bucket " + BUCKET);

// ---------- 4. Tabelas ----------
passo(4, "Tabelas do banco");
r = wrangler(["d1", "migrations", "apply", BANCO, "--remote"], { input: "y\n" });
if (r.status !== 0) parar("As migrações falharam.", r);
ok("Tabelas criadas/atualizadas");

// ---------- 5. Segredos ----------
passo(5, "Segredos do Worker");
r = wrangler(["secret", "list", "--name", WORKER]);
const existentes = (r.stdout || "") + (r.stderr || "");
const colocar = (nome, valor) => {
  const x = wrangler(["secret", "put", nome, "--name", WORKER], { input: valor + "\n" });
  if (x.status !== 0) parar("Não consegui gravar o segredo " + nome + ".", x);
};
if (existentes.indexOf("SESSION_SECRET") >= 0) {
  ok("SESSION_SECRET já existe (mantido)");
} else {
  colocar("SESSION_SECRET", crypto.randomBytes(32).toString("hex"));
  ok("SESSION_SECRET gerado");
}
const temSmtp = existentes.indexOf("SMTP_PASS") >= 0;
const chave = (await rl.question(
  (temSmtp ? "SMTP_PASS já existe. Cole uma nova senha de app para trocar ou aperte Enter para manter: "
            : "Cole a senha de app do Gmail rh.innomaker@gmail.com (16 letras) ou aperte Enter para configurar depois: "))).replace(/\s+/g, "");
if (chave) {
  if (!/^[a-z]{16}$/i.test(chave)) parar("Essa não parece uma senha de app do Google (são 16 letras, ex.: abcd efgh ijkl mnop).");
  colocar("SMTP_PASS", chave);
  ok("SMTP_PASS gravada");
} else if (!temSmtp) {
  console.log("⚠️  Sem a senha de app do Gmail, os e-mails ficam só registrados no Histórico do painel.");
}

// ---------- 6. Publicar ----------
passo(6, "Publicar em vagas.innomaker.com.br");
r = interativo(["deploy"]);
if (r.status !== 0) parar("A publicação falhou (veja a mensagem acima).");
ok("Sistema publicado");

rl.close();
console.log(`
━━━ Concluído ━━━
Próximos passos:
  1. Salve o wrangler.toml no GitHub (ele agora tem o ID do banco):
       git add wrangler.toml && git commit -m "Configura banco D1" && git push
  2. Abra https://vagas.innomaker.com.br/painel → Configurações:
       • confira o e-mail do RH e clique em "Enviar e-mail de teste"
       • cadastre departamentos e gestores, listas e os modelos de documento
`);
