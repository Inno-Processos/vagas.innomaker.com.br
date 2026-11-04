// Configuração lida das variáveis do Worker (wrangler.toml [vars] e secrets).

const lista = s => String(s || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
const semBarraFinal = s => String(s || "").replace(/\/+$/, "");

export const SITE = {
  logoUrl: "https://lh3.googleusercontent.com/d/1tsWG9lhE1xD0OLLdg0AHs78KswFpEzxW",
  usvUrl: "https://lh3.googleusercontent.com/d/1oJqHdWGQzA3_eGaqyccbcSr31S_9H9OE",
  contato: {
    whatsapp: "https://wa.me/21966396480",
    email: "ainnomaker@gmail.com",
    site: "https://innomaker.com.br/"
  }
};

export const PAPEIS = {
  rh: "RH",
  gerente: "Gerente",
  funcionario: "Funcionário"
};

export function cfg(env) {
  let links = [];
  try { links = JSON.parse(env.LINKS_COLABORADOR || "[]"); } catch (e) { links = []; }

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
    apps: {
      VAGAS: env.APPS_VAGAS_URL || "",
      SOLIC: env.APPS_SOLIC_URL || "",
      ADM: env.APPS_ADM_URL || ""
    },
    staffKey: env.STAFF_API_KEY || "",
    links: Array.isArray(links) ? links : [],
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
