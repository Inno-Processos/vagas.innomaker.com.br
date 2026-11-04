-- Avaliação de 1 a 3 estrelas em cada etapa do processo seletivo (0 = sem nota)
ALTER TABLE etapas ADD COLUMN nota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE etapas ADD COLUMN avaliado_em TEXT;
