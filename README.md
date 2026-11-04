# vagas.innomaker.com.br

Sistema de recrutamento e admissão da Innomaker, **100% dentro de um Cloudflare Worker**.
Não usa Google Apps Script, Google Forms nem planilhas.

| Peça | Onde fica |
|---|---|
| Site, área do candidato e painel interno | Cloudflare Worker (`src/`, `public/`) |
| Banco de dados (vagas, candidatos, etapas, solicitações, admissões, funcionários, documentos) | Cloudflare **D1** (`migrations/`) |
| Currículos e documentos enviados | Cloudflare **R2** (privado; só abre pelo sistema, com permissão) |
| Termos (Compromisso, Direito de Imagem, Apêndice) | Gerados e **assinados eletronicamente** no próprio sistema |
| E-mails | API do **Resend** |
| Login dos funcionários | **Authelia** (`auth.innomaker.com.br`) |
| Rotina diária (fecha vagas vencidas, avisa contratos perto do fim) | Cron Trigger do Worker |

## Quem faz o quê

| Perfil | Onde | O que faz |
|---|---|---|
| Candidato | `/` | Vê vagas, se inscreve (currículo em PDF), recebe senha por e-mail, acompanha todas as candidaturas, aceita a proposta, preenche o cadastro de admissão, envia documentos e assina os termos |
| Funcionário | `/painel` | Vagas abertas para indicar e links úteis |
| Gerente | `/painel` | Solicita vagas, corrige pedidos de reajuste e vê os candidatos das vagas da sua área |
| RH | `/painel` | Solicitações, vagas e etapas, propostas, conferência e aprovação de admissões, funcionários, documentos, configurações e histórico |
| Sem grupo | `/painel` | Página **403** |

O fluxo segue os procedimentos RHC-PROC-2026-001, 002 e 003. Veja [docs/processos.md](docs/processos.md).

## Estrutura

```
src/
  index.js             rotas (site, /painel, /documento, /arquivo, /api/*) e cron
  cron.js              rotina diária
  api/candidato.js     inscrição, login, proposta, cadastro e assinatura
  api/staff.js         painel: solicitações, vagas, etapas, admissões, funcionários, configurações
  lib/                 auth (Authelia), papéis, banco, senhas/sessão, e-mail, arquivos, documentos
  templates/           site.html e painel.html
public/assets/         site.css/js e painel.css/js
migrations/            esquema do banco e dados iniciais
test/                  testes de regras (papéis, login, documentos, etapas, senha, CPF)
docs/                  authelia.md e processos.md
```

## Colocar no ar (primeira vez)

Pré-requisito: Node 20+ e `npx wrangler login` com a conta Cloudflare da Innomaker.

1. **Banco e arquivos**
   ```bash
   npm ci
   npx wrangler d1 create vagas-db          # copie o database_id para o wrangler.toml
   npx wrangler r2 bucket create vagas-arquivos
   npm run db:remoto                        # cria as tabelas no D1
   ```
2. **Segredos do Worker** (*Workers & Pages → vagas → Configurações → Variáveis e segredos*, ou pelo terminal)
   ```bash
   npx wrangler secret put SESSION_SECRET   # cole uma chave longa e aleatória (ex.: openssl rand -hex 32)
   npx wrangler secret put RESEND_API_KEY   # chave do Resend
   ```
3. **E-mail (Resend):** crie a conta em resend.com, adicione o domínio `innomaker.com.br` (os registros DNS entram no Cloudflare) e gere a chave da API.
   Sem a chave, o sistema funciona, mas os e-mails ficam só registrados em *Painel → Histórico*.
4. **Authelia:** siga [docs/authelia.md](docs/authelia.md) (cookie em `innomaker.com.br`, regra para `/painel`, grupos `rh`, `gerente`, `funcionario`).
5. **Deploy automático:** em *Workers & Pages → vagas → Configurações → Builds*, conecte este repositório (branch `main`).
   - Comando de build: `npm ci`
   - Comando de deploy: `npm run deploy` (aplica migrações novas e publica)
6. **Primeiro acesso do RH** em `/painel → Configurações`:
   - Departamentos e gestores (substitui a aba EMAIL).
   - Listas: cargos, funções, setores, situações, auxílios, horários e etapas (substitui a aba Informações).
   - **Modelos de documento:** cole o texto oficial do ADM-TEMP-2026-001, 007 e 005 nos modelos (os atuais são provisórios).
   - E-mail do RH, link da cartilha, link do onboarding e links do colaborador.

> **Plano do Workers:** recomendamos o *Workers Paid* (US$ 5/mês). A proteção das senhas dos candidatos (PBKDF2) usa mais que os 10 ms de CPU do plano gratuito.
> D1 e R2 cabem com folga nas cotas gratuitas.

## Desenvolvimento local

```bash
cp .dev.vars.example .dev.vars
npm run db:local        # banco local
npm run dev             # http://localhost:8787 e http://localhost:8787/painel
npm test
npm run check           # valida o bundle
```

Em `localhost`, `DEV_USUARIO_FALSO` simula o Authelia, e o cabeçalho `x-dev-grupos` troca o papel em testes automatizados.
Os e-mails aparecem com o texto completo na tabela `emails` do banco local.

## Mudanças comuns

| Quero… | Onde |
|---|---|
| Mudar grupos do Authelia que viram cada papel | `GRUPOS_*` no `wrangler.toml` |
| Mudar o que cada papel pode fazer | `src/lib/papeis.js` |
| Mudar departamentos, listas, modelos e links | Painel → Configurações (sem código) |
| Criar uma coluna nova no banco | novo arquivo em `migrations/` (ex.: `0003_...sql`); o deploy aplica |
| Forçar navegadores a baixar CSS/JS novos | aumente `VERSAO_ASSETS` |

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `/painel` volta sempre para o login | Cookie do Authelia não vale para `vagas.innomaker.com.br` |
| Logado, mas 403 | Usuário sem grupo `rh`, `gerente` ou `funcionario` |
| E-mails não chegam | `RESEND_API_KEY` ausente ou domínio não verificado no Resend (veja Painel → Histórico) |
| "SESSION_SECRET não configurado" | Falta o segredo no Worker |
| Erro 1102 / CPU no login do candidato | Worker no plano gratuito (veja acima) |
| Documento não gera: "campo vazio… Operação cancelada" | Preencha o campo indicado em Funcionários → dados do registro |

## Dados pessoais (LGPD)

Currículos, documentos e dados de admissão ficam no D1 e no R2 da conta Innomaker, sem acesso público.
Arquivos só abrem pelo sistema: o próprio candidato, o RH, ou o gerente da vaga (apenas currículos).
As senhas dos candidatos são guardadas com hash (PBKDF2) e as assinaturas registram nome, CPF, data, IP e o código (hash) do documento.
