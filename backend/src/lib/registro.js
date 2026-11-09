// Registro dos funcionários no formato da aba "Registros" (64 colunas, nesta ordem) — para baixar em Excel.
import { hojeISO, parseJson } from "./http.js";

export const COLUNAS = [
  "Matricula", "vazio", "Situação", "Nome Completo", "Sexo", "Data Nascimento", "Mes de aniversário", "Idade", "CPF", "RG",
  "ORGÃO EXP/UF", "CNH", "ORGÃO EXP/UF", "CTPS", "ORGÃO EXP/UF", "Telefone de contato", "E-mail", "vazio",
  "CEP", "Endereço", "Bairro", "Cidade", "Estado", "vazio", "Data da matrícula*", "Auxílio", "Bolsa - Valor", "Responsável",
  "Entidade Vinculada", "Data Inicial Bolsa", "Data Final Bolsa", "Bolsa - Innomaker", "SALÁRIO BRUTO", "Observação do Salário",
  "vazio", "Função", "Departamento", "Setor", "Horário de trabalho", "Data de Efetivação", "Data Final Contrato Innomaker",
  "Observação do Funcionário", "Curriculo lattes", "Grau de instrução", "Área de Formação", "Instituição de ensino", "CR",
  "DRIVE", "Planilha de Horário", "Matricula - UFF", "Email innomaker", "Planilha de Registro", "Data do Ultimo termo assinado",
  "Nº do PIX", "Banco do pix", "Foto", "Termo de Compromisso", "Direito de Imagem", "Aumento", "Mudança da Forma de Pagamento",
  "Principais funções", "Divisão Salario", "Resumo", "employeeIdChronos"
];

const so = s => String(s == null ? "" : s).trim();
const digitos = s => so(s).replace(/\D/g, "");
const ehIso = s => /^\d{4}-\d{2}-\d{2}$/.test(so(s));
const data = s => ehIso(s) ? { t: "data", v: so(s) } : so(s);
const moeda = s => { const n = valorMonetario(s); return typeof n === "number" ? { t: "moeda", v: n } : n; };

export function cpfFormatado(cpf) {
  const d = digitos(cpf);
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : so(cpf);
}

// "R$ 1.200,50" → 1200.5; texto que não é valor fica como está
export function valorMonetario(v) {
  const t = so(v);
  if (!t) return "";
  const limpo = t.replace(/[R$\s]/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(limpo)) return t;
  const n = /,\d{1,2}$/.test(limpo) || /\.\d{3}/.test(limpo) ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
  return Number.isFinite(n) ? n : t;
}

export function idade(nascimentoIso, hojeIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(so(nascimentoIso));
  const h = /^(\d{4})-(\d{2})-(\d{2})$/.exec(so(hojeIso));
  if (!m || !h) return "";
  let anos = Number(h[1]) - Number(m[1]);
  if (Number(h[2]) < Number(m[2]) || (h[2] === m[2] && Number(h[3]) < Number(m[3]))) anos--;
  return anos >= 0 && anos < 130 ? anos : "";
}

// Uma linha (64 células) a partir do funcionário. Células: texto, número ou { t: data|mes|moeda, v }.
export function linhaRegistro(f, opts) {
  const d = typeof f.dados === "string" ? parseJson(f.dados, {}) : (f.dados || {});
  const o = opts || {};
  const hoje = o.hoje || hojeISO();
  const cr = so(d.cr).replace(",", ".");
  const v = {
    0: f.matricula ? Number(f.matricula) : "",
    2: so(f.situacao) || (f.ativo === 0 ? "Não ativo" : "Ativo"),
    3: so(f.nome), 4: so(d.sexo),
    5: data(d.data_nascimento), 6: ehIso(d.data_nascimento) ? { t: "mes", v: so(d.data_nascimento) } : "", 7: idade(d.data_nascimento, hoje),
    8: cpfFormatado(d.cpf), 9: so(d.rg), 10: so(d.rg_orgao), 11: so(d.cnh), 12: so(d.cnh_orgao), 13: so(d.ctps), 14: so(d.ctps_orgao),
    15: so(f.telefone), 16: so(f.email),
    18: digitos(d.cep), 19: so(d.endereco), 20: so(d.bairro), 21: so(d.cidade), 22: so(d.estado),
    24: data(o.dataMatricula || String(f.criado_em || "").slice(0, 10) || hoje),
    25: so(f.auxilio), 26: moeda(f.bolsa_valor),
    27: so(f.responsavel), 28: so(f.entidade_vinculada),
    // registros antigos (antes da bolsa Innomaker separada) usam as datas do contrato
    29: data(f.bolsa_innomaker ? f.data_inicial_bolsa : f.data_efetivacao), 30: data(f.bolsa_innomaker ? f.data_final_bolsa : f.data_final_contrato),
    31: moeda(f.bolsa_innomaker), 32: moeda(f.salario_bruto),
    35: so(f.funcao), 36: so(f.departamento), 37: so(f.setor), 38: so(f.horario_trabalho),
    39: data(f.data_efetivacao), 40: data(f.data_final_contrato),
    41: f.admissao_id ? "Admitido pelo sistema de vagas (" + f.admissao_id + ")" + (f.tipo_contratacao ? " — " + f.tipo_contratacao : "") : "",
    42: so(d.curriculo_lattes), 43: so(d.grau_instrucao), 44: so(d.area_formacao), 45: so(d.instituicao_ensino),
    46: cr && Number.isFinite(Number(cr)) ? Number(cr) : so(d.cr),
    49: so(d.matricula_uff), 50: so(f.email_innomaker),
    53: so(d.pix_numero), 54: so(d.pix_banco), 55: d.foto_id && o.siteUrl ? o.siteUrl + "/arquivo/" + d.foto_id : "",
    60: so(f.principais_funcoes), 62: so(d.resumo)
  };
  return COLUNAS.map((_, i) => (i in v ? v[i] : ""));
}
