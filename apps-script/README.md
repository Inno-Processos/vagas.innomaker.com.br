# Apps Script — o que colar em cada projeto

Em **todos**: *Configurações do projeto → Propriedades do script → Adicionar* `STAFF_API_KEY` com a mesma
chave do Worker. Depois: **Implantar → Gerenciar implantações → editar → Nova versão → Implantar**
(acesso "Qualquer pessoa", executar como "Eu").

## vagas-mae/ — planilha Mãe (1chGwwKO…)
- Substitua o `Code.gs` (agora encaminha as ações `staff_*` para o Staff.gs).
- Crie o arquivo **Staff.gs**.
- Mantenha o `ManualMae.html`.

## solicitacoes/ — planilha de solicitações (1RNcqDM8…)
- `Codigo.gs`, `Decisao.html` e `ManualSolicitacoes.html` são os mesmos já em uso.
- Crie o arquivo **Api.gs** (painel: solicitar, listar, decidir).
- Copie a URL `/exec` deste projeto para `APPS_SOLIC_URL` no `wrangler.toml`.
- Confirme que `WEBAPP_URL` e `FORM_ID_VAGAS` estão preenchidos no `Codigo.gs`.

## admissao/ — Sistema de Admissão
- Não altere o `Code.gs`, `Candidato.html` e `Gestor.html` atuais.
- Crie o arquivo **Api.gs** (painel: listar, aprovar, recusar, reenviar).

> Recomendação de segurança: com o painel em uso, o modo `?mode=admin` do Site de Admissão e os links
> `?mode=rh&action=approve` dos e-mails aprovam só com o requestId, sem login. Vale passar essas
> aprovações a ser feitas apenas pelo painel.
