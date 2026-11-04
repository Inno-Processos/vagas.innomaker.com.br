// Arquivos (currículos e documentos) na pasta data/arquivos, com a mesma interface do Cloudflare R2
// que o código em src/ usa: env.ARQUIVOS.put / get / delete / head.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export function criarArmazenamento(pasta) {
  const base = path.resolve(pasta);
  fs.mkdirSync(base, { recursive: true });

  const caminho = chave => {
    const f = path.resolve(base, String(chave));
    if (!f.startsWith(base + path.sep)) throw new Error("Chave de arquivo inválida: " + chave);
    return f;
  };

  async function paraBuffer(dados) {
    if (dados == null) return Buffer.alloc(0);
    if (typeof dados === "string") return Buffer.from(dados);
    if (dados instanceof ArrayBuffer) return Buffer.from(dados);
    if (ArrayBuffer.isView(dados)) return Buffer.from(dados.buffer, dados.byteOffset, dados.byteLength);
    return Buffer.from(await new Response(dados).arrayBuffer()); // Blob, ReadableStream
  }

  async function info(chave) {
    try {
      const st = await fsp.stat(caminho(chave));
      return st.isFile() ? { key: chave, size: st.size, uploaded: st.mtime } : null;
    } catch (e) { return null; }
  }

  return {
    async put(chave, dados) {
      const f = caminho(chave);
      const buf = await paraBuffer(dados);
      await fsp.mkdir(path.dirname(f), { recursive: true });
      const tmp = f + ".tmp-" + process.pid;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, f);
      return { key: chave, size: buf.length };
    },
    head: info,
    async get(chave) {
      const i = await info(chave);
      if (!i) return null;
      const f = caminho(chave);
      return Object.assign(i, {
        get body() { return Readable.toWeb(fs.createReadStream(f)); },
        arrayBuffer: async () => { const b = await fsp.readFile(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
        text: () => fsp.readFile(f, "utf8")
      });
    },
    async delete(chave) {
      for (const k of [].concat(chave)) await fsp.rm(caminho(k), { force: true });
    }
  };
}
