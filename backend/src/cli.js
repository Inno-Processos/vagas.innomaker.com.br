// Comandos de manutenção:  npm run backup   (banco + cópia externa, se BACKUP_EXTERNO_DIR estiver definido)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { abrirBanco } from "./infra/banco.js";
import { criarBackupExterno } from "./infra/backupExterno.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DADOS = path.resolve(process.env.DATA_DIR || path.join(RAIZ, "..", "data"));
const comando = process.argv[2];

if (comando === "backup") {
  const banco = abrirBanco(DADOS, path.join(RAIZ, "migrations"));
  console.log("Backup criado:", banco.backup(true));
  banco.fechar();
  const ext = criarBackupExterno(DADOS, process.env.BACKUP_EXTERNO_DIR ? path.resolve(process.env.BACKUP_EXTERNO_DIR) : "");
  if (!ext.configurado) console.log("Cópia externa: BACKUP_EXTERNO_DIR não definido.");
  else {
    const r = await ext.copiar(true);
    console.log(r.ok ? "Cópia externa em " + ext.destino + ": " + JSON.stringify(r.arquivos) : "Cópia externa FALHOU: " + r.erro);
    if (!r.ok) process.exitCode = 1;
  }
} else if (comando === "migrar") {
  abrirBanco(DADOS, path.join(RAIZ, "migrations")).fechar();
  console.log("Banco em dia:", path.join(DADOS, "vagas.db"));
} else {
  console.log("Uso: node servidor/cli.js backup | migrar");
  process.exit(1);
}
