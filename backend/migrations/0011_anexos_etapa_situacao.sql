-- Documentos anexados pelo RH em cada etapa do candidato (teste técnico, anotações da entrevista…)
ALTER TABLE arquivos ADD COLUMN etapa_id INTEGER;
CREATE INDEX ix_arq_etapa ON arquivos (etapa_id);

-- "Situação" do funcionário/proposta: só Ativo ou Não ativo
DELETE FROM listas WHERE tipo = 'situacao';
INSERT INTO listas (tipo, valor, ordem) VALUES ('situacao', 'Ativo', 1), ('situacao', 'Não ativo', 2);
UPDATE funcionarios SET situacao = CASE WHEN ativo = 1 THEN 'Ativo' ELSE 'Não ativo' END;
