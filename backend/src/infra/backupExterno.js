// Cópia do backup para FORA do servidor (outro disco, pasta de rede/NAS ou pasta sincronizada com a nuvem).
// Configure BACKUP_EXTERNO_DIR no backend/.env apontando para essa pasta (no Docker, monte o volume; ver README).
//
//   <destino>/banco/vagas-AAAA-MM-DD.db   uma cópia por dia do banco (mantém as últimas 30)
//   <destino>/arquivos/...                espelho de data/arquivos (currículos e documentos)
//
// O que foi apagado aqui (exclusão LGPD, prazo de guarda) vai para <destino>/lixeira/AAAA-MM-DD/ e some depois de 30 dias.
// Se a pasta de origem estiver vazia e o destino não, a cópia para (proteção contra disco desmontado ou dados perdidos).
// A situação da última cópia fica em data/backups/externo.json e aparece em Painel → Configurações.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const BANCOS_MANTIDOS = 30;
const DIAS_LIXEIRA = 30;

async function listarArquivos(base, rel = "") {
  const saida = new Map();
  let itens;
  try { itens = await fsp.readdir(path.join(base, rel), { withFileTypes: true }); } catch (e) { return saida; }
  for (const it of itens) {
    const r = path.join(rel, it.name);
    if (it.isDirectory()) for (const [k, v] of await listarArquivos(base, r)) saida.set(k, v);
    else if (it.isFile() && !/\.tmp-\d+$/.test(it.name)) {
      const st = await fsp.stat(path.join(base, r));
      saida.set(r, { tamanho: st.size, mtime: Math.floor(st.mtimeMs) });
    }
  }
  return saida;
}

// Espelha origem → destino: copia novos/alterados e remove os que não existem mais na origem
async function espelhar(origem, destino, lixeira, hoje) {
  await fsp.mkdir(destino, { recursive: true });
  const [a, b] = await Promise.all([listarArquivos(origem), listarArquivos(destino)]);
  if (!a.size && b.size) throw new Error("a pasta de arquivos do sistema está vazia, mas a cópia tem " + b.size + " arquivo(s). Nada foi apagado: confira o servidor");
  let copiados = 0, removidos = 0;
  for (const [rel, info] of a) {
    const d = b.get(rel);
    if (d && d.tamanho === info.tamanho && d.mtime >= info.mtime) continue;
    const alvo = path.join(destino, rel);
    await fsp.mkdir(path.dirname(alvo), { recursive: true });
    await fsp.copyFile(path.join(origem, rel), alvo);
    const t = new Date(info.mtime);
    await fsp.utimes(alvo, t, t).catch(() => {});
    copiados++;
  }
  // apagados aqui vão para a lixeira (não somem de imediato)
  for (const rel of b.keys()) {
    if (a.has(rel)) continue;
    const alvo = path.join(lixeira, hoje, rel);
    await fsp.mkdir(path.dirname(alvo), { recursive: true });
    await fsp.rename(path.join(destino, rel), alvo).catch(async () => {
      await fsp.copyFile(path.join(destino, rel), alvo);
      await fsp.rm(path.join(destino, rel), { force: true });
    });
    removidos++;
  }
  // lixeira: some depois de 30 dias
  const limite = new Date(Date.now() - DIAS_LIXEIRA * 864e5).toISOString().slice(0, 10);
  let dias = [];
  try { dias = await fsp.readdir(lixeira); } catch (e) { /* sem lixeira */ }
  for (const d of dias) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < limite) await fsp.rm(path.join(lixeira, d), { recursive: true, force: true });
  return { total: a.size, copiados, removidos };
}

export function criarBackupExterno(pastaDados, destino) {
  const arqStatus = path.join(pastaDados, "backups", "externo.json");
  const ler = () => { try { return JSON.parse(fs.readFileSync(arqStatus, "utf8")); } catch (e) { return null; } };
  const gravar = s => { fs.mkdirSync(path.dirname(arqStatus), { recursive: true }); fs.writeFileSync(arqStatus, JSON.stringify(s, null, 2)); };

  return {
    configurado: !!destino,
    destino: destino || "",

    status() {
      const s = ler();
      return Object.assign({ configurado: !!destino, destino: destino || "" }, s || {});
    },

    // Copia o backup mais recente do banco e espelha os arquivos. Uma vez por dia (ou forçado).
    async copiar(forcar) {
      if (!destino) return null;
      const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      const anterior = ler();
      if (!forcar && anterior && anterior.ok && anterior.dia === hoje) return null;
      const s = { dia: hoje, quando: new Date().toISOString(), ok: false, erro: "", banco: "", arquivos: null };
      try {
        if (!fs.existsSync(destino)) throw new Error("a pasta " + destino + " não existe ou não está montada");
        const pastaBackups = path.join(pastaDados, "backups");
        const bancos = fs.readdirSync(pastaBackups).filter(f => /^vagas-.*\.db$/.test(f)).sort();
        if (!bancos.length) throw new Error("nenhum backup do banco em " + pastaBackups);
        const ultimo = bancos[bancos.length - 1];
        const dBanco = path.join(destino, "banco");
        await fsp.mkdir(dBanco, { recursive: true });
        const tmp = path.join(dBanco, ultimo + ".parcial");
        await fsp.copyFile(path.join(pastaBackups, ultimo), tmp);
        await fsp.rename(tmp, path.join(dBanco, ultimo));
        const antigos = fs.readdirSync(dBanco).filter(f => /^vagas-.*\.db$/.test(f)).sort();
        for (const f of antigos.slice(0, Math.max(0, antigos.length - BANCOS_MANTIDOS))) await fsp.rm(path.join(dBanco, f), { force: true });
        s.banco = ultimo;
        s.arquivos = await espelhar(path.join(pastaDados, "arquivos"), path.join(destino, "arquivos"), path.join(destino, "lixeira"), hoje);
        s.ok = true;
      } catch (e) {
        s.erro = String(e && e.message || e);
        s.ultimoOk = anterior && (anterior.ok ? anterior.quando : anterior.ultimoOk) || "";
      }
      gravar(s);
      return s;
    }
  };
}
