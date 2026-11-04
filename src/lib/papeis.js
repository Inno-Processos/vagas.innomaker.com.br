// Papéis e permissões do painel. RH > Gerente > Funcionário.
import { PAPEIS } from "./config.js";

export function papelDosGrupos(grupos, mapa) {
  const g = (grupos || []).map(x => String(x).trim().toLowerCase());
  const tem = lista => lista.some(x => g.indexOf(x) >= 0);
  if (tem(mapa.rh)) return "rh";
  if (tem(mapa.gerente)) return "gerente";
  if (tem(mapa.funcionario)) return "funcionario";
  return null;
}

const TODOS = ["funcionario", "gerente", "rh"];
const GESTAO = ["gerente", "rh"];
const RH = ["rh"];

// acao do painel → quem pode e para qual Apps Script vai
export const ACOES = {
  me:               { papeis: TODOS },
  vagas_abertas:    { papeis: TODOS },

  solic_opcoes:     { papeis: GESTAO, backend: "SOLIC", action: "opcoes" },
  solic_criar:      { papeis: GESTAO, backend: "SOLIC", action: "solicitar" },
  solic_minhas:     { papeis: GESTAO, backend: "SOLIC", action: "minhas" },

  solic_listar:     { papeis: RH, backend: "SOLIC", action: "listar" },
  solic_decidir:    { papeis: RH, backend: "SOLIC", action: "decidir" },

  vagas_todas:      { papeis: RH, backend: "VAGAS", action: "staff_vagas" },
  vaga_atualizar:   { papeis: RH, backend: "VAGAS", action: "staff_vaga_atualizar", limpaCacheVagas: true },
  vaga_candidatos:  { papeis: RH, backend: "VAGAS", action: "staff_candidatos" },

  adm_listar:       { papeis: RH, backend: "ADM", action: "adm_listar" },
  adm_aprovar:      { papeis: RH, backend: "ADM", action: "adm_aprovar" },
  adm_recusar:      { papeis: RH, backend: "ADM", action: "adm_recusar" },
  adm_reenviar:     { papeis: RH, backend: "ADM", action: "adm_reenviar" }
};

export function podeExecutar(papel, acao) {
  const a = ACOES[acao];
  return !!(a && papel && a.papeis.indexOf(papel) >= 0);
}

export function acoesDoPapel(papel) {
  return Object.keys(ACOES).filter(a => podeExecutar(papel, a));
}

export function nomeDoPapel(papel) {
  return PAPEIS[papel] || "";
}
