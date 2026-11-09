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
  agenda_listar: GESTAO,      // gerente: só vagas da própria área (só vê)

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
  cfg_obter: RH,
  cfg_salvar_geral: RH,
  dep_salvar: RH,
  lista_salvar: RH,
  log_listar: RH,
  email_teste: RH,
  agenda_salvar: RH,
  agenda_encerrar: RH,
  agenda_convidar: RH,
  agenda_cancelar_reserva: RH,
  agenda_participante: RH,
  talentos_listar: RH,
  talento_salvar: RH,
  talento_convidar: RH,
  indicadores: RH,
  cfg_salvar_lgpd: RH,
  candidato_excluir: RH,
  adm_proposta_salvar: RH,
  adm_cancelar: RH,
  adm_passo: RH,
  adm_pedir_acessos: RH,
  cfg_salvar_admissao: RH,
  adm_area: GESTAO,          // gerente: admissões das vagas da área (sem dados pessoais)
  etapa_agendar: RH,
  entrevistas_listar: GESTAO, // gerente: só as das vagas da área
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
