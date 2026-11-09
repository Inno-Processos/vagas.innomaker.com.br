-- Agendamento de horários com reserva (entrevistas, testes) por etapa do processo seletivo.
-- O RH abre uma agenda com os horários em que pode atender; o candidato recebe um link e reserva um.
-- Horário reservado não pode ser ocupado por outro candidato.

CREATE TABLE agendas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vaga_id       TEXT NOT NULL REFERENCES vagas (id),
  etapa_nome    TEXT NOT NULL,                       -- ex.: Entrevista RH (mesmo nome da etapa da vaga)
  local_tipo    TEXT NOT NULL DEFAULT 'presencial',  -- presencial | online
  local         TEXT NOT NULL DEFAULT '',            -- endereço/sala ou link da reunião
  duracao_min   INTEGER NOT NULL DEFAULT 30,
  instrucoes    TEXT NOT NULL DEFAULT '',            -- vai no convite ao candidato
  participantes TEXT NOT NULL DEFAULT '[]',          -- [{ "nome": "...", "email": "..." }] — RH, funcionário e convidados
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_por    TEXT NOT NULL DEFAULT '',
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE agenda_horarios (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  agenda_id           INTEGER NOT NULL REFERENCES agendas (id),
  inicio              TEXT NOT NULL,                 -- AAAA-MM-DDTHH:MM (horário de Brasília)
  fim                 TEXT NOT NULL,
  etapa_id            INTEGER REFERENCES etapas (id), -- preenchido = reservado por este candidato/etapa
  reservado_em        TEXT,
  participantes_extra TEXT NOT NULL DEFAULT '[]',    -- convidados só desta entrevista
  sequencia           INTEGER NOT NULL DEFAULT 0,    -- versão do convite de calendário (.ics)
  UNIQUE (agenda_id, inicio)
);
-- cada etapa de um candidato ocupa no máximo um horário
CREATE UNIQUE INDEX agenda_horarios_etapa ON agenda_horarios (etapa_id) WHERE etapa_id IS NOT NULL;

ALTER TABLE etapas ADD COLUMN agenda_id INTEGER;
ALTER TABLE etapas ADD COLUMN agenda_token TEXT;
ALTER TABLE etapas ADD COLUMN convidado_em TEXT;
CREATE UNIQUE INDEX etapas_agenda_token ON etapas (agenda_token) WHERE agenda_token IS NOT NULL;
