// Permite "import X from './arquivo.html'" no Node (o Cloudflare faz isso pelas [[rules]] do wrangler.toml).
import { readFile } from "node:fs/promises";

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".html")) {
    const texto = await readFile(new URL(url), "utf8");
    return { format: "module", source: "export default " + JSON.stringify(texto) + ";", shortCircuit: true };
  }
  return nextLoad(url, context);
}
