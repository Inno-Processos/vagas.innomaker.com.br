/************************************************************
 * API.GS — Painel interno → Admissão
 *
 * Adicione este arquivo ao projeto do Sistema de Admissão
 * (o mesmo do Code.gs, Candidato.html e Gestor.html).
 *
 * Chamado pelo Cloudflare Worker (vagas.innomaker.com.br/painel),
 * somente para usuários do grupo RH no Authelia.
 * Chave compartilhada: Propriedades do script → STAFF_API_KEY
 *
 * Ações: adm_listar, adm_aprovar, adm_recusar, adm_reenviar
 ************************************************************/

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) ? e.postData.contents : "{}");
  } catch (err) {
    return admApiResp_({ ok: false, erro: "Requisição inválida." });
  }

  const chave = PropertiesService.getScriptProperties().getProperty("STAFF_API_KEY");
  if (!chave || String(req.key || "") !== chave) {
    return admApiResp_({ ok: false, status: 403, erro: "Acesso negado: chave do painel inválida (STAFF_API_KEY)." });
  }

  const ator = req.ator || {};
  try {
    switch (req.action) {
      case "adm_listar": return admApiResp_(admApiListar_());
      case "adm_aprovar": return admApiResp_(admApiAprovar_(req, ator));
      case "adm_recusar": return admApiResp_(admApiRecusar_(req, ator));
      case "adm_reenviar": return admApiResp_(admApiReenviar_(req, ator));
      default: return admApiResp_({ ok: false, erro: "Ação desconhecida." });
    }
  } catch (err) {
    logSistema_("ERRO_API_PAINEL", req.requestId || "", err.message, { action: req.action, stack: err.stack || "" });
    return admApiResp_({ ok: false, erro: "Erro no Apps Script (admissão): " + err.message });
  }
}

function admApiResp_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function admApiListar_() {
  const junta = arr => arr.map(x => normalize_(x)).filter(Boolean).join(" / ");
  const ms = v => { const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? 0 : d.getTime(); };

  const itens = getValuesAsObjects_(getSolicitacaoSheet_())
    .filter(i => normalize_(i.requestId))
    .map(i => {
      const f = parseJsonSafe_(i.candidate_payload_json, {});
      const arquivos = parseJsonSafe_(i.uploaded_files_json, []);
      return {
        requestId: normalize_(i.requestId),
        status: normalize_(i.status),
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
        candidato_nome: normalize_(f.candidato_nome || i.candidato_nome),
        candidato_email: normalize_(i.email_pessoal || i.candidato_email),
        titulo_vaga: normalize_(i.titulo_vaga),
        vaga_id: normalize_(i.vaga_id),
        gestor_nome: normalize_(i.gestor_nome),
        gestor_email: normalize_(i.gestor_email),
        funcao: normalize_(i.funcao),
        departamento: normalize_(i.departamento),
        setor: normalize_(i.setor),
        tipo_contratacao: normalize_(i.tipo_contratacao),
        bolsa_valor: normalize_(i.bolsa_valor),
        remuneracao_bolsa: normalize_(i.remuneracao_bolsa),
        data_inicio: i.data_inicio,
        telefone_contato: normalize_(i.telefone_contato),
        cpf: normalize_(f.cpf),
        rg: normalize_(f.rg),
        endereco_completo: junta([i.endereco, i.bairro, i.cidade, i.estado, i.cep]),
        dados_bancarios: junta([i.banco, i.agencia, i.conta, i.tipo_conta]),
        pix: junta([i.pix_numero, i.pix_banco]),
        formacao: junta([i.grau_instrucao, i.area_formacao, i.instituicao_ensino, i.cr ? "CR " + i.cr : ""]),
        matricula_uff: normalize_(i.matricula_uff),
        email_innomaker: normalize_(i.email_innomaker),
        emergencia: junta([i.nome_emergencia, i.telefone_emergencia]),
        pasta_funcionario_link: normalize_(i.pasta_funcionario_link),
        approval_reason: normalize_(i.approval_reason),
        erro_ultimo: normalize_(i.erro_ultimo),
        arquivos: (Array.isArray(arquivos) ? arquivos : [])
          .map(a => ({ name: a && a.name, url: a && a.url }))
          .filter(a => a.url)
      };
    });

  itens.sort((a, b) => ms(b.updatedAt || b.createdAt) - ms(a.updatedAt || a.createdAt));
  return { ok: true, appUrl: getAppUrl_(), itens };
}

function admApiTrava_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("O sistema está ocupado. Tente novamente em alguns segundos.");
  return lock;
}

function admApiAprovar_(req, ator) {
  const id = normalize_(req.requestId);
  if (!id) return { ok: false, erro: "Informe a solicitação." };

  const lock = admApiTrava_();
  try {
    const row = getSolicitacaoRowByRequestId_(id);
    if (normalize_(row.status) !== "AGUARDANDO_APROVACAO") {
      return { ok: false, erro: "Só é possível aprovar quando o candidato já enviou o cadastro. Situação atual: " + row.status + "." };
    }
    const res = approveRequest(id, ator.nome || "RH", ator.email || ADMIN_EMAIL);
    logSistema_("APROVAR_PELO_PAINEL", id, "Aprovado pelo painel interno", { ator: ator });
    return res;
  } finally {
    lock.releaseLock();
  }
}

function admApiRecusar_(req, ator) {
  const id = normalize_(req.requestId);
  const motivo = normalize_(req.motivo);
  if (!id) return { ok: false, erro: "Informe a solicitação." };
  if (motivo.length < 5) return { ok: false, erro: "Escreva a justificativa da recusa." };

  const lock = admApiTrava_();
  try {
    const row = getSolicitacaoRowByRequestId_(id);
    if (normalize_(row.status) !== "AGUARDANDO_APROVACAO") {
      return { ok: false, erro: "Só é possível recusar cadastros aguardando aprovação. Situação atual: " + row.status + "." };
    }
    rejectRequestAndNotifyCandidate_(id, ator.nome || "RH", ator.email || ADMIN_EMAIL, motivo);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function admApiReenviar_(req, ator) {
  const id = normalize_(req.requestId);
  if (!id) return { ok: false, erro: "Informe a solicitação." };

  const row = getSolicitacaoRowByRequestId_(id);
  const st = normalize_(row.status);
  if (st !== "PROPOSTA_ENVIADA" && st !== "COMPLETANDO_CADASTRO") {
    return { ok: false, erro: "A proposta só pode ser reenviada antes do envio do cadastro. Situação atual: " + st + "." };
  }
  const res = resendProposal(id);
  logSistema_("REENVIAR_PELO_PAINEL", id, "Proposta reenviada pelo painel interno", { ator: ator });
  return res;
}
