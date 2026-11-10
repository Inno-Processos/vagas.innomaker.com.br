// Limite de tentativas em memória (por endereço de rede e/ou e-mail), contra abuso de inscrição, login e "esqueci a senha".
const porEnv = new WeakMap();
const mapa = env => { let m = porEnv.get(env); if (!m) { m = new Map(); porEnv.set(env, m); } return m; };

// IP de quem fez o pedido (o primeiro do X-Forwarded-For, posto pelo Traefik/frontend)
export function ipDe(request) {
  return String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
}

// Conta um uso na janela; devolve true se passou do máximo
export function contar(env, chave, max, janelaMs) {
  const m = mapa(env);
  const t = Date.now();
  let b = m.get(chave);
  if (!b || b.ate <= t) { b = { n: 0, ate: t + janelaMs }; m.set(chave, b); }
  b.n++;
  if (m.size > 20000) for (const [k, v] of m) if (v.ate <= t) m.delete(k);
  return b.n > max;
}

// Já atingiu o máximo (sem contar de novo)?
export function atingiu(env, chave, max) {
  const b = mapa(env).get(chave);
  return !!(b && b.ate > Date.now() && b.n >= max);
}

export function minutosRestantes(env, chave) {
  const b = mapa(env).get(chave);
  return b ? Math.max(1, Math.ceil((b.ate - Date.now()) / 60000)) : 0;
}

export function zerar(env, chave) { mapa(env).delete(chave); }
