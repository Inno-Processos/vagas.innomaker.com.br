ALTER TABLE vagas ADD COLUMN preparacao TEXT NOT NULL DEFAULT '{}';
ALTER TABLE arquivos ADD COLUMN vaga_id TEXT REFERENCES vagas(id);
ALTER TABLE arquivos ADD COLUMN preparacao_grupo TEXT;
CREATE INDEX ix_arquivos_preparacao ON arquivos(vaga_id, preparacao_grupo);
