/* Documento para leitura, impressão e assinatura eletrônica (/documento/<id>).
   Os dados vêm de GET /api/documento/<id>; a assinatura vai para POST /api/candidato/assinar. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const id = decodeURIComponent(location.pathname.replace(/^\/documento\//, "").replace(/\/+$/, ""));
  const dataHora = iso => { try { return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }); } catch (e) { return iso || ""; } };

  $("imprimir").addEventListener("click", () => window.print());

  function erro(titulo, texto) {
    $("carregando").hidden = true;
    const f = $("folha");
    f.hidden = false;
    $("titulo").textContent = "";
    $("texto").textContent = "";
    const h = document.createElement("h2"); h.textContent = titulo;
    const p = document.createElement("p"); p.textContent = texto; p.style.textAlign = "center";
    $("texto").append(h, p);
    $("rodape").hidden = true;
  }

  fetch("/api/documento/" + encodeURIComponent(id), { credentials: "same-origin", headers: { accept: "application/json" } })
    .then(r => (r.headers.get("content-type") || "").indexOf("application/json") >= 0 ? r.json().then(j => [r.status, j]) : [r.status, null])
    .then(([status, j]) => {
      if (status === 401 && j && j.entrar) { location.replace(j.entrar); return; }
      if (!j) return erro("Sistema indisponível", "O sistema está sendo atualizado. Recarregue a página em instantes.");
      if (!j.ok) return erro(status === 404 ? "Documento não encontrado" : "Sem acesso", j.erro || "Não foi possível abrir o documento.");
      mostrar(j);
    })
    .catch(() => erro("Falha de conexão", "Verifique sua internet e recarregue a página."));

  function mostrar(j) {
    const d = j.documento;
    document.title = d.titulo + " — Vagas.Innomaker";
    $("voltar").href = j.voltar || "/";
    $("titulo").textContent = d.titulo;
    $("texto").innerHTML = d.conteudo_html; // gerado e escapado pelo backend (textoParaHtml)
    const rod = $("rodape");
    rod.textContent = "";
    const linha = (rotulo, valor) => { const b = document.createElement("b"); b.textContent = rotulo; rod.append(b, document.createTextNode(valor)); };
    const codigo = txt => { const c = document.createElement("code"); c.textContent = txt; rod.append(c); };
    if (d.status === "ASSINADO") {
      rod.className = "assinatura";
      linha("Assinado eletronicamente", ` por ${d.assinado_nome} (CPF ${d.assinado_cpf}) em ${dataHora(d.assinado_em)}, IP ${d.assinado_ip || "—"}.`);
      rod.append(document.createElement("br"), document.createTextNode("Código de verificação: "));
      codigo(d.hash);
    } else if (d.status === "CANCELADO") {
      rod.className = "assinatura aviso";
      rod.textContent = "Documento cancelado pelo RH.";
    } else {
      rod.className = "assinatura aviso";
      rod.append(document.createTextNode("Aguardando assinatura. Código do documento: "));
      codigo(String(d.hash || "").slice(0, 16));
    }
    $("carregando").hidden = true;
    $("folha").hidden = false;
    if (j.podeAssinar && d.status !== "ASSINADO" && d.status !== "CANCELADO") prepararAssinatura(d.id);
  }

  function prepararAssinatura(docId) {
    const f = $("assinar");
    f.hidden = false;
    f.addEventListener("submit", async ev => {
      ev.preventDefault();
      const msg = $("msg"), bt = f.querySelector("button[type=submit]");
      bt.disabled = true; bt.textContent = "Assinando…"; msg.textContent = "";
      try {
        const r = await fetch("/api/candidato/assinar", {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ documento_id: docId, nome: f.nome.value, cpf: f.cpf.value, concordo: f.concordo.checked })
        });
        const j = (r.headers.get("content-type") || "").indexOf("application/json") >= 0 ? await r.json() : null;
        if (j && j.ok) return location.reload();
        msg.textContent = (j && j.erro) || "O sistema está sendo atualizado. Tente de novo em instantes.";
      } catch (e) { msg.textContent = "Falha de conexão. Tente novamente."; }
      bt.disabled = false; bt.textContent = "Assinar documento";
    });
  }
})();
