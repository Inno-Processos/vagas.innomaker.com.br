// Configuração do backend, lida das variáveis de ambiente (backend/.env).
const lista = s => String(s || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
const semBarraFinal = s => String(s || "").replace(/\/+$/, "");

export const PAPEIS = { rh: "RH", gerente: "Gerente", funcionario: "Funcionário" };

export function cfg(env) {
  return {
    siteUrl: semBarraFinal(env.SITE_URL || "https://vagas.innomaker.com.br"),
    autheliaUrl: semBarraFinal(env.AUTHELIA_URL || "https://auth.innomaker.com.br"),
    autheliaAuthzPath: env.AUTHELIA_AUTHZ_PATH || "/api/authz/auth-request",
    autheliaCookie: env.AUTHELIA_COOKIE || "authelia_session",
    grupos: {
      rh: lista(env.GRUPOS_RH || "rh"),
      gerente: lista(env.GRUPOS_GERENTE || "gerente,gerentes,gestor,gestores"),
      funcionario: lista(env.GRUPOS_FUNCIONARIO || "funcionario,funcionarios,colaborador,colaboradores")
    },
    usuarioFalso: env.DEV_USUARIO_FALSO || ""
  };
}

export function urlsLogin(c) {
  return {
    loginUrl: c.autheliaUrl + "/?rd=" + encodeURIComponent(c.siteUrl + "/painel"),
    logoutUrl: c.autheliaUrl + "/logout?rd=" + encodeURIComponent(c.siteUrl + "/")
  };
}
