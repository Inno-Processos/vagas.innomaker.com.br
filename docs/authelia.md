# Authelia e LLDAP — configuração para vagas.innomaker.com.br

Igual ao SAC: o Traefik deixa o tráfego passar direto, e o próprio sistema pergunta ao Authelia quem está logado
(endpoint `/api/authz/auth-request`), repassando o cookie `authelia_session` do navegador.
O site público e a área do candidato abrem sem login; só o `/painel` exige a conta Innomaker.

```
navegador ──(cookie authelia_session)──> Traefik ──> vagas ──> auth.innomaker.com.br/api/authz/auth-request
                                                                 200: usuário, nome, e-mail, grupos do LLDAP
                                                                 401: sem login → tela de login do Authelia
                                                                 403: regra nega → página 403
```

## 1. Cookie de sessão válido para os subdomínios

O mesmo do SAC: o cookie precisa valer para `innomaker.com.br`, assim o navegador o envia para `vagas.innomaker.com.br`:

```yaml
session:
  cookies:
    - domain: 'innomaker.com.br'
      authelia_url: 'https://auth.innomaker.com.br'
```

## 2. Regras de acesso

No `access_control` do `configuration.yml`, **antes** de qualquer regra mais geral (como `*.innomaker.com.br`),
porque o Authelia usa a primeira regra que combina:

```yaml
access_control:
  rules:
    # O sistema pergunta ao Authelia sobre /painel para saber quem está logado
    - domain: 'vagas.innomaker.com.br'
      resources: ['^/painel([/?#].*)?$']
      policy: 'one_factor'        # ou 'two_factor'
    # O resto (site público, área do candidato, arquivos) passa direto: o próprio sistema confere as permissões
    - domain: 'vagas.innomaker.com.br'
      policy: 'bypass'
```

O `bypass` é necessário quando o forward auth do Authelia está ligado para todo o entrypoint do Traefik;
sem ele, os candidatos cairiam na tela de login da Innomaker. Não é preciso cadastrar cliente OIDC nem gerar segredo.

## 3. Grupos no LLDAP

| Grupo no LLDAP | Papel no sistema de vagas |
|---|---|
| `RH` (ou `vagas_rh`) | RH: aprova solicitações e gerencia tudo |
| `Gerente` (ou `gestores`, `vagas_gerente`) | Gerente: solicita vagas |
| `funcionarios` (ou `colaboradores`, `vagas_funcionario`) | Funcionário: vê vagas abertas |

Quem está em mais de um fica com o papel mais alto (RH > Gerente > Funcionário). Quem não está em nenhum vê a página **403**.
Os nomes aceitos ficam em `GRUPOS_RH`, `GRUPOS_GERENTE` e `GRUPOS_FUNCIONARIO` no `backend/.env` (separados por vírgula). Maiúsculas não importam: o grupo `RH` do LLDAP vale como `rh`.

**O e-mail do usuário no LLDAP é obrigatório para gerentes**: é por ele que o gestor recebe a decisão do RH e
vê "Minhas solicitações".

## 4. `backend/.env`

```
AUTHELIA_URL=https://auth.innomaker.com.br
AUTHELIA_AUTHZ_PATH=/api/authz/auth-request
AUTHELIA_COOKIE=authelia_session
```

Se o cookie do Authelia tiver outro nome (`session.cookies[].name`), ajuste `AUTHELIA_COOKIE`.
O container precisa alcançar `auth.innomaker.com.br`: o `docker-compose.yml` usa o mesmo DNS interno do SAC (`192.168.0.201`).

## 5. Fluxo

1. Usuário clica em **Entrar** → `/painel`.
2. Sem sessão → `https://auth.innomaker.com.br/?rd=https://vagas.innomaker.com.br/painel`.
3. Depois do login, o Authelia volta para `/painel`.
4. **Sair** → `https://auth.innomaker.com.br/logout?rd=https://vagas.innomaker.com.br/` (sai também do SAC).

O sistema guarda a resposta do Authelia por 60 segundos por sessão; mudanças de grupo no LLDAP valem em até 1 minuto.
