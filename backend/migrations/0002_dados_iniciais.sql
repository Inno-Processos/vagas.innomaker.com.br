-- Dados iniciais. Tudo pode ser alterado no painel → Configurações.

INSERT INTO config (chave, valor) VALUES
  ('email_rh', 'ainnomaker@gmail.com'),
  ('link_cartilha', 'https://docs.google.com/document/d/143viamTQDLmn5KvZ9WI9IDS_QS9AQH-Bn36QD6LdyT8/edit'),
  ('link_onboarding', ''),
  ('links_colaborador', '[{"titulo":"Cartilha do Colaborador","descricao":"Regras, rotinas e benefícios (ADM-REG-2026-005).","url":"https://docs.google.com/document/d/143viamTQDLmn5KvZ9WI9IDS_QS9AQH-Bn36QD6LdyT8/edit"},{"titulo":"Site da Innomaker","descricao":"Site institucional.","url":"https://innomaker.com.br/"}]');

INSERT INTO listas (tipo, valor, ordem) VALUES
  ('etapa', 'Triagem', 1),
  ('etapa', 'Entrevista RH', 2),
  ('etapa', 'Teste técnico', 3),
  ('etapa', 'Entrevista com gestor', 4),
  ('etapa', 'Proposta', 5),
  ('tipo_contratacao', 'Estágio', 1),
  ('tipo_contratacao', 'Bolsista', 2),
  ('tipo_contratacao', 'CLT', 3),
  ('tipo_contratacao', 'PJ', 4),
  ('tipo_vaga', 'Presencial', 1),
  ('tipo_vaga', 'Híbrido', 2),
  ('tipo_vaga', 'Remoto', 3),
  ('horario', '20 horas semanais', 1),
  ('horario', '30 horas semanais', 2),
  ('horario', '40 horas semanais', 3),
  ('situacao', 'Ativo', 1),
  ('situacao', 'Estagiário', 2),
  ('situacao', 'Bolsista', 3),
  ('auxilio', 'Nenhum', 1),
  ('auxilio', 'Auxílio transporte', 2),
  ('grau_instrucao', 'Graduando', 1),
  ('grau_instrucao', 'Graduado', 2),
  ('grau_instrucao', 'Mestrando', 3),
  ('grau_instrucao', 'Mestre', 4),
  ('grau_instrucao', 'Doutorando', 5),
  ('grau_instrucao', 'Doutor', 6);

-- Modelos provisórios: o RH deve colar o texto oficial (ADM-TEMP-2026-001, 007 e 005) no painel.
INSERT INTO modelos_documento (codigo, nome, conteudo, gerar_na_admissao, ativo, atualizado_em) VALUES
('ADM-TEMP-2026-001', 'Termo de Compromisso de Estágio',
'# TERMO DE COMPROMISSO DE ESTÁGIO

MODELO PROVISÓRIO — substitua pelo texto oficial do ADM-TEMP-2026-001 em Painel → Configurações → Modelos de documento.

Pelo presente instrumento, a INNOMAKER e {{NOME}}, CPF {{CPF}}, RG {{RG}}, estudante de {{CURSO}}, matrícula UFF {{MATRICULA_UFF}}, residente em {{ENDERECO}}, {{BAIRRO}}, CEP {{CEP}}, {{CIDADE_ESTADO}}, telefone {{TELEFONE}}, celebram este Termo de Compromisso.

## Atividades
{{PRINCIPAIS_FUNCOES}}

## Jornada e bolsa
Carga horária: {{CARGA_HORARIA}}.
Bolsa: {{BOLSA_VALOR}}.

## Vigência
De {{DATA_INICIO}} a {{DATA_FIM}}.

Matrícula Innomaker: {{MATRICULA}}.', 1, 1, '2026-11-04T00:00:00.000Z'),
('ADM-TEMP-2026-007', 'Termo de Direito de Imagem',
'# TERMO DE AUTORIZAÇÃO DE USO DE IMAGEM

MODELO PROVISÓRIO — substitua pelo texto oficial do ADM-TEMP-2026-007 em Painel → Configurações → Modelos de documento.

Eu, {{NOME}}, CPF {{CPF}}, RG {{RG}}, residente em {{ENDERECO}}, {{BAIRRO}}, CEP {{CEP}}, {{CIDADE_ESTADO}}, e-mail {{EMAIL}}, autorizo a INNOMAKER a utilizar minha imagem e voz em materiais institucionais, a partir de {{DATA_INICIO}}.', 1, 1, '2026-11-04T00:00:00.000Z'),
('ADM-TEMP-2026-005', 'Apêndice — Bolsa-auxílio e forma de pagamento',
'# APÊNDICE — BOLSA-AUXÍLIO E FORMA DE PAGAMENTO

MODELO PROVISÓRIO — substitua pelo texto oficial do ADM-TEMP-2026-005.

Beneficiário: {{NOME}}, CPF {{CPF}}.
Bolsa-auxílio: {{BOLSA_VALOR}}.
Pagamento via PIX: {{PIX}}.
Dados bancários: {{DADOS_BANCARIOS}}.', 0, 1, '2026-11-04T00:00:00.000Z');
