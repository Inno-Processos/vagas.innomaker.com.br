// Lista pública de vagas com cache na borda do Cloudflare.
import { cfg } from "./config.js";

const FRESCO_SEG = 60;               // depois disso atualiza em segundo plano
const GUARDAR_SEG = 7 * 24 * 3600;
const CHAVE = "/__cache/vagas-v1";

const chave = origem => new Request(origem + CHAVE);

export async function getVagas(env, origem, ctx) {
  const hit = await caches.default.match(chave(origem));
  if (hit) {
    const idade = (Date.now() - Number(hit.headers.get("x-buscado-em") || 0)) / 1000;
    const dados = await hit.json();
    if (idade > FRESCO_SEG && ctx) ctx.waitUntil(atualizarVagas(env, origem));
    return { vagas: dados.vagas || [], erro: "", idade };
  }
  return atualizarVagas(env, origem);
}

export async function atualizarVagas(env, origem) {
  try {
    const url = cfg(env).apps.VAGAS;
    const r = await fetch(url + "?api=vagas", { redirect: "follow" });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.erro) || "Resposta inválida");
    await caches.default.put(chave(origem), new Response(JSON.stringify({ vagas: j.vagas || [] }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=" + GUARDAR_SEG,
        "x-buscado-em": String(Date.now())
      }
    }));
    return { vagas: j.vagas || [], erro: "", idade: 0 };
  } catch (e) {
    return { vagas: [], erro: "Não foi possível carregar as vagas agora. Tente novamente em instantes.", idade: 0 };
  }
}

export async function limparCacheVagas(origem) {
  try { await caches.default.delete(chave(origem)); } catch (e) { /* ok */ }
}
