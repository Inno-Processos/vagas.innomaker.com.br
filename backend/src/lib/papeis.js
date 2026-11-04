// Papéis e permissões do painel. RH > Gerente > Funcionário.
import { PAPEIS } from "./config.js";

export function papelDosGrupos(grupos, mapa) {
  const g = (grupos || []).map(x => String(x).trim().toLowerCase());
  const tem = l => l.some(x => g.indexOf(x) >= 0);
  if (tem(mapa.rh)) return "rh";
  if (tem(mapa.gerente)) return "gerente";
  if (tem(mapa.funcionario)) return "funcionario";
  return null;
}

const TODOS = ["funcionario", "gerente", "rh"];
const GESTAO = ["gerente", "rh"];
const RH = ["rh"];

// ação do painel → papéis que podem executar
export const ACOES = {
  me: TODOS,
  vagas_abertas: TODOS,
  opcoes: TODOS,

  solic_criar: GESTAO,
  solic_editar: GESTAO,
  solic_minhas: GESTAO,
  minhas_vagas: GESTAO,
  vaga_detalhe: GESTAO,       // gerente: só vagas da própria área

  solic_listar: RH,
  solic_decidir: RH,
  vagas_todas: RH,
  vaga_salvar: RH,
  etapa_atualizar: RH,
  candidatura_status: RH,
  proposta_criar: RH,
  adm_listar: RH,
  adm_detalhe: RH,
  adm_decidir: RH,
  adm_reenviar: RH,
  func_listar: RH,
  func_detalhe: RH,
  func_atualizar: RH,
  doc_gerar: RH,
  doc_cancelar: RH,
  cfg_obter: RH,
  cfg_salvar_geral: RH,
  dep_salvar: RH,
  lista_salvar: RH,
  modelo_salvar: RH,
  log_listar: RH,
  email_teste: RH
};

export function podeExecutar(papel, acao) {
  return !!(ACOES[acao] && papel && ACOES[acao].indexOf(papel) >= 0);
}

export function acoesDoPapel(papel) {
  return Object.keys(ACOES).filter(a => podeExecutar(papel, a));
}

export function nomeDoPapel(papel) {
  return PAPEIS[papel] || "";
}
