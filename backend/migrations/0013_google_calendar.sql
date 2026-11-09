-- Fila persistente: mantém a última versão até o Google confirmar a sincronização.
ALTER TABLE etapas ADD COLUMN participantes_previstos TEXT NOT NULL DEFAULT '[]';
CREATE TABLE google_calendar_eventos (
  chave TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  evento TEXT NOT NULL,
  cancelar INTEGER NOT NULL DEFAULT 0,
  versao INTEGER NOT NULL DEFAULT 1,
  pendente INTEGER NOT NULL DEFAULT 1,
  erro TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL
);
