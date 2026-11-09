# Vagas.Innomaker — vagas.innomaker.com.br

Sistema de recrutamento e admissão da Innomaker, em Node.js, com **backend e frontend separados** (como o SAC).
Os dois só conversam pela API HTTP (JSON). Roda no servidor próprio com Docker, publicado pelo Traefik,
login pelo Authelia + LLDAP e e-mails pelo Gmail.

```
vagas.innomaker.com.br/
├── backend/                  API HTTP + regras de negócio (porta 3001, só na rede interna)
│   ├── .env                  configuração (copie de .env.example)
│   ├── migrations/           esquema do banco e dados iniciais (aplicados sozinhos ao iniciar)
│   └── src/
│       ├── index.js          sobe a API, a rotina de hora em hora e o backup diário
│       ├── rotas.js          rotas: /api/*, /arquivo/<id>, /entrar, /sair
│       ├── cli.js            manutenção (backup, migrar)
│       ├── cron.js           rotina: vagas vencidas, contratos perto do fim
│       ├── api/              candidato.js (inscrição, área do candidato) e staff.js (painel)
│       ├── lib/              auth (Authelia), papéis, banco, senhas/sessão, e-mail, arquivos, documentos
│       └── infra/            banco SQLite, pasta de arquivos e envio SMTP (nodemailer)
├── frontend/                 telas (porta 3000; é o que o Traefik publica)
│   ├── server.js             entrega public/ e repassa /api, /arquivo, /entrar e /sair ao backend
│   └── public/
│       ├── index.html        site público e área do candidato
│       ├── painel.html       painel interno (funcionário, gerente, RH)
│       ├── documento.html    leitura, impressão e assinatura de documentos
│       ├── agendar.html      candidato escolhe o horário da entrevista (/agendar/<token>)
│       ├── privacidade.html  Política de privacidade (LGPD)
│       ├── erro.html         página de erro
│       └── assets/           inicio.js (partida: busca os dados na API), site/painel/documento .js e .css,
│                             manual.js (manual de cada aba), tema.js (claro/escuro), logos
├── data/                     o banco de dados e os arquivos enviados (faça backup desta pasta)
├── scripts/iniciar.js        sobe backend + frontend num só terminal
├── test/
└── docs/                     authelia.md e processos.md
```

| No SAC | Aqui |
|---|---|
| `backend/.env` | `backend/.env` |
| `data/planilha.json` | `data/vagas.db` (SQLite) |
| `data/drive/` | `data/arquivos/` |
| containers `sac` + `sac-backend` | containers `vagas` (frontend) + `vagas-backend` |
| `SMTP_*` no `.env` | os mesmos `SMTP_*` no `backend/.env` |
| `AUTH_MODE=authelia` | sempre Authelia (endpoint `/api/authz/auth-request`, o mesmo do SAC) |

## Quem faz o quê

| Perfil | Onde | O que faz |
|---|---|---|
| Candidato | `/` | Vê vagas, se inscreve (currículo em PDF), recebe senha por e-mail, acompanha as candidaturas, aceita a proposta, preenche o cadastro de admissão, envia documentos e assina os termos |
| Funcionário (grupo `funcionarios`) | `/painel` | Vagas abertas para indicar e links úteis |
| Gerente (grupo `Gerente`) | `/painel` | Solicita vagas, corrige pedidos de reajuste e vê os candidatos das vagas da sua área |
| RH (grupo `RH`) | `/painel` | Aprova solicitações, vagas e etapas, propostas, admissões, funcionários, documentos, configurações e histórico |
| Sem grupo | `/painel` | Página de acesso negado |

O manual de cada tela abre pelo **ícone de livro** no topo do painel (textos em `frontend/public/assets/manual.js`). O fluxo segue os procedimentos RHC-PROC-2026-001, 002 e 003 ([docs/processos.md](docs/processos.md)).

## API

As telas chamam o backend sempre pelo frontend (mesma origem, sem CORS):

```
GET  /api/site/inicio         vagas, candidato logado e se há sessão de funcionário (site público)
GET  /api/vagas               vagas abertas
POST /api/candidato/<acao>    inscrever, login, sair, esqueci, senha, area, proposta, rascunho, anexar, desanexar, cadastro, assinar, privacidade, excluir
GET  /api/painel/sessao       200 usuário e permissões · 401 sem login (com loginUrl) · 403 sem grupo
POST /api/staff/<acao>        ações do painel (lista em backend/src/lib/papeis.js)
GET  /api/documento/<id>      documento para ler/assinar (candidato dono ou RH)
GET  /api/agendar/<token>     horários livres para o candidato (link do e-mail, sem login)
POST /api/agendar/<token>/reservar | liberar
GET  /api/privacidade         prazos de guarda e contato (página Política de privacidade)
GET  /arquivo/<id>            currículos e documentos enviados (com permissão)
GET  /entrar, /sair           login e logout no Authelia
GET  /saude                   {"ok":true} (backend e frontend, cada um o seu)
```

Respostas: `{ "ok": true, ... }` ou `{ "ok": false, "erro": "mensagem" }`. Se o backend estiver fora do ar,
o frontend responde **503** com `"reiniciando": true` e as telas tentam de novo sozinhas.

## Como rodar no computador (Node 22.13+)

Na pasta do projeto:

```bash
cp backend/.env.example backend/.env   # ajuste SESSION_SECRET e, para e-mail de verdade, SMTP_PASS (só na 1ª vez)
npm install                            # instala backend e frontend (só na 1ª vez)
npm start                              # sobe tudo: abra http://localhost:3000 e http://localhost:3000/painel
```

- `npm run dev`: igual ao `npm start`, mas reinicia sozinho quando você salva um arquivo.
- `npm run start:backend` / `npm run start:frontend`: sobe cada parte num terminal separado.
- Para entrar no painel sem Authelia no computador, descomente `DEV_USUARIO_FALSO` no `backend/.env` (só vale em `localhost`).
- `Ctrl+C` desliga.

## Colocar no ar no servidor (Docker + Traefik, igual ao SAC)

```bash
cp backend/.env.example backend/.env   # preencha SESSION_SECRET e SMTP_PASS
docker compose up -d --build
docker compose logs -f                 # deve mostrar "Backend (API) no ar" e "Frontend no ar"
```

O `docker-compose.yml` sobe o `backend` (container `vagas-backend`, só na rede interna, com os dados em `./data`)
e o `frontend` (container `vagas`, na rede `proxy` do Traefik, em `vagas.innomaker.com.br`, porta 3000).
Não coloque middleware do Authelia no roteador: o próprio sistema confere o login (veja [docs/authelia.md](docs/authelia.md)).

**Atualizar** depois de um `git pull`: `docker compose up -d --build`. As migrações novas do banco entram sozinhas.

Antes de subir:
- **`SESSION_SECRET`**: gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  Guarde: se mudar, os candidatos precisam entrar de novo.
- **Senha de app do Gmail** (`SMTP_PASS`): na conta que envia, ative a *Verificação em duas etapas*
  (myaccount.google.com/security) e gere a senha em myaccount.google.com/apppasswords. São 16 letras.
  Limite do Gmail: cerca de 500 e-mails por dia.
- **Authelia e LLDAP:** siga [docs/authelia.md](docs/authelia.md). Coloque as pessoas do RH no grupo `RH`.

## Rotina automática (de hora em hora)

- Fecha vagas com prazo vencido e avisa o RH sobre contratos perto do fim.
- **Lembretes ao candidato** (só das 8h às 20h): entrevista no dia seguinte (candidato e entrevistadores);
  proposta sem resposta, cadastro de admissão incompleto (diz o que falta), correção pedida pelo RH e documentos sem assinatura
  (até 3 lembretes, a cada 2 dias).
- **Prazo de guarda (LGPD)**, uma vez por dia: apaga candidatos sem atividade há mais tempo que o prazo de Painel → Configurações.
- **Backup** do banco (um por dia em `data/backups/`, mantém 15) e **cópia externa** (abaixo).

## Backup fora do servidor

Sem isso, se o disco do servidor falhar, perde-se tudo. Monte uma pasta de **outro disco, NAS ou pasta sincronizada
com a nuvem** no container e informe o caminho:

```yaml
# docker-compose.yml → backend → volumes
      - /mnt/nas/vagas-backup:/backup-externo
```
```bash
# backend/.env
BACKUP_EXTERNO_DIR=/backup-externo
```

Todo dia o backend copia o banco para `<destino>/banco/` (mantém 30) e espelha `data/arquivos/` em `<destino>/arquivos/`
(o que é apagado aqui, por pedido LGPD ou prazo, também sai de lá). A situação aparece em **Painel → Configurações → Backup**
e o RH recebe um e-mail se a cópia falhar. Para testar na hora: `npm run backup`.

Para **restaurar**: pare o sistema, copie `<destino>/banco/vagas-AAAA-MM-DD.db` para `data/vagas.db` e `<destino>/arquivos/` para `data/arquivos/`, e suba de novo.

## Manutenção

- Testes: `npm test`.
- Backup manual: `npm run backup` (ou `docker compose exec backend node src/cli.js backup`).
- Mudar um texto do manual de uma tela: `frontend/public/assets/manual.js`.

## Mudanças comuns

| Quero… | Onde |
|---|---|
| Mudar grupos do LLDAP que viram cada papel | `GRUPOS_*` no `backend/.env` |
| Mudar o que cada papel pode fazer | `backend/src/lib/papeis.js` |
| Mudar departamentos, listas, modelos e links | Painel → Configurações (sem código) |
| Criar uma coluna nova no banco | novo arquivo em `backend/migrations/` (ex.: `0004_...sql`); entra sozinho ao reiniciar |
| Mudar visual, textos das telas ou o manual | `frontend/public/` |
| Trocar a conta que envia os e-mails | `SMTP_USER`, `SMTP_FROM` e `SMTP_PASS` no `backend/.env` |

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `/painel` volta sempre para o login | Cookie do Authelia não vale para `vagas.innomaker.com.br`, ou falta a regra do Authelia |
| Logado, mas "Acesso negado" | Usuário sem grupo `RH`, `Gerente` ou `funcionarios` no LLDAP |
| RH não vê os botões de aprovar | A pessoa não está no grupo `RH` do LLDAP |
| "Não foi possível falar com o servidor de login" | O backend não alcança `auth.innomaker.com.br` (confira o `dns:` do `docker-compose.yml`) |
| "O sistema está reiniciando" por muito tempo | Backend parado: `docker compose ps` e `docker compose logs backend` |
| E-mails não chegam | `SMTP_PASS` vazio ou revogado, ou limite diário do Gmail (veja Painel → Histórico) |
| Documento não gera: "campo vazio… Operação cancelada" | Preencha o campo indicado em Funcionários → dados do registro |

## Dados pessoais (LGPD)

Currículos, documentos e dados de admissão ficam no servidor da Innomaker, na pasta `data/`, acessível só pelo backend.
Arquivos só abrem pelo sistema: o próprio candidato, o RH, ou o gerente da vaga (apenas currículos).
As senhas dos candidatos são guardadas com hash (PBKDF2) e as assinaturas registram nome, CPF, data, IP e o código (hash) do documento.

- **Consentimento:** a inscrição exige o aceite da [Política de privacidade](/privacidade) (`frontend/public/privacidade.html`);
  o banco de talentos é um aceite separado e opcional, que o candidato liga ou desliga na Área do candidato.
- **Exclusão:** o candidato tem o botão *Excluir meus dados* (pede a senha); o RH pode excluir pela ficha do candidato ou pelo Banco de talentos.
  Apaga conta, currículos, candidaturas, avaliações e horários, e tira o e-mail do Histórico. Admissões e funcionários não são excluídos por aqui (guarda legal).
- **Prazo de guarda:** Painel → Configurações → Privacidade (padrão: 12 meses; banco de talentos: 24 meses). Código em `backend/src/lib/lgpd.js`.
- Revise o texto da Política de privacidade com o jurídico antes de publicar.
