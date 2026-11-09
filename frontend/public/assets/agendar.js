/* Página de agendamento do candidato (/agendar/<token>), no estilo da agenda de agendamentos do Google:
   informações à esquerda, calendário do mês e horários do dia escolhido. Horário de Brasília.
   Dados: GET /api/agendar/<token>; ações: POST /api/agendar/<token>/reservar | liberar. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const token = decodeURIComponent(location.pathname.replace(/^\/agendar\//, "").replace(/\/+$/, ""));
  const base = "/api/agendar/" + encodeURIComponent(token);
  const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

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
  const maiusc = s => s.charAt(0).toUpperCase() + s.slice(1);
  const dataUTC = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  const diaLongo = iso => maiusc(DIAS[dataUTC(iso).getUTCDay()]) + ", " + iso.slice(8, 10) + " de " + MESES[+iso.slice(5, 7) - 1];
  const hora = s => String(s).slice(11, 16);
  const icone = d => el("span", { class: "ag-ic", "aria-hidden": "true" }, d);

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

  let D = null, mes = null, diaSel = null;

  async function carregar(msgDepois) {
    const d = await chamar();
    $("carregando").hidden = true;
    $("caixa").hidden = false;
    if (!d.ok) {
      limpar($("info"));
      $("info").append(el("h1", null, "Link inválido"), el("p", { class: "suave" }, d.erro || "Não foi possível abrir o agendamento."));
      return;
    }
    D = d;
    const dias = [...new Set(d.livres.map(h => h.inicio.slice(0, 10)))];
    if (!diaSel || dias.indexOf(diaSel) < 0) diaSel = dias[0] || null;
    mes = (diaSel || new Date().toISOString()).slice(0, 7);
    desenhar();
    if (msgDepois) aviso(msgDepois[0], msgDepois[1]);
  }

  function desenharInfo() {
    const d = D, i = $("info");
    limpar(i);
    document.title = d.titulo + " — Innomaker";
    i.append(el("div", { class: "olho" }, d.vaga),
      el("h1", null, d.titulo),
      el("ul", { class: "ag-lista" },
        el("li", null, icone("⏱"), d.duracao_min + " minutos"),
        el("li", null, icone(d.local_tipo === "online" ? "🎥" : "📍"),
          d.local_tipo === "online" ? (d.local ? el("a", { href: d.local, target: "_blank", rel: "noopener" }, "Entrar na videochamada") : "Videochamada (o link vem com a confirmação)") : d.local),
        d.participantes && d.participantes.length ? el("li", null, icone("👤"), d.participantes.join(", ")) : null,
        el("li", null, icone("🌎"), "Horário de Brasília")),
      d.instrucoes ? el("div", { class: "ag-desc" }, d.instrucoes) : null);
  }

  function desenhar() {
    desenharInfo();
    aviso("", "");
    const c = $("conteudo");
    limpar(c);
    const d = D;
    if (d.reserva) {
      c.append(el("h2", null, "Olá, " + d.candidato + "! Seu horário está confirmado"),
        el("div", { class: "reservado" }, el("small", null, "Seu horário"), el("strong", null, diaLongo(d.reserva.inicio) + " · " + hora(d.reserva.inicio) + " às " + hora(d.reserva.fim)),
          el("span", null, "Enviamos o convite para o seu e-mail. Clique em \"Sim\" nele para colocar na sua agenda.")));
      if (d.reserva.podeTrocar) {
        c.append(el("button", { type: "button", class: "botao", onclick: async ev => {
          if (!confirm("Liberar este horário para escolher outro? Ele pode ser reservado por outra pessoa.")) return;
          ev.target.disabled = true;
          const r = await chamar("liberar");
          if (!r.ok) { ev.target.disabled = false; return aviso("erro", r.erro); }
          carregar(["ok", "Horário liberado. Escolha um novo horário."]);
        } }, "Remarcar"),
          el("p", { class: "suave pequeno", style: "margin-top:8px" }, "Você pode remarcar até 24 horas antes."));
      } else c.append(el("p", { class: "suave pequeno" }, "Faltam menos de 24 horas: para remarcar, fale com o RH."));
      if (d.podeDesistir) c.append(botaoDesistir());
      return;
    }
    if (d.desistiu) { c.append(el("h2", null, "Candidatura encerrada")); return aviso("info", "Você desistiu desta candidatura. Obrigado por avisar!"); }
    c.append(el("h2", null, "Olá, " + d.candidato + "! Escolha um dia e um horário"));
    if (d.podeDesistir) c.append(botaoDesistir());
    if (!d.aberto) return aviso("info", d.motivoFechado || "Este agendamento não está disponível.");
    if (!d.livres.length) return aviso("info", "Todos os horários foram reservados. O RH vai abrir novos horários ou entrar em contato com você.");

    const porDia = new Map();
    d.livres.forEach(h => { const k = h.inicio.slice(0, 10); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(h); });
    const meses = [...new Set([...porDia.keys()].map(x => x.slice(0, 7)))].sort();
    const area = el("div", { class: "ag-escolha" });
    c.append(area);

    // Calendário do mês
    const cal = el("div", { class: "ag-cal" });
    const y = +mes.slice(0, 4), m = +mes.slice(5, 7);
    const iMes = meses.indexOf(mes);
    cal.append(el("div", { class: "ag-cal-topo" },
      el("button", { type: "button", class: "ag-nav", "aria-label": "Mês anterior", disabled: !(meses[0] < mes), onclick: () => { mes = meses[Math.max(0, iMes - 1)] < mes ? meses.filter(x => x < mes).pop() : mes; desenhar(); } }, "‹"),
      el("b", null, maiusc(MESES[m - 1]) + " de " + y),
      el("button", { type: "button", class: "ag-nav", "aria-label": "Próximo mês", disabled: !(meses[meses.length - 1] > mes), onclick: () => { mes = meses.find(x => x > mes) || mes; desenhar(); } }, "›")));
    const grade = el("div", { class: "ag-cal-grade" });
    ["D", "S", "T", "Q", "Q", "S", "S"].forEach(x => grade.append(el("span", { class: "ag-sem" }, x)));
    const primeiroDia = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const nDias = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let i = 0; i < primeiroDia; i++) grade.append(el("span"));
    for (let dd = 1; dd <= nDias; dd++) {
      const iso = mes + "-" + String(dd).padStart(2, "0");
      const tem = porDia.has(iso);
      grade.append(el("button", { type: "button", class: "ag-dia" + (tem ? " tem" : "") + (iso === diaSel ? " sel" : ""), disabled: !tem,
        "aria-label": diaLongo(iso) + (tem ? ", " + porDia.get(iso).length + " horário(s)" : ", sem horários"),
        onclick: () => { diaSel = iso; desenhar(); } }, String(dd)));
    }
    cal.append(grade);
    area.append(cal);

    // Horários do dia escolhido
    const col = el("div", { class: "ag-horas" });
    if (diaSel && porDia.has(diaSel)) {
      col.append(el("b", null, diaLongo(diaSel)),
        el("div", { class: "ag-lista-horas" }, porDia.get(diaSel).map(h => el("button", { type: "button", class: "horario", onclick: ev => escolher(h, ev.currentTarget) }, hora(h.inicio)))));
    } else col.append(el("p", { class: "suave" }, "Escolha um dia no calendário."));
    area.append(col);
  }

  // Não vai mais participar: desiste da candidatura (o horário volta a ficar livre e o RH é avisado)
  function botaoDesistir() {
    const caixa = el("div", { class: "desistir" });
    const abrir = el("button", { type: "button", class: "link-desistir", onclick: () => {
      limpar(caixa);
      const motivo = el("textarea", { class: "campo-texto", rows: "2", placeholder: "Se quiser, conte o motivo (opcional)." });
      const ok = el("button", { type: "button", class: "botao perigo", onclick: async () => {
        ok.disabled = true;
        const r = await chamar("desistir", { motivo: motivo.value });
        if (!r.ok) { ok.disabled = false; return aviso("erro", r.erro); }
        carregar(["ok", "Sua desistência foi registrada. Obrigado por avisar!"]);
      } }, "Confirmar desistência");
      caixa.append(el("p", { class: "pequeno" }, el("b", null, "Desistir da candidatura?"), " O RH será avisado e você sai do processo seletivo."), motivo,
        el("div", { class: "acoes-desistir" }, ok, el("button", { type: "button", class: "botao", onclick: () => { limpar(caixa); caixa.append(abrir); } }, "Voltar")));
    } }, "Não vou mais participar — desistir da candidatura");
    caixa.append(abrir);
    return caixa;
  }

  // Confirmação em dois passos (como no Google): clica no horário, depois em Confirmar
  function escolher(h, botao) {
    document.querySelectorAll(".ag-lista-horas .horario").forEach(b => { b.classList.remove("sel"); const x = b.querySelector(".confirmar"); if (x) x.remove(); });
    botao.classList.add("sel");
    const conf = el("span", { class: "confirmar", role: "button", tabindex: "0" }, "Confirmar");
    const ir = async ev => {
      ev.stopPropagation();
      document.querySelectorAll(".horario").forEach(b => { b.disabled = true; });
      conf.textContent = "Reservando…";
      const r = await chamar("reservar", { horario_id: h.id });
      if (r.ok) return carregar(["ok", "Horário confirmado! Enviamos o convite para o seu e-mail."]);
      if (r.ocupado) return carregar(["erro", r.erro]);
      document.querySelectorAll(".horario").forEach(b => { b.disabled = false; });
      conf.textContent = "Confirmar";
      aviso("erro", r.erro || "Não foi possível reservar.");
    };
    conf.addEventListener("click", ir);
    conf.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") ir(ev); });
    botao.append(conf);
  }

  carregar();
})();
