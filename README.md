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

Tudo é feito pelo assistente, que roda no seu computador e configura a conta Cloudflare:

```bash
npm ci
npm run configurar
```

Ele faz login no Cloudflare, cria o banco D1 e o R2, cria as tabelas, grava os segredos (`SESSION_SECRET` gerado
automaticamente e `RESEND_API_KEY`, que você cola) e publica o sistema. Pode rodar de novo sem perder nada.
Depois, salve no GitHub o `wrangler.toml` (ele passa a ter o ID do banco):

```bash
git add wrangler.toml && git commit -m "Configura banco D1" && git push
```

Antes de rodar:
- **R2 ativado** na conta (painel do Cloudflare → R2 → Começar a usar; grátis até 10 GB, mas pede cartão).
- **Chave do Resend** para os e-mails: crie a conta em resend.com, adicione o domínio `innomaker.com.br`
  (os registros DNS entram no Cloudflare) e gere a chave em *API Keys*.

Depois:
- **Authelia:** siga [docs/authelia.md](docs/authelia.md).
- **Deploy automático (opcional):** *Workers & Pages → vagas → Configurações → Builds* → conecte este repositório.
  Comando de build `npm ci`, comando de deploy `npx wrangler deploy`. Migrações novas: `npm run db:remoto`.
- **Primeiro acesso do RH** em `/painel → Configurações`: e-mail do RH e **Enviar e-mail de teste**, departamentos e
  gestores, listas, **modelos de documento** (cole o texto oficial do ADM-TEMP-2026-001, 007 e 005) e links.

> **Plano do Workers:** recomendamos o *Workers Paid* (US$ 5/mês). A proteção das senhas dos candidatos (PBKDF2) usa mais que os 10 ms de CPU do plano gratuito.

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
