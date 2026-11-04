# Authelia — configuração para vagas.innomaker.com.br

O Worker não fica atrás de um proxy reverso, então ele mesmo pergunta ao Authelia se a sessão é válida
(endpoint *forward-auth*), repassando o cookie `authelia_session` do navegador.

## 1. Cookie de sessão válido para os subdomínios

O cookie precisa valer para `innomaker.com.br` (assim o navegador o envia para `vagas.innomaker.com.br`):

```yaml
session:
  cookies:
    - domain: 'innomaker.com.br'
      authelia_url: 'https://auth.innomaker.com.br'
      default_redirection_url: 'https://vagas.innomaker.com.br/painel'
```

## 2. Regra de acesso

```yaml
access_control:
  default_policy: 'deny'
  rules:
    # ... suas regras atuais ...
    - domain: 'vagas.innomaker.com.br'
      resources:
        - '^/painel([/?].*)?$'
      policy: 'one_factor'        # ou 'two_factor'
      subject:
        - 'group:rh'
        - 'group:gerente'
        - 'group:funcionario'
```

Quem está logado mas não pertence a nenhum desses grupos recebe a página **403** do site.

## 3. Grupos dos usuários

Com o backend de arquivo (`users_database.yml`):

```yaml
users:
  rebeca:
    displayname: 'Rebeca'
    email: 'rebeca@innomaker.com.br'
    password: '$argon2id$...'
    groups: ['rh']
  joao:
    displayname: 'João Gestor'
    email: 'joao@innomaker.com.br'
    password: '$argon2id$...'
    groups: ['gerente']
  ana:
    displayname: 'Ana'
    email: 'ana@innomaker.com.br'
    password: '$argon2id$...'
    groups: ['funcionario']
```

Com LDAP, use os grupos do diretório. Os nomes aceitos ficam em `GRUPOS_*` no `wrangler.toml`
(ex.: `GRUPOS_GERENTE = "gerente,gestores"`).

**O e-mail do usuário é obrigatório para gerentes**: é por ele que o gestor recebe a decisão do RH e
vê "Minhas solicitações".

## 4. Endpoint usado pelo Worker

| Versão do Authelia | `AUTHELIA_AUTHZ_PATH` |
|---|---|
| 4.38 ou mais nova | `/api/authz/forward-auth` (padrão) |
| 4.37 ou mais antiga | `/api/verify` |

Respostas: **200** com `Remote-User`, `Remote-Groups`, `Remote-Name`, `Remote-Email` → logado;
**401/302** → sem login (o Worker manda para `https://auth.innomaker.com.br/?rd=...`);
**403** → bloqueado pelas regras (página 403).

## 5. Fluxo

1. Usuário clica em **Entrar** → `/painel`.
2. Sem sessão → `https://auth.innomaker.com.br/?rd=https://vagas.innomaker.com.br/painel`.
3. Depois do login, o Authelia volta para `/painel` (sem o `rd`, ele mostraria `/authenticated`).
4. **Sair** → `https://auth.innomaker.com.br/logout?rd=https://vagas.innomaker.com.br/`.

O Worker guarda a resposta do Authelia por 60 segundos por sessão; mudanças de grupo valem em até 1 minuto.
