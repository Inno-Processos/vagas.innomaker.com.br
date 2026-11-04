import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { lerSessao, lerCookie } from "../backend/src/lib/auth.js";

const env = { GRUPOS_RH: "rh", GRUPOS_GERENTE: "gerente", GRUPOS_FUNCIONARIO: "funcionario" };
let n = 0;
const req = (cookie, host) => new Request("https://" + (host || "vagas.innomaker.com.br") + "/painel",
  { headers: cookie ? { cookie } : {} });
const cookieUnico = () => "outro=1; authelia_session=sess" + (++n);

function mockAuthelia(status, headers) {
  const chamadas = [];
  globalThis.fetch = async (url, opt) => { chamadas.push({ url, opt }); return new Response(null, { status, headers }); };
  return chamadas;
}

beforeEach(() => { delete globalThis.fetch; });

test("lê o cookie certo", () => {
  assert.equal(lerCookie("a=1; authelia_session=xyz; b=2", "authelia_session"), "xyz");
  assert.equal(lerCookie("a=1", "authelia_session"), "");
});

test("sem cookie → anônimo, sem chamar o Authelia", async () => {
  const ch = mockAuthelia(200, {});
  assert.equal((await lerSessao(req(""), env)).estado, "anonimo");
  assert.equal(ch.length, 0);
});

test("200 com grupo rh → papel RH, repassando só o cookie do Authelia", async () => {
  const ch = mockAuthelia(200, { "Remote-User": "maria", "Remote-Name": "Maria Silva", "Remote-Email": "maria@innomaker.com.br", "Remote-Groups": "funcionario,rh" });
  const s = await lerSessao(req(cookieUnico()), env);
  assert.equal(s.estado, "ok");
  assert.equal(s.usuario.papel, "rh");
  assert.equal(s.usuario.nome, "Maria Silva");
  assert.match(ch[0].url, /auth\.innomaker\.com\.br\/api\/authz\/auth-request$/);
  assert.equal(ch[0].opt.headers["Cookie"].indexOf("outro="), -1);
  assert.equal(ch[0].opt.headers["X-Forwarded-Host"], "vagas.innomaker.com.br");
});

test("200 sem grupo válido → sem permissão (403)", async () => {
  mockAuthelia(200, { "Remote-User": "joao", "Remote-Groups": "financeiro" });
  const s = await lerSessao(req(cookieUnico()), env);
  assert.equal(s.estado, "sem_permissao");
});

test("403 do Authelia → sem permissão", async () => {
  mockAuthelia(403, {});
  assert.equal((await lerSessao(req(cookieUnico()), env)).estado, "sem_permissao");
});

test("401/302 do Authelia → anônimo", async () => {
  mockAuthelia(302, { location: "https://auth.innomaker.com.br/" });
  assert.equal((await lerSessao(req(cookieUnico()), env)).estado, "anonimo");
});

test("usuário falso só vale em localhost", async () => {
  const e = Object.assign({}, env, { DEV_USUARIO_FALSO: JSON.stringify({ login: "t", grupos: ["gerente"] }) });
  mockAuthelia(302, {});
  assert.equal((await lerSessao(req("", "localhost:8787"), e)).usuario.papel, "gerente");
  assert.equal((await lerSessao(req(""), e)).estado, "anonimo");
});
