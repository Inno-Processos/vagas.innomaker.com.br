/* Agendamento pelo candidato (/agendar/<token>): escolhe um horário livre, vê o reservado e pode trocar até 2 h antes.
   Dados: GET /api/agendar/<token>; ações: POST /api/agendar/<token>/reservar | liberar. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const token = decodeURIComponent(location.pathname.replace(/^\/agendar\//, "").replace(/\/+$/, ""));
  const base = "/api/agendar/" + encodeURIComponent(token);
  const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

  function el(tag, attrs) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    Array.prototype.slice.call(arguments, 2).flat().forEach(f => { if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f))); });
    return e;
  }
  const limpar = n => { while (n.firstChild) n.removeChild(n.firstChild); };
  const dia = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); const n = DIAS[d.getUTCDay()]; return n[0].toUpperCase() + n.slice(1) + ", " + m[3] + "/" + m[2]; };
  const hora = s => String(s).slice(11, 16);
  const quando = (i, f) => dia(i) + " · " + hora(i) + " às " + hora(f);

  function aviso(tipo, texto) {
    limpar($("msg"));
    if (texto) $("msg").append(el("div", { class: "alerta " + tipo }, texto));
  }

  async function chamar(acao, dados) {
    try {
      const r = await fetch(base + (acao ? "/" + acao : ""), {
        method: acao ? "POST" : "GET", credentials: "same-origin",
        headers: acao ? { "content-type": "application/json" } : { accept: "application/json" },
        body: acao ? JSON.stringify(dados || {}) : undefined
      });
      if ((r.headers.get("content-type") || "").indexOf("json") < 0) return { ok: false, erro: "O sistema está sendo atualizado. Tente de novo em instantes." };
      return await r.json();
    } catch (e) { return { ok: false, erro: "Falha de conexão. Verifique sua internet e tente de novo." }; }
  }

  async function carregar(msgDepois) {
    const d = await chamar();
    $("carregando").hidden = true;
    $("caixa").hidden = false;
    if (!d.ok) {
      $("titulo").textContent = "Link inválido";
      $("sub").textContent = d.erro || "Não foi possível abrir o agendamento.";
      return;
    }
    desenhar(d);
    if (msgDepois) aviso(msgDepois[0], msgDepois[1]);
  }

  function desenhar(d) {
    document.title = "Agendar " + d.etapa + " — Vagas.Innomaker";
    $("olho").textContent = d.vaga;
    $("titulo").textContent = "Olá, " + d.candidato + "!";
    $("sub").textContent = d.reserva ? "Seu horário para a etapa " + d.etapa + " está reservado." : "Escolha um horário para a etapa " + d.etapa + ".";
    limpar($("info"));
    $("info").append(
      el("div", null, el("small", null, "Duração"), el("b", null, d.duracao_min + " minutos")),
      el("div", null, el("small", null, d.local_tipo === "online" ? "Onde" : "Local"),
        d.local_tipo === "online" ? (d.local ? el("a", { href: d.local, target: "_blank", rel: "noopener" }, "Link da reunião") : el("b", null, "Online (o link vem com a confirmação)")) : el("b", null, d.local)));
    if (d.instrucoes) $("info").append(el("div", { class: "largo" }, el("small", null, "Instruções"), el("span", { class: "pre" }, d.instrucoes)));
    aviso("", "");
    const c = $("conteudo");
    limpar(c);

    if (d.reserva) {
      c.append(el("div", { class: "reservado" }, el("small", null, "Seu horário"), el("strong", null, quando(d.reserva.inicio, d.reserva.fim)),
        el("span", null, "O convite foi enviado para o seu e-mail. Clique em \"Sim\" nele para colocar na sua agenda.")));
      if (d.reserva.podeTrocar) {
        c.append(el("button", { type: "button", class: "botao", onclick: async ev => {
          if (!confirm("Liberar este horário para escolher outro? Ele pode ser reservado por outra pessoa.")) return;
          ev.target.disabled = true;
          const r = await chamar("liberar");
          if (!r.ok) { ev.target.disabled = false; return aviso("erro", r.erro); }
          carregar(["ok", "Horário liberado. Escolha um novo horário abaixo."]);
        } }, "Trocar horário"));
      } else {
        c.append(el("p", { class: "suave pequeno" }, "Faltam menos de 2 horas: para mudar, fale com o RH."));
      }
      return;
    }
    if (!d.aberto) { aviso("info", d.motivoFechado || "Este agendamento não está disponível."); return; }
    if (!d.livres.length) { aviso("info", "Todos os horários foram reservados. O RH vai abrir novos horários ou entrar em contato com você."); return; }

    // Horários agrupados por dia
    const porDia = new Map();
    d.livres.forEach(h => { const k = h.inicio.slice(0, 10); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(h); });
    porDia.forEach((hs, k) => {
      c.append(el("h2", { class: "dia" }, dia(k + "T00:00")),
        el("div", { class: "horarios" }, hs.map(h => el("button", { type: "button", class: "horario", onclick: ev => reservar(h, ev.target) }, hora(h.inicio)))));
    });
  }

  async function reservar(h, botao) {
    if (!confirm("Confirmar " + quando(h.inicio, h.fim) + "?")) return;
    document.querySelectorAll(".horario").forEach(b => { b.disabled = true; });
    botao.textContent = "Reservando…";
    const r = await chamar("reservar", { horario_id: h.id });
    if (r.ok) return carregar(["ok", "Horário confirmado! Enviamos o convite para o seu e-mail."]);
    if (r.ocupado) return carregar(["erro", r.erro]);
    document.querySelectorAll(".horario").forEach(b => { b.disabled = false; });
    botao.textContent = hora(h.inicio);
    aviso("erro", r.erro || "Não foi possível reservar.");
  }

  carregar();
})();
