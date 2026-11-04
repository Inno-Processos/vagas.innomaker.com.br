// Configuração lida das variáveis do Worker (wrangler.toml [vars] e segredos).
const lista = s => String(s || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
const semBarraFinal = s => String(s || "").replace(/\/+$/, "");

export const SITE = {
  logoUrl: "/assets/logo.png",
  logoEscuroUrl: "/assets/logo-escuro.png",
  usvUrl: "https://lh3.googleusercontent.com/d/1oJqHdWGQzA3_eGaqyccbcSr31S_9H9OE",
  contato: { whatsapp: "https://wa.me/21966396480", email: "ainnomaker@gmail.com", site: "https://innomaker.com.br/" }
};

export const PAPEIS = { rh: "RH", gerente: "Gerente", funcionario: "Funcionário" };

export function cfg(env) {
  return {
    siteUrl: semBarraFinal(env.SITE_URL || "https://vagas.innomaker.com.br"),
    autheliaUrl: semBarraFinal(env.AUTHELIA_URL || "https://auth.innomaker.com.br"),
    autheliaAuthzPath: env.AUTHELIA_AUTHZ_PATH || "/api/authz/forward-auth",
    autheliaCookie: env.AUTHELIA_COOKIE || "authelia_session",
    grupos: {
      rh: lista(env.GRUPOS_RH || "rh"),
      gerente: lista(env.GRUPOS_GERENTE || "gerente,gerentes,gestor,gestores"),
      funcionario: lista(env.GRUPOS_FUNCIONARIO || "funcionario,funcionarios,colaborador,colaboradores")
    },
    versao: env.VERSAO_ASSETS || "1",
    usuarioFalso: env.DEV_USUARIO_FALSO || ""
  };
}

export function urlsLogin(c) {
  return {
    loginUrl: c.autheliaUrl + "/?rd=" + encodeURIComponent(c.siteUrl + "/painel"),
    logoutUrl: c.autheliaUrl + "/logout?rd=" + encodeURIComponent(c.siteUrl + "/")
  };
}
