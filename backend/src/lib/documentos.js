// Modelos de documento: preenchimento dos campos {{CAMPO}} e conversão para HTML.
import { ErroApi, esc, dataBR, parseJson, somarAnos } from "./http.js";

export const CAMPOS_DOCUMENTO = {
  NOME: "Nome completo", CPF: "CPF", RG: "RG", EMAIL: "E-mail pessoal", EMAIL_INNOMAKER: "E-mail Innomaker",
  TELEFONE: "Telefone", ENDERECO: "Endereço", BAIRRO: "Bairro", CEP: "CEP", CIDADE_ESTADO: "Cidade - UF",
  CURSO: "Curso / área de formação", INSTITUICAO: "Instituição de ensino", MATRICULA_UFF: "Matrícula UFF",
  MATRICULA: "Matrícula Innomaker", CARGO: "Cargo", FUNCAO: "Função", DEPARTAMENTO: "Departamento", SETOR: "Setor",
  CARGA_HORARIA: "Horário de trabalho", BOLSA_VALOR: "Bolsa / remuneração", AUXILIO: "Auxílio",
  PRINCIPAIS_FUNCOES: "Principais funções", DATA_INICIO: "Data de início", DATA_FIM: "Data final do contrato",
  DATA_HOJE: "Data de hoje", PIX: "Chave PIX", DADOS_BANCARIOS: "Banco / agência / conta",
  RESPONSAVEL: "Responsável", ENTIDADE_VINCULADA: "Entidade vinculada",
  DATA_NASCIMENTO: "Data de nascimento", TIPO_CONTRATACAO: "Tipo de contratação", PERIODO_CURSO: "Período / semestre do curso",
  PREVISAO_FORMATURA: "Previsão de formatura", GESTOR: "Gestor / supervisor", ESTADO: "UF", CIDADE: "Cidade"
};

const RX = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

export function camposUsados(conteudo) {
  const s = new Set();
  String(conteudo || "").replace(RX, (_, k) => { s.add(k); return ""; });
  return [...s];
}

export function validarModelo(conteudo) {
  const desconhecidos = camposUsados(conteudo).filter(k => !CAMPOS_DOCUMENTO[k]);
  if (desconhecidos.length) throw new ErroApi("Campos desconhecidos no modelo: " + desconhecidos.map(k => "{{" + k + "}}").join(", "));
}

// Valores a partir do funcionário registrado
export function valoresDoFuncionario(f, hojeIso, extra) {
  const d = parseJson(f.dados, {});
  const junta = arr => arr.map(x => String(x || "").trim()).filter(Boolean).join(" / ");
  return {
    NOME: f.nome, CPF: d.cpf, RG: d.rg, EMAIL: f.email, EMAIL_INNOMAKER: f.email_innomaker, TELEFONE: f.telefone,
    ENDERECO: d.endereco, BAIRRO: d.bairro, CEP: d.cep,
    CIDADE_ESTADO: (d.cidade && d.estado) ? d.cidade + " - " + d.estado : (d.cidade || d.estado || ""),
    CURSO: d.area_formacao, INSTITUICAO: d.instituicao_ensino, MATRICULA_UFF: d.matricula_uff,
    MATRICULA: String(f.matricula || ""), CARGO: f.cargo, FUNCAO: f.funcao, DEPARTAMENTO: f.departamento, SETOR: f.setor,
    CARGA_HORARIA: f.horario_trabalho, BOLSA_VALOR: f.bolsa_valor, AUXILIO: f.auxilio,
    PRINCIPAIS_FUNCOES: f.principais_funcoes,
    DATA_INICIO: dataBR(f.data_efetivacao), DATA_FIM: dataBR(f.data_final_contrato || somarAnos(f.data_efetivacao, 1)),
    DATA_HOJE: dataBR(hojeIso), PIX: junta([d.pix_numero, d.pix_banco]), DADOS_BANCARIOS: junta([d.banco, d.agencia, d.conta, d.tipo_conta]),
    RESPONSAVEL: f.responsavel, ENTIDADE_VINCULADA: f.entidade_vinculada,
    DATA_NASCIMENTO: dataBR(d.data_nascimento), TIPO_CONTRATACAO: f.tipo_contratacao, CIDADE: d.cidade, ESTADO: d.estado,
    PERIODO_CURSO: (extra && extra.periodo_curso) || "", PREVISAO_FORMATURA: (extra && extra.previsao_formatura) || "",
    GESTOR: (extra && extra.gestor) || f.responsavel || ""
  };
}

// Funcionário "previsto" a partir da admissão (antes da aprovação): proposta + cadastro já preenchido
export function funcionarioDaAdmissao(a, cand, vaga) {
  const p = parseJson(a.proposta, {});
  const rasc = parseJson(a.rascunho, {});
  const c = Object.keys(rasc).length ? rasc : parseJson(a.cadastro, {});
  return {
    matricula: a.funcionario_id || "", nome: c.nome || cand.nome, email: c.email_pessoal || a.email_contato || cand.email,
    email_innomaker: c.email_innomaker || "", telefone: c.telefone || cand.telefone || "",
    cargo: p.cargo, funcao: p.funcao, departamento: p.departamento, setor: p.setor, horario_trabalho: p.horario_trabalho,
    bolsa_valor: p.bolsa_valor, auxilio: p.auxilio, responsavel: p.responsavel, entidade_vinculada: p.entidade_vinculada,
    principais_funcoes: vaga ? vaga.principais_funcoes : "", tipo_contratacao: p.tipo_contratacao,
    data_efetivacao: p.data_inicio, data_final_contrato: p.data_final_bolsa || "", dados: JSON.stringify(c)
  };
}

// Prévia para leitura: o que ainda não foi preenchido aparece como linha em branco
export function previaModelo(modelo, valores) {
  return String(modelo.conteudo).replace(RX, (_, k) => String(valores[k] == null ? "" : valores[k]).trim() || "______________");
}

// Modelo vale para o tipo de contratação? (aplica_a vazio = todos; comparação sem acento, por trecho)
export function modeloAplica(m, tipo) {
  const lista = parseJson(m.aplica_a, []);
  if (!lista.length) return true;
  const n = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return lista.some(t => n(tipo).indexOf(n(t)) >= 0);
}

// Preenche o modelo. Campo vazio → operação cancelada (RHC-PROC-2026-003, item 5.2).
export function preencherModelo(modelo, valores, matricula) {
  const vazios = camposUsados(modelo.conteudo).filter(k => !String(valores[k] == null ? "" : valores[k]).trim());
  if (vazios.length) {
    throw new ErroApi(`Matrícula ${matricula}: ${vazios.map(k => CAMPOS_DOCUMENTO[k] || k).join(", ")} ${vazios.length > 1 ? "estão vazios" : "está vazio"}. ` +
      `Documento: ${modelo.nome}. Operação cancelada.`);
  }
  return String(modelo.conteudo).replace(RX, (_, k) => String(valores[k]).trim());
}

// Texto do modelo → HTML. "# " título, "## " subtítulo, linha em branco separa parágrafos.
export function textoParaHtml(t) {
  return String(t || "").split(/\n{2,}/).map(bloco => {
    const b = bloco.trim();
    if (!b) return "";
    if (b.startsWith("## ")) return "<h3>" + esc(b.slice(3)) + "</h3>";
    if (b.startsWith("# ")) return "<h2>" + esc(b.slice(2)) + "</h2>";
    return "<p>" + esc(b).replace(/\n/g, "<br>") + "</p>";
  }).join("\n");
}
