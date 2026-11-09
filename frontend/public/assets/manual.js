/* Manual de cada aba do painel — Vagas.Innomaker. Abre pelo ícone de livro no topo do painel.
   Chave = aba (ou rota interna). "passos" vira lista numerada; "dicas" vira lista de observações.
   Para textos diferentes por papel, use { rh: {...}, gerente: {...}, funcionario: {...} }. */
window.MANUAL_PAINEL = {
  "inicio": {
    rh: {
      resumo: "Sua central do dia: o que está pendente e as vagas que os gestores pediram.",
      passos: [
        "Os números no topo mostram o que precisa de atenção. Os que estão verdes têm pendências: clique para abrir a aba certa.",
        "Em <b>Aguardando sua aprovação</b> ficam as vagas pedidas pelos gestores. Use <b>Ver dados</b> para ler o pedido inteiro.",
        "Decida ali mesmo: <b>Aprovar</b>, <b>Recusar com alteração</b> (o pedido volta para o gestor corrigir e reenviar) ou <b>Recusar</b> (encerra; escreva o motivo).",
        "Depois de aprovar, o sistema pergunta se você quer criar a vaga. O formulário já vem preenchido com os dados do pedido.",
        "Pedidos aprovados que ainda não viraram vaga aparecem em <b>Aprovadas — falta criar a vaga</b>."
      ],
      dicas: ["O número verde ao lado de <b>Solicitações</b>, no menu, mostra quantos pedidos esperam sua decisão.",
        "Antes de aprovar, alinhe faixa salarial, budget e modelo de contratação com o gestor, o Financeiro e a Engenharia (RHC-PROC-2026-002)."]
    },
    gerente: {
      resumo: "Peça vagas para a sua área e acompanhe a resposta do RH.",
      passos: [
        "Clique em <b>+ Solicitar vaga</b> para pedir ao RH a abertura de uma vaga.",
        "Em <b>Minhas solicitações</b> você vê a situação de cada pedido: Aguardando RH, Recusada com alteração, Aprovada, Vaga criada ou Recusada.",
        "Se o RH recusar com alteração, aparece um aviso com o link <b>Corrigir agora</b>.",
        "Em <b>Vagas da minha área</b> ficam as vagas abertas a partir dos seus pedidos, com os candidatos."
      ],
      dicas: ["Você recebe por e-mail cada decisão do RH."]
    },
    funcionario: {
      resumo: "Vagas abertas para indicar pessoas e links úteis.",
      passos: ["Veja as vagas abertas e clique em <b>Copiar link</b> para mandar a alguém.", "Use os <b>Links úteis</b> para a Cartilha do Colaborador e outros materiais."]
    }
  },

  "vagas-abertas": {
    resumo: "As vagas que estão publicadas no site agora.",
    passos: ["Clique em <b>Copiar link</b> e envie para quem você quer indicar.", "Clique em <b>Abrir</b> para ver a vaga como o candidato vê."],
    dicas: ["Só aparecem vagas Abertas e dentro do prazo de inscrição."]
  },

  "solicitar": {
    resumo: "Pedido de abertura de vaga (RHC-PROC-2026-002). O RH analisa e responde por e-mail.",
    passos: [
      "No bloco <b>A vaga</b>, escolha o departamento e preencha título, quantidade, data limite de inscrição, localidade, tipo de contratação, carga horária e remuneração.",
      "No bloco <b>Perfil e atividades</b>, descreva a oportunidade e separe as habilidades <b>obrigatórias</b> das <b>diferenciais</b>.",
      "Preencha motivo, urgência e gestor responsável.",
      "Marque a declaração de concordância e clique em <b>Enviar solicitação ao RH</b>."
    ],
    dicas: ["Campos com * são obrigatórios. Se faltar algum, ele fica em vermelho.",
      "Siga as dicas do quadro <b>Antes de enviar</b>, ao lado do formulário.",
      "Para pedir uma vaga parecida com outra, use <b>Usar como base</b> em Minhas solicitações."]
  },

  "editar-solicitacao": {
    resumo: "Corrija o que o RH pediu e reenvie.",
    passos: ["Leia o que o RH pediu em <b>Minhas solicitações</b> (quadro <b>Recusada com alteração</b>).", "Ajuste os campos necessários.", "Clique em <b>Reenviar ao RH</b>. O pedido volta para <b>Aguardando RH</b> e o RH é avisado por e-mail."]
  },

  "minhas": {
    resumo: "Todos os pedidos de vaga feitos com o seu e-mail.",
    passos: [
      "<b>Aguardando RH:</b> o pedido foi enviado e o RH vai analisar. Depois de enviado, ele <b>não pode ser alterado</b>.",
      "<b>Recusada com alteração:</b> o RH pediu mudanças. Só neste caso você pode alterar: clique em <b>Corrigir e reenviar</b>.",
      "<b>Aprovada:</b> o RH vai criar a vaga. <b>Vaga criada:</b> a vaga já está publicada (o link aparece no pedido).",
      "<b>Recusada:</b> o motivo aparece no pedido."
    ],
    dicas: ["<b>Usar como base</b> copia um pedido antigo para um novo formulário.", "<b>Ver todos os dados</b> mostra o pedido completo e o histórico."]
  },

  "minhas-vagas": {
    resumo: "Vagas abertas a partir dos seus pedidos ou em que você é o gestor responsável.",
    passos: ["Clique em uma vaga para ver os candidatos e abrir os currículos.", "Acompanhe em que etapa cada candidato está."],
    dicas: ["Quem registra o resultado das etapas é o RH. Combine com o RH a sua avaliação (entrevista com gestor)."]
  },

  "solicitacoes": {
    resumo: "Pedidos de vaga dos gestores. O RH aprova, recusa ou recusa com alteração.",
    passos: [
      "Use os filtros (<b>Aguardando</b>, <b>Com o gestor (alteração)</b>, <b>Aprovadas</b>…) ou a busca para achar um pedido.",
      "Clique em <b>Ver todos os dados</b> para conferir descrição, requisitos, salário, prazo e tipo de contrato.",
      "<b>Aprovar:</b> confirme que o alinhamento com o gestor, Financeiro e Engenharia foi feito. Em seguida, crie a vaga.",
      "<b>Recusar com alteração:</b> escreva o que o gestor precisa mudar. Ele recebe por e-mail, corrige e reenvia. É o único jeito de o pedido ser alterado depois de enviado.",
      "<b>Recusar:</b> escreva o motivo. O pedido é encerrado e o gestor é avisado.",
      "Pedidos <b>Aprovados</b> têm o botão <b>Criar vaga</b>, com o formulário já preenchido."
    ],
    dicas: ["Os pedidos pendentes também aparecem na tela <b>Início</b>, com os mesmos botões."]
  },

  "solicitacao": null, // usa o de "solicitacoes"

  "vagas": {
    resumo: "Todas as vagas: criar, editar, controlar prazo e acompanhar candidatos.",
    passos: [
      "Clique em <b>Nova vaga</b> para criar uma vaga sem pedido de gestor.",
      "Clique no nome da vaga para ver os candidatos e conduzir as etapas.",
      "Para mudar a situação (Aberta, Pausada, Fechada, Concluída) ou o prazo, abra a vaga e clique em <b>Editar vaga</b>.",
      "Use <b>Copiar link</b> para divulgar."
    ],
    dicas: ["Só vagas <b>Abertas</b> e com prazo em dia aparecem no site.", "Vagas com prazo vencido são fechadas automaticamente toda madrugada."]
  },

  "vaga": {
    rh: {
      resumo: "Candidatos da vaga e a avaliação de cada etapa do processo seletivo (RHC-PROC-2026-001).",
      passos: [
        "Na lista, a trilha mostra as etapas de cada candidato (verde = aprovada, vermelho = recusada) e a soma das estrelas. Clique em <b>Avaliar</b>.",
        "A ficha do candidato mostra as etapas em ordem. Só a etapa atual pode ser avaliada; as seguintes liberam quando ela for aprovada.",
        "Em <b>Avaliar</b>: dê a nota de <b>1 a 3 estrelas</b> (abaixo do esperado, dentro do esperado, acima do esperado), escreva a <b>análise</b> e escolha <b>Aprovado</b> ou <b>Recusado</b>.",
        "<b>Recusado</b> encerra o processo e envia o texto da análise como <b>feedback ao candidato</b> por e-mail. A janela mostra a prévia do e-mail antes de confirmar.",
        "<b>Aprovado</b> passa para a próxima etapa. Se quiser, marque <b>Avisar o candidato</b> para mandar um e-mail dizendo que ele avançou.",
        "<b>Marcar data</b> (na etapa atual): escolha dia, hora e local ou link. O candidato recebe por e-mail, com convite para a agenda, e vê a data na Área do candidato. Use <b>Mudar data</b> para remarcar.",
        "Quando todas as etapas estiverem aprovadas, clique em <b>Enviar proposta</b> (e-mail pessoal, não pode ser @id.uff.br).",
        "<b>Agenda de entrevistas:</b> clique em <b>+ Nova agenda</b>, escolha a etapa, o local (ou link online), quem entrevista e gere os horários (dia, das/às e pausa). Salve.",
        "Clique em <b>Enviar link</b>: cada candidato que está naquela etapa recebe um e-mail para escolher um horário livre. Um horário reservado não pode ser pego por outra pessoa.",
        "Quando o candidato reserva, ele e os entrevistadores recebem o <b>convite de calendário</b>. No dia anterior, todos recebem um lembrete.",
        "Clique num horário reservado para <b>convidar mais alguém</b> só para aquela entrevista ou <b>cancelar</b> (o candidato pode escolher outro)."
      ],
      dicas: ["A Triagem (análise do currículo) não tem agenda; as outras etapas têm, para entrevista ou teste.",
        "O candidato pode trocar de horário sozinho até 2 horas antes. Se for recusado ou desistir, o horário dele é liberado e os entrevistadores são avisados.",
        "Na ficha do candidato: <b>Banco de talentos</b> guarda o candidato com palavras-chave e anotação; <b>Excluir dados (LGPD)</b> apaga tudo dele a pedido.",
        "Para corrigir uma avaliação, use <b>Editar</b> na etapa. O e-mail de recusa não é enviado de novo.",
        "Se a pessoa desistir, use <b>Registrar desistência</b> no fim da ficha."]
    },
    gerente: {
      resumo: "Candidatos da vaga da sua área.",
      passos: ["Veja os candidatos e abra os currículos.", "Acompanhe a etapa atual de cada um.", "Na <b>Agenda de entrevistas</b> você vê os horários marcados com cada candidato."],
      dicas: ["O resultado das etapas é registrado pelo RH."]
    }
  },

  "vaga-form": {
    resumo: "Dados da vaga que aparecem no site.",
    passos: [
      "Preencha título, prazo de inscrição, localidade, tipo de contratação, carga horária, descrição, requisitos e principais funções.",
      "Escolha as <b>etapas</b> do processo seletivo (ex.: Triagem, Entrevista RH, Teste técnico, Entrevista com gestor).",
      "Defina a situação: <b>Aberta</b> publica no site. <b>Pausada</b>, <b>Fechada</b> ou <b>Concluída</b> tiram do site.",
      "Clique em <b>Publicar vaga</b> (vaga nova) ou <b>Salvar alterações</b>."
    ],
    dicas: ["Vindo de uma solicitação aprovada, o formulário já chega preenchido. Confira antes de salvar."]
  },
  "vaga-de-solicitacao": null, // usa o de "vaga-form"

  "admissoes": {
    resumo: "Propostas e admissões, do envio da proposta ao onboarding (RHC-PROC-2026-003).",
    passos: [
      "<b>Para conferir:</b> o cadastro chegou. Abra para conferir campo a campo.",
      "<b>Com o candidato:</b> proposta esperando resposta (com o prazo), cadastro sendo preenchido ou correção pedida.",
      "<b>Pós-aprovação:</b> já tem matrícula; faltam assinaturas, conferência, ponto, acessos ou onboarding.",
      "<b>Concluídas:</b> todos os passos feitos. <b>Encerradas:</b> recusadas, canceladas ou com proposta vencida.",
      "A barrinha em cada admissão mostra a trilha e o próximo passo."
    ],
    dicas: ["As propostas são enviadas pela vaga: <b>Vagas → candidato → Enviar proposta</b>.",
      "Proposta sem resposta até o prazo vence sozinha; você recebe um e-mail e pode reabrir com <b>Editar proposta</b>."]
  },

  "admissao": {
    resumo: "Proposta, conferência do cadastro e trilha até o primeiro dia.",
    passos: [
      "<b>Editar proposta</b> (antes da aprovação): mude valores, datas ou o prazo para responder. Se o candidato já tinha aceitado e você mudar algo que ele vê, ele aceita de novo; o cadastro dele é mantido.",
      "<b>Conferência:</b> confira cada campo e documento. No que estiver errado, clique em <b>Corrigir</b>; depois em <b>Pedir correção</b> escreva o que ajustar em cada item. O candidato vê só esses itens destacados.",
      "Quando ele reenviar, aparece o quadro <b>O candidato corrigiu</b> com o valor antigo e o novo.",
      "Se estiver tudo certo, <b>Aprovar cadastro</b>: marque os 5 itens de conferência e escolha os documentos para assinatura. O sistema pega a próxima matrícula da planilha de Registros e cria o funcionário.",
      "Depois, siga a <b>Trilha da admissão</b>: as assinaturas se marcam sozinhas; conferência, ponto, acessos e onboarding você marca em <b>Marcar como feito</b>.",
      "<b>Pedir acessos</b> manda um e-mail para quem cria o e-mail Innomaker e os sistemas (configure em Configurações → Admissão)."
    ],
    dicas: ["Quando o candidato aceita a proposta, ele recebe por e-mail (e vê na Área do candidato) os termos marcados para o aceite, como o Termo de Compromisso de Estágio e o de Direito de Imagem, para ler. Na aprovação esses termos já vêm marcados para assinatura.",
      "Os documentos exigidos dependem do tipo de contratação (Configurações → Admissão). Sem os obrigatórios, não dá para aprovar.",
      "Na véspera do primeiro dia, o gestor e o RH recebem um e-mail com o que ainda falta, e o novo colaborador recebe as boas-vindas.",
      "<b>Cancelar admissão</b> devolve o candidato a “Aprovado no processo”, para você mandar outra proposta.",
      "<b>Recusar</b> encerra a admissão e envia a justificativa ao candidato."]
  },

  "adm-area": {
    resumo: "Contratações das vagas da sua área.",
    passos: ["Veja em que pé está cada admissão: proposta, cadastro, aprovação, documentos e primeiro dia.",
      "Na véspera do primeiro dia você recebe um e-mail com o que ainda falta."],
    dicas: ["Os dados pessoais do novo colaborador ficam só com o RH."]
  },

  "funcionarios": {
    resumo: "Registros criados na aprovação das admissões.",
    passos: ["Use a busca para encontrar uma pessoa.", "Clique no nome para ver dados, documentos e checklist."],
    dicas: ["Contratos têm duração mínima de 1 ano. O RH recebe um e-mail 45 dias antes do fim."]
  },

  "funcionario": {
    resumo: "Dados, documentos e checklist de um funcionário.",
    passos: [
      "Em <b>Dados do registro</b>, corrija o que for preciso e clique em <b>Salvar dados</b>.",
      "Para renovar ou gerar termos, clique em <b>Gerar documentos</b>, escolha os modelos e envie para assinatura.",
      "Documentos ainda não assinados podem ser cancelados em <b>Cancelar documento</b>.",
      "No checklist, marque: <b>Documentos assinados conferidos</b>, <b>Cadastrado no aplicativo de ponto</b> e <b>Onboarding realizado</b>.",
      "Em <b>Planilha de Registros</b>, confira se a linha foi preenchida. Se aparecer <b>Falhou</b>, leia o motivo e clique em <b>Enviar para a planilha</b>."
    ],
    dicas: ["Se um campo usado no modelo estiver vazio, a geração é cancelada e o sistema diz qual campo falta.",
      "No desligamento, desmarque <b>Funcionário ativo</b>."]
  },

  "configuracoes": {
    resumo: "Ajustes do sistema, sem mexer em código.",
    passos: [
      "<b>Geral:</b> o e-mail do RH recebe todos os avisos. Use <b>Enviar e-mail de teste</b> para conferir se os e-mails estão saindo.",
      "<b>Departamentos e gestores:</b> informe o gestor e o e-mail de cada departamento. É ele quem recebe os avisos da área.",
      "<b>Listas de opções:</b> etapas, tipos de contratação, horários e outras listas (um item por linha).",
      "<b>Modelos de documento:</b> cole o texto oficial dos termos. Use os campos entre chaves, como {{NOME}} e {{CPF}}.",
      "<b>Planilha de Registros:</b> clique em <b>Testar planilha</b> para conferir a ligação com a planilha (mostra a próxima matrícula).",
      "<b>Privacidade (LGPD):</b> defina por quantos meses guardar as candidaturas e o banco de talentos. Passado o prazo, os dados são apagados sozinhos.",
      "<b>Backup:</b> mostra se a cópia diária para fora do servidor está em dia. Se aparecer em vermelho, avise quem cuida do servidor.",
      "<b>Admissão:</b> e-mail de quem cria os acessos e a lista de documentos que o candidato envia, com os obrigatórios por tipo de contratação.",
      "<b>Modelos de documento:</b> em cada modelo, escolha <b>quando o candidato recebe</b> (ao aceitar a proposta, para ler, ou só na aprovação) e <b>para quais tipos de contratação</b> ele vale. Para trazer o texto oficial, cole o link do Google Docs e clique em <b>Importar texto</b>; depois troque nome, CPF, datas etc. pelos campos {{…}}."
    ],
    dicas: ["<b>Links úteis</b> aparecem no início do painel para todos.",
      "Candidatos em processo, admissões e funcionários nunca são apagados pelo prazo de guarda."]
  },

  "registros": {
    resumo: "A aba Registros da planilha, dentro do site.",
    passos: [
      "Cada admissão aprovada vira uma linha aqui, com as mesmas 64 colunas da aba Registros da planilha do Google.",
      "A primeira coluna mostra se a linha já está na planilha. Se falhou, passe o mouse para ver o motivo e clique em <b>Enviar</b>.",
      "<b>Baixar CSV</b> gera o arquivo com as 64 colunas na ordem da planilha (abre no Excel e no Google Sheets)."
    ],
    dicas: ["Para a planilha do Google ser preenchida sozinha, ela precisa estar ligada ao sistema (docs/planilha-registros.md). O teste fica em Configurações → Planilha de Registros."]
  },

  "talentos": {
    resumo: "Pessoas para lembrar em novas vagas.",
    passos: [
      "Aparecem aqui os candidatos que <b>autorizaram</b> o banco de talentos (na inscrição ou na Área do candidato) e os que o RH <b>marcou</b> pela ficha do candidato.",
      "Use a busca para achar por nome, palavra-chave, anotação ou vaga anterior. Os filtros separam marcados pelo RH, só autorizados e sem autorização.",
      "Marque a caixa ao lado de quem autorizou e clique em <b>Convidar para uma vaga</b>. A pessoa recebe um e-mail com o link da vaga.",
      "<b>Anotar</b> guarda palavras-chave e uma anotação. <b>Excluir dados</b> apaga tudo da pessoa (LGPD)."
    ],
    dicas: ["Quem não autorizou não pode receber convite, e os dados dele são apagados no fim do prazo de guarda.",
      "Inscrições vindas do convite aparecem nos Indicadores como “Convite do banco de talentos”."]
  },

  "indicadores": {
    resumo: "Números dos processos seletivos para decidir onde melhorar.",
    passos: [
      "Escolha o período (30 dias a 12 meses, ou tudo). Contam as inscrições feitas nesse período.",
      "Os quadros do topo mostram candidaturas, contratações, tempo médio até contratar, desistências e indicações.",
      "<b>Funil por etapa</b>: quantos chegaram em cada etapa e o que aconteceu (aprovados, recusados, desistiram, aguardando). A frase acima mostra onde mais candidatos param.",
      "<b>De onde vêm os candidatos</b>: resposta de “Como soube da vaga?” na inscrição e quantos de cada origem foram contratados.",
      "<b>Candidatos por vaga</b>: inscritos, em processo e contratados de cada vaga."
    ],
    dicas: ["O link copiado pelo funcionário em <b>Vagas abertas</b> já marca a inscrição como indicação, com o nome dele."]
  },

  "log": {
    resumo: "O que o sistema fez: e-mails enviados e ações de cada pessoa.",
    passos: [
      "Na tabela <b>E-mails</b>: <b>Enviado</b> saiu; <b>Falhou</b> deu erro (passe o mouse sobre o status para ver o motivo); <b>Sem provedor</b> quer dizer que o e-mail não está configurado no servidor.",
      "Na tabela <b>Ações</b>, veja quem fez o quê e quando."
    ]
  }
};
