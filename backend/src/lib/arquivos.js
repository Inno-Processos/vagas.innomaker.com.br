// Arquivos enviados (currículos e documentos de admissão), guardados em env.ARQUIVOS (pasta data/arquivos).
import { ErroApi, agora } from "./http.js";
import { executar, um } from "./db.js";

export const MAX_ARQUIVO = 10 * 1024 * 1024;
const TIPOS = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

function tipoDoArquivo(file) {
  if (TIPOS[file.type]) return file.type;
  const ext = String(file.name || "").toLowerCase().split(".").pop();
  return { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" }[ext] || "";
}

export function ehArquivo(v) {
  return v && typeof v === "object" && typeof v.arrayBuffer === "function" && v.size > 0;
}

export async function salvarArquivo(env, file, opts) {
  const tipo = tipoDoArquivo(file);
  if (!tipo || (opts.apenasPdf && tipo !== "application/pdf")) {
    throw new ErroApi(`"${file.name}": envie ${opts.apenasPdf ? "um PDF" : "PDF, JPG ou PNG"}.`);
  }
  if (file.size > MAX_ARQUIVO) throw new ErroApi(`"${file.name}" passa de 10 MB.`);

  const id = crypto.randomUUID();
  const nome = String(file.name || "arquivo").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
  const chave = `${opts.categoria}/${id}-${nome}`;
  await env.ARQUIVOS.put(chave, await file.arrayBuffer(), { httpMetadata: { contentType: tipo } });
  await executar(env,
    "INSERT INTO arquivos (id, r2_key, nome, tipo_mime, tamanho, categoria, candidato_id, admissao_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, chave, nome, tipo, file.size, opts.categoria, opts.candidatoId || null, opts.admissaoId || null, agora());
  return { id, nome };
}

export async function apagarArquivo(env, id) {
  const a = await um(env, "SELECT * FROM arquivos WHERE id = ?", id);
  if (!a) return;
  try { await env.ARQUIVOS.delete(a.r2_key); } catch (e) { /* segue */ }
  await executar(env, "DELETE FROM arquivos WHERE id = ?", id);
}

export async function respostaArquivo(env, a) {
  const obj = await env.ARQUIVOS.get(a.r2_key);
  if (!obj) return new Response("Arquivo não encontrado.", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": a.tipo_mime || "application/octet-stream",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
