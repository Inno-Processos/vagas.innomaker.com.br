-- LGPD, banco de talentos, origem das candidaturas (indicadores) e lembretes automáticos.

-- Consentimento do candidato (LGPD): aceite da política de privacidade e, à parte, do banco de talentos
ALTER TABLE candidatos ADD COLUMN consentimento_em TEXT;            -- aceite da política na inscrição
ALTER TABLE candidatos ADD COLUMN banco_talentos INTEGER NOT NULL DEFAULT 0;  -- 1 = aceitou ficar no banco de talentos
ALTER TABLE candidatos ADD COLUMN banco_talentos_em TEXT;           -- quando aceitou (ou renovou) o banco de talentos
ALTER TABLE candidatos ADD COLUMN ultima_atividade TEXT;            -- base do prazo de guarda dos dados

-- Banco de talentos: anotação do RH sobre o candidato
ALTER TABLE candidatos ADD COLUMN talento_marcado INTEGER NOT NULL DEFAULT 0; -- 1 = RH marcou "manter no banco"
ALTER TABLE candidatos ADD COLUMN talento_nota TEXT NOT NULL DEFAULT '';
ALTER TABLE candidatos ADD COLUMN talento_tags TEXT NOT NULL DEFAULT '';      -- palavras-chave separadas por vírgula
ALTER TABLE candidatos ADD COLUMN talento_por TEXT NOT NULL DEFAULT '';
ALTER TABLE candidatos ADD COLUMN talento_em TEXT;

-- De onde veio a candidatura (indicadores): site, indicacao, linkedin, instagram, universidade, outro
ALTER TABLE candidaturas ADD COLUMN origem TEXT NOT NULL DEFAULT 'site';
ALTER TABLE candidaturas ADD COLUMN indicado_por TEXT NOT NULL DEFAULT '';
ALTER TABLE candidaturas ADD COLUMN convite_talento INTEGER NOT NULL DEFAULT 0; -- veio de um convite do banco de talentos

-- Lembretes automáticos
ALTER TABLE agenda_horarios ADD COLUMN lembrete_em TEXT;            -- lembrete de 1 dia antes da entrevista
ALTER TABLE admissoes ADD COLUMN lembrete_em TEXT;                  -- lembrete de cadastro/documentos faltando
ALTER TABLE admissoes ADD COLUMN lembretes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documentos ADD COLUMN lembrete_em TEXT;                 -- lembrete de documento sem assinatura
ALTER TABLE documentos ADD COLUMN lembretes INTEGER NOT NULL DEFAULT 0;

-- Prazos de guarda (meses) — editáveis em Painel → Configurações
INSERT OR IGNORE INTO config (chave, valor) VALUES ('lgpd_meses_retencao', '12');
INSERT OR IGNORE INTO config (chave, valor) VALUES ('lgpd_meses_banco', '24');

UPDATE candidatos SET ultima_atividade = COALESCE(ultimo_login, criado_em) WHERE ultima_atividade IS NULL;
CREATE INDEX ix_cand_banco ON candidatos (banco_talentos);
CREATE INDEX ix_cdt_origem ON candidaturas (origem);
