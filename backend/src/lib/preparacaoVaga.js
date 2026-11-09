import { ErroApi, texto, agora } from "./http.js";

export const GRUPOS_PREPARACAO = [
  { id: "entrevista", nome: "Primeira entrevista e acompanhante", itens: [
    { id: "acompanhante", nome: "Acompanhante definido para a primeira entrevista" },
    { id: "treinamento", nome: "Treinamento do acompanhante realizado antes da primeira reunião" }
  ], dica: "Registre o nome do acompanhante e a data do treinamento. Anexe roteiro, orientações ou comprovantes." },
  { id: "testes", nome: "Preparação dos testes", itens: [
    { id: "competencias", nome: "Tipo de teste e competências a avaliar definidos" },
    { id: "etapas", nome: "Etapas e critérios de avaliação preparados" },
    { id: "duracao_local", nome: "Tempo de teste e local definidos" },
    { id: "materiais", nome: "Materiais do teste separados e conferidos" },
    { id: "avaliadores", nome: "Avaliadores definidos e preparados, com apoio do responsável do setor" }
  ], dica: "Anexe o teste, a lista de materiais, os critérios e as orientações aos avaliadores. Se a vaga não tiver teste, justifique em Não se aplica." },
  { id: "divulgacao", nome: "Planilhas e divulgação pelo marketing", itens: [
    { id: "planilhas", nome: "Planilhas da vaga preparadas e link conferido na coluna M do Cadastro da Vaga" },
    { id: "marketing", nome: "Materiais de divulgação solicitados ao marketing" },
    { id: "canais", nome: "Canais e planejamento da divulgação definidos" }
  ], dica: "Registre os links e o responsável pela divulgação. Anexe planilhas, briefing e materiais. As confirmações são manuais." }
];

export function lerPreparacao(src, base, quem) {
  if (!src || typeof src !== "object" || Array.isArray(src)) throw new ErroApi("Checklist de preparação inválido.");
  const resultado = {};
  for (const grupo of GRUPOS_PREPARACAO) {
    const g = src[grupo.id] || {};
    const anterior = base[grupo.id] || {};
    const dados = {
      nao_aplica: g.nao_aplica === true,
      justificativa: texto(g.justificativa, 1000), observacoes: texto(g.observacoes, 3000),
      itens: Object.fromEntries(grupo.itens.map(i => [i.id, g.itens?.[i.id] === true]))
    };
    const comparavel = ({ conferido_por, conferido_em, ...resto }) => resto;
    const mudou = JSON.stringify(dados) !== JSON.stringify(comparavel(anterior));
    resultado[grupo.id] = { ...dados, conferido_por: mudou ? quem : anterior.conferido_por || "",
      conferido_em: mudou ? agora() : anterior.conferido_em || "" };
  }
  return resultado;
}

export function pendenciasPreparacao(preparacao) {
  const faltas = [];
  for (const grupo of GRUPOS_PREPARACAO) {
    const g = preparacao[grupo.id] || {};
    if (g.nao_aplica === true) {
      if (!String(g.justificativa || "").trim()) faltas.push(grupo.nome + ": justifique por que não se aplica");
    } else {
      for (const item of grupo.itens) if (g.itens?.[item.id] !== true) faltas.push(item.nome);
    }
  }
  return faltas;
}
