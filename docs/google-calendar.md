# Google Calendar

Reservas de entrevista/teste, datas fixas marcadas pelo RH e onboarding geram eventos no calendário compartilhado. Horários livres são disponibilidade e só geram evento quando reservados. Os eventos incluem o ID de agendamento, o e-mail do candidato e os participantes, no fuso America/Sao_Paulo. Datas fixas sem hora aparecem como eventos do dia inteiro.

## Ativar no servidor

1. No Google Cloud, habilite a Google Calendar API e configure um cliente OAuth 2.0. A conta usada na autorização precisa ter permissão de **fazer alterações nos eventos** do calendário compartilhado.
2. Obtenha um refresh token com acesso offline e o escopo `https://www.googleapis.com/auth/calendar.events`. É possível usar o [OAuth Playground](https://developers.google.com/oauthplayground), configurando suas próprias credenciais OAuth e a URI de redirecionamento do Playground no cliente. Autorize a conta que pode escrever no calendário e troque o código pelo token. Para uso contínuo, configure o consentimento do aplicativo para produção; tokens de aplicativos externos em teste podem expirar.
3. Preencha **apenas em `backend/.env`**:

```dotenv
GOOGLE_CALENDAR_ID=0f5e8952482afdf6e7a1764b5991182e002722d6deb9c3f4127488cde1fbbce4@group.calendar.google.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
```

4. Reinicie o backend. As migrações entram automaticamente. Faça uma nova reserva e confira o calendário e o convite recebido pelo candidato e pelos participantes.

O link de incorporação do calendário serve para visualização; não fornece autorização de escrita. A senha SMTP também não autoriza a API do Calendar. Não coloque credenciais no frontend ou no Git.

## Sincronização

Os eventos são gravados em uma fila SQLite antes do envio. Falhas ficam pendentes e são tentadas novamente pela rotina de hora em hora. Erros aparecem no Histórico com a ação `GOOGLE_CALENDAR_ERRO`. Sem credenciais, os novos eventos ficam aguardando configuração. Agendamentos anteriores à instalação precisam ser salvos novamente para entrar na fila.

Remarcações e participantes adicionados atualizam o mesmo evento; cancelamentos removem o evento do calendário. O Google envia notificações aos convidados com `sendUpdates=all`. Os convites `.ics` existentes por e-mail continuam disponíveis. A exibição automática na agenda pessoal de cada convidado depende das preferências de convite dessa pessoa.

Referências: [criação e convidados](https://developers.google.com/workspace/calendar/api/guides/create-events), [OAuth e acesso offline](https://developers.google.com/identity/protocols/oauth2/web-server).
