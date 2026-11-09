// Admissão (RHC-PROC-2026-003): campos do cadastro, documentos exigidos por tipo de contrato,
// validação do cadastro e trilha da admissão (do aceite ao onboarding).
import { texto, parseJson, normalizar, emailValido, ehDataISO, soDigitos } from "./http.js";

// ---------- Situações ----------
export const ADM_ENCERRADAS = ["PROPOSTA_RECUSADA", "RECUSADA", "CANCELADA", "PROPOSTA_EXPIRADA"];
export const ADM_ANTES_DA_APROVACAO = ["PROPOSTA_ENVIADA", "COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA", "AGUARDANDO_APROVACAO"];
export const ADM_CANDIDATO_PREENCHE = ["COMPLETANDO_CADASTRO", "CORRECAO_SOLICITADA"];

// ---------- Proposta ----------
// [tamanho máx., rótulo, obrigatório, o candidato vê]
export const CAMPOS_PROPOSTA = {
  tipo_contratacao: [60, "Tipo de contratação", true, true], situacao: [80, "Situação", false, true],
  cargo: [120, "Cargo", true, true], funcao: [120, "Função", true, true], departamento: [120, "Departamento", true, true],
  setor: [120, "Setor", false, true], horario_trabalho: [80, "Horário de trabalho", true, true],
  data_inicio: [10, "Data de início", true, true], bolsa_valor: [120, "Bolsa / remuneração", true, true],
  auxilio: [120, "Auxílio", false, true], data_inicial_bolsa: [10, "Início da bolsa", false, true],
  data_final_bolsa: [10, "Fim da bolsa / contrato", false, true],
  responsavel: [150, "Responsável", false, false], entidade_vinculada: [150, "Entidade vinculada", false, false],
  gestor_nome: [150, "Gestor", false, false], gestor_email: [200, "E-mail do gestor", false, false], observacao: [3000, "Observação interna", false, false]
};
export const CAMPOS_DATA_PROPOSTA = ["data_inicio", "data_inicial_bolsa", "data_final_bolsa"];

// ---------- Cadastro do candidato ----------
// [tamanho máx., obrigatório, rótulo, etapa do formulário]
export const CAMPOS_CADASTRO = {
  nome: [150, true, "Nome completo", "pessoais"], cpf: [20, true, "CPF", "pessoais"], rg: [30, true, "RG", "pessoais"],
  data_nascimento: [10, true, "Data de nascimento", "pessoais"], sexo: [40, false, "Sexo", "pessoais"],
  cnh: [30, false, "CNH", "pessoais"], ctps: [30, false, "CTPS", "pessoais"],
  telefone: [40, true, "Telefone / WhatsApp", "pessoais"], email_pessoal: [200, true, "E-mail pessoal", "pessoais"],
  curriculo_lattes: [300, false, "Currículo Lattes", "pessoais"],
  cep: [12, true, "CEP", "endereco"], endereco: [250, true, "Endereço", "endereco"], bairro: [120, true, "Bairro", "endereco"],
  cidade: [120, true, "Cidade", "endereco"], estado: [2, true, "UF", "endereco"],
  nome_emergencia: [150, true, "Contato de emergência", "endereco"], telefone_emergencia: [40, true, "Telefone de emergência", "endereco"],
  grau_instrucao: [60, true, "Grau de instrução", "formacao"], area_formacao: [150, true, "Curso / área", "formacao"],
  instituicao_ensino: [150, true, "Instituição de ensino", "formacao"], matricula_uff: [40, false, "Matrícula UFF", "formacao"],
  cr: [20, false, "CR acadêmico", "formacao"], email_innomaker: [200, false, "E-mail Innomaker", "formacao"],
  banco: [80, false, "Banco", "banco"], agencia: [20, false, "Agência", "banco"], conta: [30, false, "Conta", "banco"],
  tipo_conta: [40, false, "Tipo de conta", "banco"], pix_numero: [120, false, "Chave PIX", "banco"], pix_banco: [80, false, "Banco do PIX", "banco"]
};

// Lê e limpa os campos do cadastro (sem exigir os obrigatórios: serve também para o rascunho)
export function lerCadastro(src) {
  const d = {};
  Object.keys(CAMPOS_CADASTRO).forEach(k => { d[k] = texto(src && src[k], CAMPOS_CADASTRO[k][0]); });
  d.estado = d.estado.toUpperCase();
  return d;
}

export function cpfValido(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => {
    let s = 0;
    for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === +d[9] && dv(10) === +d[10];
}

// Validação do envio final: { ok } ou { erro, campos }
export function validarCadastro(d) {
  const faltando = Object.keys(CAMPOS_CADASTRO).filter(k => CAMPOS_CADASTRO[k][1] && !d[k]);
  if (faltando.length) return { erro: "Preencha os campos obrigatórios.", campos: faltando };
  if (!cpfValido(d.cpf)) return { erro: "CPF inválido.", campos: ["cpf"] };
  if (!ehDataISO(d.data_nascimento)) return { erro: "Data de nascimento inválida.", campos: ["data_nascimento"] };
  if (!emailValido(d.email_pessoal)) return { erro: "E-mail pessoal inválido.", campos: ["email_pessoal"] };
  if (/@id\.uff\.br$/i.test(d.email_pessoal)) return { erro: "Use um e-mail pessoal, não o IdUFF.", campos: ["email_pessoal"] };
  if (d.email_innomaker && !emailValido(d.email_innomaker)) return { erro: "E-mail Innomaker inválido.", campos: ["email_innomaker"] };
  if (!/^[A-Z]{2}$/.test(d.estado)) return { erro: "UF inválida (duas letras, ex.: RJ).", campos: ["estado"] };
  if (!d.pix_numero && !(d.banco && d.agencia && d.conta)) {
    return { erro: "Informe a chave PIX ou banco, agência e conta para receber a bolsa.", campos: ["pix_numero", "banco", "agencia", "conta"] };
  }
  return { ok: true };
}

// ---------- Documentos exigidos ----------
// "obrigatorio_para": ["todos"] ou tipos de contratação (comparação sem acento, por trecho: "estágio" vale para "Estágio obrigatório")
export const DOCUMENTOS_PADRAO = [
  { id: "doc_rg", nome: "RG (frente e verso) ou CNH", obrigatorio_para: ["todos"] },
  { id: "doc_cpf", nome: "CPF (se não estiver no RG)", obrigatorio_para: [] },
  { id: "doc_comprovante", nome: "Comprovante de residência (últimos 3 meses)", obrigatorio_para: ["todos"] },
  { id: "doc_matricula", nome: "Declaração de matrícula / regularização", obrigatorio_para: ["estágio"] },
  { id: "doc_cr", nome: "Declaração de CR ou histórico", obrigatorio_para: ["estágio"] },
  { id: "doc_plano", nome: "Plano de estudos", obrigatorio_para: [] },
  { id: "doc_ctps", nome: "Carteira de Trabalho Digital (CTPS)", obrigatorio_para: ["clt"] },
  { id: "doc_bancario", nome: "Comprovante dos dados bancários", obrigatorio_para: [] },
  { id: "doc_curriculo", nome: "Currículo atualizado", obrigatorio_para: [] }
];
// Categoria antiga (um único envio com RG, CPF e comprovante): continua valendo para admissões já iniciadas
export const CATEGORIA_ANTIGA = { doc_pessoais: "Documentos pessoais (RG, CPF, comprovante)" };
const CUMPRE_COM_ANTIGA = ["doc_rg", "doc_cpf", "doc_comprovante"];

export function listaDocumentos(config) {
  const lista = parseJson(config && config.admissao_documentos, null);
  return Array.isArray(lista) && lista.length ? lista : DOCUMENTOS_PADRAO;
}

export function documentosExigidos(config, tipoContratacao) {
  const tipo = normalizar(tipoContratacao);
  return listaDocumentos(config).filter(d => d.ativo !== false).map(d => ({
    id: d.id, nome: d.nome,
    obrigatorio: (d.obrigatorio_para || []).some(t => t === "todos" || (tipo && tipo.indexOf(normalizar(t)) >= 0))
  }));
}

export const nomeCategoria = (config, cat) => (listaDocumentos(config).find(d => d.id === cat) || {}).nome || CATEGORIA_ANTIGA[cat] || cat;
export const categoriaValida = (config, cat) => !!(listaDocumentos(config).some(d => d.id === cat) || CATEGORIA_ANTIGA[cat]);

// Documentos obrigatórios que ainda faltam (arquivos = [{ categoria, criado_em }])
export function documentosFaltando(exigidos, arquivos) {
  const tem = new Set(arquivos.map(a => a.categoria));
  return exigidos.filter(d => d.obrigatorio && !tem.has(d.id) && !(tem.has("doc_pessoais") && CUMPRE_COM_ANTIGA.indexOf(d.id) >= 0));
}

// ---------- Trilha da admissão ----------
export const PASSOS_MANUAIS = { conferencia: "documentos_conferidos", ponto: "ponto_cadastrado", acessos: "acessos_ok", onboarding: "onboarding_ok" };

// a = admissão (historico/checklist em texto), f = funcionário (ou null), docs = { total, assinados }
export function trilha(a, f, docs) {
  const hist = parseJson(a.historico, []);
  const chk = parseJson(a.checklist, {});
  const quando = re => { const h = hist.filter(x => re.test(x.acao || "")).pop(); return h ? h.quando : ""; };
  const st = a.status;
  const passouCadastro = ["AGUARDANDO_APROVACAO", "APROVADA"].indexOf(st) >= 0;
  const aprovada = st === "APROVADA";
  const total = docs ? docs.total : 0, assinados = docs ? docs.assinados : 0;
  const manual = (id, nome, ajuda) => ({
    id, nome, ajuda, manual: true,
    feito: !!(f && f[PASSOS_MANUAIS[id]]), quando: chk[id] ? chk[id].em : "", por: chk[id] ? chk[id].por : ""
  });
  const passos = [
    { id: "proposta", nome: "Proposta aceita", feito: ["PROPOSTA_ENVIADA"].concat(ADM_ENCERRADAS).indexOf(st) < 0 || !!quando(/Proposta aceita/), quando: quando(/Proposta aceita/) },
    { id: "cadastro", nome: "Cadastro e documentos enviados", feito: passouCadastro, quando: quando(/Cadastro (enviado|corrigido)/) },
    { id: "aprovacao", nome: "Cadastro aprovado (matrícula)", feito: aprovada, quando: quando(/Aprovada pelo RH/), detalhe: a.funcionario_id ? "Matrícula " + a.funcionario_id : "" },
    { id: "assinaturas", nome: "Documentos assinados", feito: aprovada && assinados === total, detalhe: aprovada ? (total ? assinados + " de " + total : "nenhum documento gerado") : "" },
    manual("conferencia", "Assinados conferidos", "Todos devolvidos, assinados, completos e legíveis (item 4.9)."),
    manual("ponto", "Cadastro no aplicativo de ponto", "Depois da conferência dos documentos (item 4.10)."),
    Object.assign(manual("acessos", "Acessos criados", "E-mail Innomaker e sistemas que a pessoa vai usar."),
      chk.acessos_pedido ? { detalhe: "Pedido enviado em " + chk.acessos_pedido.em.slice(0, 10).split("-").reverse().join("/") } : {}),
    manual("onboarding", "Onboarding realizado", "Sala, slides, camisa e crachá preparados; reunião no primeiro dia (item 6).")
  ];
  if (ADM_ENCERRADAS.indexOf(st) >= 0) passos.forEach(p => { if (!p.feito) p.encerrado = true; });
  // antes da aprovação, os passos manuais não se aplicam ainda
  if (!aprovada) passos.forEach(p => { if (p.manual) p.bloqueado = true; });
  const feitos = passos.filter(p => p.feito).length;
  const proximo = passos.find(p => !p.feito && !p.encerrado);
  return { passos, feitos, total: passos.length, proximo: proximo ? proximo.nome : "", concluida: feitos === passos.length };
}
