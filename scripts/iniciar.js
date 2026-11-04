// Sobe backend (API, porta 3001) e frontend (telas, porta 3000) num terminal só.
//   npm start          → normal
//   npm run dev        → reinicia sozinho quando você salva um arquivo
// Ctrl+C desliga os dois.
"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const watch = process.argv.includes("--watch") ? ["--watch"] : [];
const partes = [
  { nome: "backend ", cor: "\x1b[36m", pasta: "backend", args: [...watch, "--disable-warning=ExperimentalWarning", "--env-file-if-exists=.env", "src/index.js"] },
  { nome: "frontend", cor: "\x1b[32m", pasta: "frontend", args: [...watch, "--env-file-if-exists=.env", "server.js"] }
];

const filhos = partes.map(p => {
  const f = spawn(process.execPath, p.args, { cwd: path.join(raiz, p.pasta), stdio: ["ignore", "pipe", "pipe"] });
  const prefixo = `${p.cor}[${p.nome}]\x1b[0m `;
  const mostrar = saida => d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => saida.write(prefixo + l + "\n"));
  f.stdout.on("data", mostrar(process.stdout));
  f.stderr.on("data", mostrar(process.stderr));
  f.on("exit", c => { console.log(prefixo + "saiu (" + c + ")"); desligar(); });
  return f;
});

let saindo = false;
function desligar() {
  if (saindo) return;
  saindo = true;
  filhos.forEach(f => { try { f.kill("SIGTERM"); } catch (e) { /* já saiu */ } });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", desligar);
process.on("SIGTERM", desligar);
console.log("Abra http://localhost:3000 (site) e http://localhost:3000/painel");
