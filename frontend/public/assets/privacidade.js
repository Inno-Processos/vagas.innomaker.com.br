/* Política de privacidade: completa os prazos de guarda e o contato com o que o RH configurou. */
(function () {
  "use strict";
  fetch("/api/privacidade", { headers: { accept: "application/json" } })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || !d.ok) return;
      document.getElementById("prazoRetencao").textContent = d.prazos.retencao;
      document.getElementById("prazoBanco").textContent = d.prazos.banco;
      if (d.contato) {
        const a = document.getElementById("contato");
        a.textContent = d.contato;
        a.href = "mailto:" + d.contato;
      }
    })
    .catch(() => { /* fica com os valores padrão do texto */ });
})();
