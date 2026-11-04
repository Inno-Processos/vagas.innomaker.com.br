// Banco de dados local (SQLite, arquivo data/vagas.db) com a mesma interface do Cloudflare D1
// que o código em src/ usa: env.DB.prepare(sql).bind(...).first() / .all() / .run() e env.DB.batch([...]).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const BACKUPS_MANTIDOS = 15;

export function abrirBanco(pastaDados, pastaMigracoes) {
  fs.mkdirSync(pastaDados, { recursive: true });
  const arquivo = path.join(pastaDados, "vagas.db");
  const novo = !fs.existsSync(arquivo);
  const db = new DatabaseSync(arquivo);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

  // Primeira vez: se houver uma exportação do D1 (npx wrangler d1 export ... --output data/importar-d1.sql), carrega
  const importar = path.join(pastaDados, "importar-d1.sql");
  if (novo && fs.existsSync(importar)) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(fs.readFileSync(importar, "utf8"));
    fs.renameSync(importar, importar + ".importado");
    console.log("Banco importado de", importar);
  }
  db.exec("PRAGMA foreign_keys = ON;");
  aplicarMigracoes(db, pastaMigracoes);
  return new BancoD1(db, pastaDados);
}

// Mesmo controle do D1 (tabela d1_migrations), para um banco exportado do Cloudflare continuar de onde parou
export function aplicarMigracoes(db, pasta) {
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`);
  const feitas = new Set(db.prepare("SELECT name FROM d1_migrations").all().map(r => r.name));
  const arquivos = fs.readdirSync(pasta).filter(f => f.endsWith(".sql")).sort();
  for (const f of arquivos) {
    if (feitas.has(f)) continue;
    db.exec("BEGIN");
    try {
      db.exec(fs.readFileSync(path.join(pasta, f), "utf8"));
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(f);
      db.exec("COMMIT");
      console.log("Migração aplicada:", f);
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Migração ${f} falhou: ${e.message}`);
    }
  }
}

const valor = v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
const linha = r => r ? Object.assign({}, r) : r;

class BancoD1 {
  constructor(db, pastaDados) {
    this.db = db;
    this.pastaDados = pastaDados;
    this.cache = new Map();
  }

  preparar(sql) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(sql, s);
    }
    return s;
  }

  prepare(sql) { return new Consulta(this, sql, []); }

  async batch(consultas) {
    this.db.exec("BEGIN");
    try {
      const r = consultas.map(c => c.executar());
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async exec(sql) { this.db.exec(sql); return { count: 1 }; }

  // Cópia do banco em data/backups (mantém as últimas 15). Retorna o caminho, ou null se já houver a de hoje.
  backup(forcar) {
    const pasta = path.join(this.pastaDados, "backups");
    fs.mkdirSync(pasta, { recursive: true });
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    let destino = path.join(pasta, `vagas-${hoje}.db`);
    if (fs.existsSync(destino)) {
      if (!forcar) return null;
      destino = path.join(pasta, `vagas-${hoje}-${Date.now()}.db`);
    }
    this.db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
    const antigos = fs.readdirSync(pasta).filter(f => /^vagas-.*\.db$/.test(f)).sort();
    for (const f of antigos.slice(0, Math.max(0, antigos.length - BACKUPS_MANTIDOS))) fs.rmSync(path.join(pasta, f), { force: true });
    return destino;
  }

  fechar() { try { this.db.close(); } catch (e) { /* já fechado */ } }
}

class Consulta {
  constructor(banco, sql, params) { this.banco = banco; this.sql = sql; this.params = params; }

  bind(...p) { return new Consulta(this.banco, this.sql, p.map(valor)); }

  // Executa e devolve no formato do D1: { success, results, meta: { changes, last_row_id } }
  executar() {
    const results = this.banco.preparar(this.sql).all(...this.params).map(linha);
    const m = this.banco.preparar("SELECT changes() AS c, last_insert_rowid() AS id").get();
    return { success: true, results, meta: { changes: Number(m.c), last_row_id: Number(m.id) } };
  }

  async first(coluna) {
    const r = this.executar().results[0];
    if (!r) return null;
    return coluna ? (r[coluna] ?? null) : r;
  }

  async all() { return this.executar(); }
  async run() { return this.executar(); }
  async raw() { return this.executar().results.map(r => Object.values(r)); }
}
