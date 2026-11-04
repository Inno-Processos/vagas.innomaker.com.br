// Login dos funcionários pelo Authelia (auth.innomaker.com.br).
//
// O Authelia guarda a sessão no cookie "authelia_session", válido para *.innomaker.com.br.
// O Worker repassa esse cookie ao endpoint de autorização do Authelia (forward-auth),
// que responde 200 + Remote-User / Remote-Groups / Remote-Name / Remote-Email quando a
// sessão é válida, 401/302 quando não há login e 403 quando as regras negam acesso.
import { cfg } from "./config.js";
import { papelDosGrupos, nomeDoPapel } from "./papeis.js";
import { lerCookie } from "./http.js";

const cache = new Map(); // hash do cookie → { exp, valor }
const TTL_OK_MS = 60 * 1000;
const TTL_OUTROS_MS = 10 * 1000;

export { lerCookie };

export function temCookieAuthelia(request, env) {
  return !!lerCookie(request.headers.get("cookie"), cfg(env).autheliaCookie);
}

async function sha256(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function montarUsuario(login, nome, email, grupos, mapaGrupos) {
  const papel = papelDosGrupos(grupos, mapaGrupos);
  return {
    login: login || "",
    nome: nome || login || "",
    email: String(email || "").split(",")[0].trim().toLowerCase(),
    grupos,
    papel,
    papelNome: nomeDoPapel(papel)
  };
}

// Retorna { estado: "ok" | "anonimo" | "sem_permissao" | "erro", usuario? }
export async function lerSessao(request, env) {
  const c = cfg(env);
  const url = new URL(request.url);

  // Só para testes locais (wrangler dev em localhost)
  if (c.usuarioFalso && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    try {
      const f = JSON.parse(c.usuarioFalso);
      // nos testes locais, o cabeçalho x-dev-grupos troca o papel sem reiniciar
      const gruposDev = request.headers.get("x-dev-grupos");
      const grupos = (gruposDev ? gruposDev.split(",") : (f.grupos || [])).map(g => String(g).trim().toLowerCase());
      const u = montarUsuario(request.headers.get("x-dev-login") || f.login, f.nome, request.headers.get("x-dev-email") || f.email, grupos, c.grupos);
      return u.papel ? { estado: "ok", usuario: u } : { estado: "sem_permissao", usuario: u };
    } catch (e) { /* ignora e segue o fluxo normal */ }
  }

  const valorCookie = lerCookie(request.headers.get("cookie"), c.autheliaCookie);
  if (!valorCookie) return { estado: "anonimo" };

  const chave = await sha256(valorCookie);
  const hit = cache.get(chave);
  if (hit && hit.exp > Date.now()) return hit.valor;

  let r;
  try {
    r = await fetch(c.autheliaUrl + c.autheliaAuthzPath, {
      method: "GET",
      redirect: "manual",
      headers: {
        "Cookie": c.autheliaCookie + "=" + valorCookie,
        "Accept": "application/json",
        // /api/authz/forward-auth (Traefik) lê X-Forwarded-*; /api/authz/auth-request (o do SAC) lê X-Original-*
        "X-Forwarded-Method": "GET",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": new URL(c.siteUrl).host,
        "X-Forwarded-Uri": "/painel",
        "X-Original-URL": c.siteUrl + "/painel",
        "X-Original-Method": "GET",
        "X-Forwarded-For": request.headers.get("cf-connecting-ip") || ""
      }
    });
  } catch (e) {
    return { estado: "erro", erro: "Não foi possível falar com o servidor de login (Authelia)." };
  }

  let valor;
  if (r.status === 200) {
    const grupos = String(r.headers.get("Remote-Groups") || "")
      .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const u = montarUsuario(r.headers.get("Remote-User"), r.headers.get("Remote-Name"), r.headers.get("Remote-Email"), grupos, c.grupos);
    valor = u.papel ? { estado: "ok", usuario: u } : { estado: "sem_permissao", usuario: u };
  } else if (r.status === 403) {
    valor = { estado: "sem_permissao", usuario: null };
  } else {
    valor = { estado: "anonimo" };
  }

  cache.set(chave, { exp: Date.now() + (valor.estado === "ok" ? TTL_OK_MS : TTL_OUTROS_MS), valor });
  if (cache.size > 1000) {
    const agora = Date.now();
    for (const [k, v] of cache) if (v.exp < agora) cache.delete(k);
  }
  return valor;
}

export async function esquecerSessao(request, env) {
  const v = lerCookie(request.headers.get("cookie"), cfg(env).autheliaCookie);
  if (v) cache.delete(await sha256(v));
}
