// Chamadas aos projetos do Google Apps Script.
//   VAGAS → planilha Mãe (site de vagas, candidatos)
//   SOLIC → solicitações de contratação (gestores)
//   ADM   → admissão
import { cfg } from "./config.js";

// O Apps Script responde POST com um redirecionamento 302; ele é seguido com GET.
async function postAppsScript(url, body) {
  let r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body,
    redirect: "manual"
  });
  const destino = r.headers.get("location");
  if (r.status >= 300 && r.status < 400 && destino) r = await fetch(destino, { redirect: "follow" });
  return r;
}

export async function chamarBackend(env, qual, action, dados, usuario) {
  const c = cfg(env);
  const url = c.apps[qual];
  if (!url) return { ok: false, erro: "Integração " + qual + " não configurada (variável APPS_" + qual + "_URL)." };
  if (!c.staffKey) return { ok: false, erro: "Chave STAFF_API_KEY não configurada no Worker." };

  const corpo = Object.assign({}, dados || {}, {
    action,
    key: c.staffKey,
    ator: usuario ? { login: usuario.login, nome: usuario.nome, email: usuario.email, papel: usuario.papel } : null
  });

  try {
    const r = await postAppsScript(url, JSON.stringify(corpo));
    const texto = await r.text();
    try { return JSON.parse(texto); }
    catch (e) { return { ok: false, erro: "O Apps Script (" + qual + ") não respondeu em JSON. Confira se a implantação está em 'Qualquer pessoa' e com a versão nova." }; }
  } catch (e) {
    return { ok: false, erro: "Falha de conexão com o Apps Script (" + qual + ")." };
  }
}

// Repasse das ações públicas do site (inscrição, login de candidato…), sem ler o corpo
export async function proxyPublico(env, request) {
  const url = cfg(env).apps.VAGAS;
  try {
    const r = await postAppsScript(url, request.body);
    const texto = await r.text();
    JSON.parse(texto);
    return texto;
  } catch (e) {
    return JSON.stringify({ ok: false, erro: "O servidor não respondeu corretamente. Tente novamente em instantes." });
  }
}
