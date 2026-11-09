-- Data da etapa enviada ao candidato e termos enviados quando ele aceita a proposta.

-- Etapa: horário e local marcados pelo RH e quando o candidato foi avisado
ALTER TABLE etapas ADD COLUMN hora_prevista TEXT NOT NULL DEFAULT '';
ALTER TABLE etapas ADD COLUMN local_prevista TEXT NOT NULL DEFAULT '';
ALTER TABLE etapas ADD COLUMN data_enviada_em TEXT;

-- Modelos de documento: quando vão para o candidato e para quais tipos de contratação
--   momento = 'aceite'    → o candidato recebe para ler assim que aceita a proposta (e assina depois da aprovação)
--   momento = 'aprovacao' → só na aprovação do cadastro (como antes)
--   aplica_a = ["Estágio", …] (vazio = todos os tipos)
ALTER TABLE modelos_documento ADD COLUMN momento TEXT NOT NULL DEFAULT 'aprovacao';
ALTER TABLE modelos_documento ADD COLUMN aplica_a TEXT NOT NULL DEFAULT '[]';

ALTER TABLE admissoes ADD COLUMN termos_enviados_em TEXT;

-- Termos do processo de admissão (RHC-PROC-2026-003): no aceite o candidato recebe para ler
-- o Termo de Compromisso de Estágio (só estágio) e o Termo de Direito de Imagem (todos); o Apêndice da bolsa
-- (usa os dados bancários do cadastro) vai para assinatura na aprovação, junto com os outros dois.
UPDATE modelos_documento SET momento = 'aceite', aplica_a = '["Estágio"]' WHERE codigo = 'ADM-TEMP-2026-001';
UPDATE modelos_documento SET momento = 'aceite', aplica_a = '[]' WHERE codigo = 'ADM-TEMP-2026-007';
UPDATE modelos_documento SET aplica_a = '["Estágio"]', gerar_na_admissao = 1 WHERE codigo = 'ADM-TEMP-2026-005';
