# vagas.innomaker.com.br

Sistema de recrutamento e admissão da Innomaker. Roda **no servidor próprio, do mesmo jeito que o SAC**:
Node.js em Docker, publicado pelo Traefik, login pelo Authelia + LLDAP, dados numa pasta `data/` e e-mails pelo Gmail.
Não usa Google Apps Script, Google Forms nem planilhas.

| Peça | Onde fica |
|---|---|
| Site, área do candidato e painel interno | `servidor/` (Node) rodando o código de `src/` e `public/` |
| Banco de dados (vagas, candidatos, etapas, solicitações, admissões, funcionários, documentos) | `data/vagas.db` (SQLite) |
| Currículos e documentos enviados | `data/arquivos/` (privado; só abre pelo sistema, com permissão) |
| Backups do banco | `data/backups/` (um por dia, mantém os últimos 15) |
| Termos (Compromisso, Direito de Imagem, Apêndice) | Gerados e **assinados eletronicamente** no próprio sistema |
| E-mails | Gmail **rh.innomaker@gmail.com** (SMTP com senha de app, como o SAC) |
| Login dos funcionários | **Authelia** (`auth.innomaker.com.br`) com os grupos do **LLDAP** |
| Rotina (fecha vagas vencidas, avisa contratos perto do fim, backup) | relógio interno, de hora em hora |

| No SAC | Aqui |
|---|---|
| `backend/.env` | `.env` (copie de `.env.example`) |
| `data/planilha.json` | `data/vagas.db` |
| `data/drive/` | `data/arquivos/` |
| `SMTP_*` no `.env` | os mesmos `SMTP_*` no `.env` |
| `AUTH_MODE=authelia` | sempre Authelia (endpoint `/api/authz/auth-request`, o mesmo do SAC) |
| containers `sac` + `sac-backend` | um container só: `vagas` |

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
servidor/              servidor Node: HTTP, banco SQLite, pasta de arquivos, e-mail (nodemailer), rotina e backup
src/
  index.js             rotas (site, /painel, /documento, /arquivo, /api/*)
  cron.js              rotina (vagas vencidas, contratos perto do fim)
  api/candidato.js     inscrição, login, proposta, cadastro e assinatura
  api/staff.js         painel: solicitações, vagas, etapas, admissões, funcionários, configurações
  lib/                 auth (Authelia), papéis, banco, senhas/sessão, e-mail, arquivos, documentos
  templates/           site.html e painel.html
public/assets/         site.css/js e painel.css/js
migrations/            esquema do banco e dados iniciais (aplicados sozinhos ao iniciar)
data/                  o banco de dados e os arquivos (faça backup desta pasta; não vai para o GitHub)
test/                  testes
docs/                  authelia.md e processos.md
```

## Como rodar no computador (Node 22.13+)

```bash
cp .env.example .env     # ajuste SESSION_SECRET e, para e-mail de verdade, SMTP_PASS (só na 1ª vez)
npm install              # só na 1ª vez
npm start                # abra http://localhost:3000 e http://localhost:3000/painel
```

- `npm run dev`: igual ao `npm start`, mas reinicia sozinho quando você salva um arquivo.
- Para entrar no painel sem Authelia no computador, descomente `DEV_USUARIO_FALSO` no `.env` (só vale em `localhost`).
- `Ctrl+C` desliga.

## Colocar no ar no servidor (Docker + Traefik, igual ao SAC)

No servidor, na pasta do projeto:

```bash
cp .env.example .env     # preencha SESSION_SECRET e SMTP_PASS (veja abaixo)
docker compose up -d --build
docker compose logs -f   # deve mostrar "Vagas Innomaker no ar" e "E-mail: SMTP smtp.gmail.com como rh.innomaker@gmail.com"
```

O `docker-compose.yml` sobe o container `vagas` na rede `proxy` do Traefik, em `vagas.innomaker.com.br`
(porta 3000, certificado pelo resolver `cloudflare`, mesmo DNS interno do SAC). Os dados ficam em `./data` no servidor.
Não coloque middleware do Authelia no roteador: o próprio sistema confere o login (veja [docs/authelia.md](docs/authelia.md)).

**Atualizar** depois de um `git pull`: `docker compose up -d --build`. As migrações novas do banco entram sozinhas.

Antes de subir:
- **`SESSION_SECRET`**: gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` e cole no `.env`.
  Guarde: se mudar, os candidatos precisam entrar de novo.
- **Senha de app do Gmail** (`SMTP_PASS`): entre em `rh.innomaker@gmail.com`, ative a *Verificação em duas etapas*
  (myaccount.google.com/security) e gere a senha em myaccount.google.com/apppasswords (nome: "vagas").
  São 16 letras. Limite do Gmail: cerca de 500 e-mails por dia.
- **DNS**: `vagas.innomaker.com.br` precisa apontar para o servidor do Traefik, como o `sac.innomaker.com.br`.
- **Authelia e LLDAP:** siga [docs/authelia.md](docs/authelia.md).

Depois:
- **Primeiro acesso do RH** em `/painel → Configurações`: e-mail do RH e **Enviar e-mail de teste**, departamentos e
  gestores, listas, **modelos de documento** (cole o texto oficial do ADM-TEMP-2026-001, 007 e 005) e links.

## Manutenção

- Testes: `npm test`.
- Backup manual: `npm run backup` (ou `docker compose exec vagas node servidor/cli.js backup`), ou copie a pasta `data/` inteira.
  O sistema já faz um backup do banco por dia em `data/backups/`. **Os arquivos enviados (`data/arquivos/`) não entram nesse backup:
  copie a pasta `data/` inteira para outro lugar de vez em quando.**
- Saúde: `GET /saude` responde `{"ok":true}` (o Docker usa no healthcheck).

### Trazer dados que já estavam no Cloudflare (opcional)

Se o sistema já foi usado no Cloudflare D1, exporte o banco e coloque o arquivo em `data/` **antes** do primeiro início:

```bash
npx wrangler d1 export vagas-db --remote --output data/importar-d1.sql
```

Na primeira vez que o servidor sobe (sem `data/vagas.db`), ele importa esse arquivo e o renomeia para `.importado`.
Currículos e documentos do R2 precisam ser copiados para `data/arquivos/<mesmo caminho>` (por exemplo, com `npx wrangler r2 object get`).

## Mudanças comuns

| Quero… | Onde |
|---|---|
| Mudar grupos do LLDAP que viram cada papel | `GRUPOS_*` no `.env` |
| Mudar o que cada papel pode fazer | `src/lib/papeis.js` |
| Mudar departamentos, listas, modelos e links | Painel → Configurações (sem código) |
| Criar uma coluna nova no banco | novo arquivo em `migrations/` (ex.: `0003_...sql`); entra sozinho ao reiniciar |
| Trocar a conta que envia os e-mails | `SMTP_USER`, `SMTP_FROM` e `SMTP_PASS` no `.env` |

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `/painel` volta sempre para o login | Cookie do Authelia não vale para `vagas.innomaker.com.br`, ou falta a regra do Authelia |
| Logado, mas 403 | Usuário sem grupo de RH, gerente ou funcionário no LLDAP (veja `GRUPOS_*`) |
| "Não foi possível falar com o servidor de login" | O container não alcança `auth.innomaker.com.br` (confira o `dns:` do `docker-compose.yml`) |
| E-mails não chegam | `SMTP_PASS` vazio ou revogado (trocar a senha da conta Google revoga), ou limite diário do Gmail (veja Painel → Histórico) |
| "SESSION_SECRET não configurado" | Falta `SESSION_SECRET` no `.env` |
| Documento não gera: "campo vazio… Operação cancelada" | Preencha o campo indicado em Funcionários → dados do registro |

## Alternativa: Cloudflare

O mesmo código ainda roda como Cloudflare Worker (D1 + R2), pelo `wrangler.toml`:
`npm run cf:configurar` (primeira vez), `npm run cf:deploy`, `npm run cf:dev`.
Não use os dois ao mesmo tempo: os dados não se sincronizam.

## Dados pessoais (LGPD)

Currículos, documentos e dados de admissão ficam no servidor da Innomaker, na pasta `data/`, sem acesso público.
Arquivos só abrem pelo sistema: o próprio candidato, o RH, ou o gerente da vaga (apenas currículos).
As senhas dos candidatos são guardadas com hash (PBKDF2) e as assinaturas registram nome, CPF, data, IP e o código (hash) do documento.
