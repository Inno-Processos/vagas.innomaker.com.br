// Comandos de manutenção:  npm run backup
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirBanco } from "./infra/banco.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DADOS = path.resolve(process.env.DATA_DIR || path.join(RAIZ, "..", "data"));
const comando = process.argv[2];

if (comando === "backup") {
  const banco = abrirBanco(DADOS, path.join(RAIZ, "migrations"));
  console.log("Backup criado:", banco.backup(true));
  banco.fechar();
} else if (comando === "migrar") {
  abrirBanco(DADOS, path.join(RAIZ, "migrations")).fechar();
  console.log("Banco em dia:", path.join(DADOS, "vagas.db"));
} else {
  console.log("Uso: node servidor/cli.js backup | migrar");
  process.exit(1);
}
