-- Admissão: prazo e edição da proposta, rascunho do cadastro, correção por item e trilha pós-aprovação.

ALTER TABLE admissoes ADD COLUMN prazo_resposta TEXT;                       -- AAAA-MM-DD: depois disso a proposta vence
ALTER TABLE admissoes ADD COLUMN rascunho TEXT NOT NULL DEFAULT '{}';       -- cadastro em preenchimento (salvo sozinho)
ALTER TABLE admissoes ADD COLUMN correcoes TEXT NOT NULL DEFAULT '{}';      -- último pedido de correção: { em, por, texto, itens: [...] }
ALTER TABLE admissoes ADD COLUMN checklist TEXT NOT NULL DEFAULT '{}';      -- passos manuais: { ponto: { em, por }, acessos_pedido: {...}, ... }
ALTER TABLE admissoes ADD COLUMN onboarding_aviso_em TEXT;                  -- aviso da véspera do 1º dia (gestor, RH e novo colaborador)

ALTER TABLE funcionarios ADD COLUMN acessos_ok INTEGER NOT NULL DEFAULT 0;  -- e-mail Innomaker e sistemas criados

-- Quem cria os acessos (e-mail, sistemas) do novo colaborador — Painel → Configurações → Admissão
INSERT OR IGNORE INTO config (chave, valor) VALUES ('email_acessos', '');

-- Propostas antigas ainda sem resposta: 7 dias a partir de hoje para responder
UPDATE admissoes SET prazo_resposta = date('now', '+7 days') WHERE status = 'PROPOSTA_ENVIADA' AND prazo_resposta IS NULL;
