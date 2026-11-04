-- Envio do funcionário para a planilha "Registros" (Google Sheets) na aprovação da admissão
ALTER TABLE funcionarios ADD COLUMN planilha_status TEXT NOT NULL DEFAULT '';   -- '', ENVIADO, FALHOU, ENVIANDO
ALTER TABLE funcionarios ADD COLUMN planilha_erro   TEXT NOT NULL DEFAULT '';
ALTER TABLE funcionarios ADD COLUMN planilha_em     TEXT;
ALTER TABLE funcionarios ADD COLUMN planilha_linha  INTEGER;
