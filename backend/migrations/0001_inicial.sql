-- Banco de dados do sistema de recrutamento e admissão Innomaker (Cloudflare D1)
-- Datas/horas: ISO 8601 em UTC ("2026-11-04T13:00:00.000Z"). Datas simples: "AAAA-MM-DD".

CREATE TABLE sequencias (
  nome  TEXT PRIMARY KEY,
  valor INTEGER NOT NULL
);

CREATE TABLE config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);

-- Departamentos e seus gestores (antiga aba EMAIL)
CREATE TABLE departamentos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT NOT NULL UNIQUE,
  gestor_nome  TEXT NOT NULL DEFAULT '',
  gestor_email TEXT NOT NULL DEFAULT '',
  ativo        INTEGER NOT NULL DEFAULT 1
);

-- Listas de opções (antiga aba Informações): cargo, funcao, setor, situacao, auxilio,
-- horario, tipo_contratacao, tipo_vaga, grau_instrucao, etapa
CREATE TABLE listas (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo  TEXT NOT NULL,
  valor TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tipo, valor)
);

-- Solicitações de contratação feitas pelos gestores (RHC-PROC-2026-002)
CREATE TABLE solicitacoes (
  id                       TEXT PRIMARY KEY,               -- SOL-2026-000001
  status                   TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE, REAJUSTE, APROVADA, RECUSADA, VAGA_CRIADA
  departamento             TEXT NOT NULL,
  titulo                   TEXT NOT NULL,
  quantidade               INTEGER NOT NULL DEFAULT 1,
  data_limite              TEXT NOT NULL,
  localidade               TEXT NOT NULL DEFAULT '',
  tipo_vaga                TEXT NOT NULL DEFAULT '',
  tipo_contratacao         TEXT NOT NULL DEFAULT '',
  carga_horaria            TEXT NOT NULL DEFAULT '',
  remuneracao              TEXT NOT NULL DEFAULT '',
  descricao                TEXT NOT NULL DEFAULT '',
  habilidades_obrigatorias TEXT NOT NULL DEFAULT '',
  habilidades_diferenciais TEXT NOT NULL DEFAULT '',
  principais_funcoes       TEXT NOT NULL DEFAULT '',
  competencias             TEXT NOT NULL DEFAULT '',
  motivo                   TEXT NOT NULL DEFAULT '',
  urgencia                 TEXT NOT NULL DEFAULT '',
  gestor_responsavel       TEXT NOT NULL DEFAULT '',
  observacoes              TEXT NOT NULL DEFAULT '',
  solicitante_login        TEXT NOT NULL DEFAULT '',
  solicitante_nome         TEXT NOT NULL DEFAULT '',
  solicitante_email        TEXT NOT NULL DEFAULT '',
  decidido_por             TEXT,
  decidido_em              TEXT,
  historico                TEXT NOT NULL DEFAULT '[]',
  vaga_id                  TEXT,
  criado_em                TEXT NOT NULL,
  atualizado_em            TEXT NOT NULL
);
CREATE INDEX ix_solic_email ON solicitacoes (solicitante_email);
CREATE INDEX ix_solic_status ON solicitacoes (status);

-- Vagas publicadas (RHC-PROC-2026-001)
CREATE TABLE vagas (
  id                 TEXT PRIMARY KEY,                     -- VAG-2026-0001
  solicitacao_id     TEXT,
  titulo             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'Aberta',       -- Aberta, Pausada, Fechada, Concluída
  data_limite        TEXT,
  departamento       TEXT NOT NULL DEFAULT '',
  gestor_nome        TEXT NOT NULL DEFAULT '',
  gestor_email       TEXT NOT NULL DEFAULT '',
  quantidade         INTEGER NOT NULL DEFAULT 1,
  localidade         TEXT NOT NULL DEFAULT '',
  tipo_vaga          TEXT NOT NULL DEFAULT '',
  tipo_contratacao   TEXT NOT NULL DEFAULT '',
  carga_horaria      TEXT NOT NULL DEFAULT '',
  remuneracao        TEXT NOT NULL DEFAULT '',
  descricao          TEXT NOT NULL DEFAULT '',
  requisitos         TEXT NOT NULL DEFAULT '',
  principais_funcoes TEXT NOT NULL DEFAULT '',
  etapas             TEXT NOT NULL DEFAULT '["Triagem"]',  -- nomes das etapas, em ordem
  criado_por         TEXT NOT NULL DEFAULT '',
  criado_em          TEXT NOT NULL,
  atualizado_em      TEXT NOT NULL
);
CREATE INDEX ix_vagas_status ON vagas (status);

-- Contas dos candidatos (área do candidato)
CREATE TABLE candidatos (
  id               TEXT PRIMARY KEY,                       -- CAN-2026-000001
  email            TEXT NOT NULL UNIQUE,
  nome             TEXT NOT NULL,
  telefone         TEXT NOT NULL DEFAULT '',
  senha_hash       TEXT,
  senha_salt       TEXT,
  versao_sessao    INTEGER NOT NULL DEFAULT 1,
  tentativas       INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate    TEXT,
  senha_enviada_em TEXT,
  ultimo_login     TEXT,
  criado_em        TEXT NOT NULL
);

CREATE TABLE candidaturas (
  id                 TEXT PRIMARY KEY,                     -- CDT-2026-000001
  candidato_id       TEXT NOT NULL REFERENCES candidatos (id),
  vaga_id            TEXT NOT NULL REFERENCES vagas (id),
  periodo_curso      TEXT NOT NULL DEFAULT '',
  previsao_formatura TEXT NOT NULL DEFAULT '',
  mensagem           TEXT NOT NULL DEFAULT '',
  curriculo_id       TEXT,
  status             TEXT NOT NULL DEFAULT 'Em processo',  -- Em processo, Aprovado, Encerrado, Proposta, Contratado, Desistiu
  obs                TEXT NOT NULL DEFAULT '',
  criado_em          TEXT NOT NULL,
  atualizado_em      TEXT NOT NULL,
  UNIQUE (candidato_id, vaga_id)
);
CREATE INDEX ix_cdt_vaga ON candidaturas (vaga_id);
CREATE INDEX ix_cdt_candidato ON candidaturas (candidato_id);

-- Etapas do processo seletivo de cada candidatura (antiga aba ETAPAS)
CREATE TABLE etapas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  candidatura_id TEXT NOT NULL REFERENCES candidaturas (id),
  ordem          INTEGER NOT NULL,
  nome           TEXT NOT NULL,
  resultado      TEXT NOT NULL DEFAULT 'Pendente',          -- Pendente, Aprovado, Reprovado
  motivo         TEXT NOT NULL DEFAULT '',
  mensagem       TEXT NOT NULL DEFAULT '',
  responsavel    TEXT NOT NULL DEFAULT '',
  data_prevista  TEXT NOT NULL DEFAULT '',
  data_realizada TEXT NOT NULL DEFAULT '',
  obs            TEXT NOT NULL DEFAULT '',
  notificado_em  TEXT
);
CREATE INDEX ix_etapas_cdt ON etapas (candidatura_id);

-- Arquivos guardados no R2 (currículos e documentos de admissão)
CREATE TABLE arquivos (
  id           TEXT PRIMARY KEY,
  r2_key       TEXT NOT NULL,
  nome         TEXT NOT NULL,
  tipo_mime    TEXT NOT NULL DEFAULT '',
  tamanho      INTEGER NOT NULL DEFAULT 0,
  categoria    TEXT NOT NULL DEFAULT '',
  candidato_id TEXT,
  admissao_id  TEXT,
  criado_em    TEXT NOT NULL
);
CREATE INDEX ix_arq_admissao ON arquivos (admissao_id);

-- Admissões (RHC-PROC-2026-003)
CREATE TABLE admissoes (
  id             TEXT PRIMARY KEY,                         -- ADM-2026-000001
  candidatura_id TEXT NOT NULL REFERENCES candidaturas (id),
  candidato_id   TEXT NOT NULL,
  vaga_id        TEXT NOT NULL,
  status         TEXT NOT NULL,  -- PROPOSTA_ENVIADA, PROPOSTA_RECUSADA, COMPLETANDO_CADASTRO,
                                 -- AGUARDANDO_APROVACAO, CORRECAO_SOLICITADA, APROVADA, RECUSADA
  email_contato  TEXT NOT NULL,
  proposta       TEXT NOT NULL DEFAULT '{}',
  cadastro       TEXT NOT NULL DEFAULT '{}',
  historico      TEXT NOT NULL DEFAULT '[]',
  funcionario_id INTEGER,
  criado_por     TEXT NOT NULL DEFAULT '',
  criado_em      TEXT NOT NULL,
  atualizado_em  TEXT NOT NULL
);
CREATE INDEX ix_adm_status ON admissoes (status);
CREATE INDEX ix_adm_candidato ON admissoes (candidato_id);

-- Funcionários registrados (antiga aba Registros)
CREATE TABLE funcionarios (
  matricula             INTEGER PRIMARY KEY AUTOINCREMENT,
  admissao_id           TEXT UNIQUE,
  candidato_id          TEXT,
  nome                  TEXT NOT NULL,
  email                 TEXT NOT NULL DEFAULT '',
  email_innomaker       TEXT NOT NULL DEFAULT '',
  telefone              TEXT NOT NULL DEFAULT '',
  situacao              TEXT NOT NULL DEFAULT '',
  cargo                 TEXT NOT NULL DEFAULT '',
  funcao                TEXT NOT NULL DEFAULT '',
  departamento          TEXT NOT NULL DEFAULT '',
  setor                 TEXT NOT NULL DEFAULT '',
  horario_trabalho      TEXT NOT NULL DEFAULT '',
  tipo_contratacao      TEXT NOT NULL DEFAULT '',
  bolsa_valor           TEXT NOT NULL DEFAULT '',
  auxilio               TEXT NOT NULL DEFAULT '',
  responsavel           TEXT NOT NULL DEFAULT '',
  entidade_vinculada    TEXT NOT NULL DEFAULT '',
  principais_funcoes    TEXT NOT NULL DEFAULT '',
  data_efetivacao       TEXT NOT NULL DEFAULT '',
  data_final_contrato   TEXT NOT NULL DEFAULT '',
  dados                 TEXT NOT NULL DEFAULT '{}',        -- CPF, RG, endereço, banco, formação, emergência
  ponto_cadastrado      INTEGER NOT NULL DEFAULT 0,
  documentos_conferidos INTEGER NOT NULL DEFAULT 0,
  onboarding_ok         INTEGER NOT NULL DEFAULT 0,
  lembrete_renovacao_em TEXT,
  ativo                 INTEGER NOT NULL DEFAULT 1,
  criado_em             TEXT NOT NULL,
  atualizado_em         TEXT NOT NULL
);

-- Modelos de documento (Termo de Compromisso, Direito de Imagem, Apêndice de Bolsa…)
CREATE TABLE modelos_documento (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo            TEXT NOT NULL DEFAULT '',
  nome              TEXT NOT NULL UNIQUE,
  conteudo          TEXT NOT NULL,
  gerar_na_admissao INTEGER NOT NULL DEFAULT 1,
  ativo             INTEGER NOT NULL DEFAULT 1,
  atualizado_em     TEXT NOT NULL
);

-- Documentos gerados e assinados eletronicamente
CREATE TABLE documentos (
  id                    TEXT PRIMARY KEY,
  funcionario_matricula INTEGER,
  admissao_id           TEXT,
  candidato_id          TEXT,
  modelo_id             INTEGER,
  titulo                TEXT NOT NULL,
  conteudo              TEXT NOT NULL,
  hash                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'AGUARDANDO_ASSINATURA', -- AGUARDANDO_ASSINATURA, ASSINADO, CANCELADO
  assinado_em           TEXT,
  assinado_nome         TEXT,
  assinado_cpf          TEXT,
  assinado_ip           TEXT,
  criado_por            TEXT NOT NULL DEFAULT '',
  criado_em             TEXT NOT NULL
);
CREATE INDEX ix_doc_func ON documentos (funcionario_matricula);
CREATE INDEX ix_doc_cand ON documentos (candidato_id);

CREATE TABLE log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quando      TEXT NOT NULL,
  quem        TEXT NOT NULL DEFAULT '',
  acao        TEXT NOT NULL,
  entidade    TEXT NOT NULL DEFAULT '',
  entidade_id TEXT NOT NULL DEFAULT '',
  detalhe     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_log_quando ON log (quando);

CREATE TABLE emails (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  quando  TEXT NOT NULL,
  para    TEXT NOT NULL,
  assunto TEXT NOT NULL,
  status  TEXT NOT NULL,          -- ENVIADO, FALHOU, SEM_PROVEDOR
  erro    TEXT NOT NULL DEFAULT '',
  corpo   TEXT NOT NULL DEFAULT '' -- só preenchido em desenvolvimento local
);
