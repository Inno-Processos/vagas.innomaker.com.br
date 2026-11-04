// Situação pública de uma candidatura a partir das etapas.
export function estadoDasEtapas(etapas) {
  let encerrado = false;
  let atual = "";
  const lista = (etapas || []).slice().sort((a, b) => a.ordem - b.ordem).map(et => {
    let estado = "pendente";
    if (et.resultado === "Reprovado") { estado = "encerrada"; encerrado = true; }
    else if (et.resultado === "Aprovado") estado = "concluida";
    else if (!atual && !encerrado) { estado = "atual"; atual = et.nome; }
    return { ordem: et.ordem, nome: et.nome, estado, data: et.data_realizada || et.data_prevista || "" };
  });

  if (encerrado) {
    return { status: "Processo encerrado", etapaAtual: "", etapas: lista,
      mensagem: "Agradecemos sua participação. Neste momento, sua candidatura não seguirá para as próximas etapas." };
  }
  if (lista.length && lista.every(e => e.estado === "concluida")) {
    return { status: "Processo concluído", etapaAtual: "Processo concluído", etapas: lista,
      mensagem: "Você concluiu todas as etapas do processo seletivo. O RH entrará em contato sobre os próximos passos." };
  }
  return { status: "Em processo", etapaAtual: atual || (lista[0] ? lista[0].nome : "Triagem"), etapas: lista,
    mensagem: "Sua candidatura continua em análise." };
}
