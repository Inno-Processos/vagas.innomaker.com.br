-- "Esqueci minha senha" por link de uso único
ALTER TABLE candidatos ADD COLUMN reset_hash TEXT;
ALTER TABLE candidatos ADD COLUMN reset_expira TEXT;
CREATE INDEX ix_cand_reset ON candidatos (reset_hash);

-- E-mails que falharam: nova tentativa automática (5 min, 15 min, 1 h, 3 h, 6 h)
CREATE TABLE emails_fila (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id    INTEGER,
  mensagem    TEXT NOT NULL,
  tentativas  INTEGER NOT NULL DEFAULT 1,
  proxima_em  TEXT NOT NULL,
  erro        TEXT NOT NULL DEFAULT '',
  criado_em   TEXT NOT NULL
);
CREATE INDEX ix_emails_fila_proxima ON emails_fila (proxima_em);
