// Cliente SMTP mínimo para o Gmail (smtp.gmail.com:465, TLS direto), usando os sockets TCP do Worker.
// Login com "senha de app" do Google (conta com verificação em duas etapas).

const HOST = "smtp.gmail.com";
const PORTA = 465;
const TEMPO_LIMITE = 25000;

export async function enviarSmtp({ usuario, senha, de, nomeRemetente, para, cc, responderPara, assunto, html, texto, anexos }) {
  const { connect } = await import("cloudflare:sockets");
  const socket = connect({ hostname: HOST, port: PORTA }, { secureTransport: "on", allowHalfOpen: false });
  const leitor = new LeitorLinhas(socket.readable.getReader());
  const escritor = socket.writable.getWriter();
  const enc = new TextEncoder();
  const enviar = s => escritor.write(enc.encode(s));

  const comando = async (linha, esperado) => {
    if (linha !== null) await enviar(linha + "\r\n");
    const r = await leitor.resposta();
    if (!esperado.includes(r.codigo)) {
      const mostrar = linha && linha.startsWith("AUTH") ? "AUTH" : (linha || "conexão");
      throw new Error(`Gmail respondeu ${r.codigo} a ${mostrar}: ${r.texto}`);
    }
    return r;
  };

  const trabalho = (async () => {
    await comando(null, [220]);
    await comando("EHLO vagas.innomaker.com.br", [250]);
    await comando("AUTH PLAIN " + b64Utf8("\0" + usuario + "\0" + senha), [235]);
    await comando(`MAIL FROM:<${de || usuario}>`, [250]);
    for (const d of [...para, ...(cc || [])]) await comando(`RCPT TO:<${d}>`, [250, 251]);
    await comando("DATA", [354]);
    const msg = montarMensagem({ usuario, de, nomeRemetente, para, cc, responderPara, assunto, html, texto, anexos });
    // "dot-stuffing": linhas que começam com ponto ganham outro ponto
    await comando(msg.replace(/\r\n\./g, "\r\n..") + "\r\n.", [250]);
    try { await enviar("QUIT\r\n"); } catch (e) { /* já enviado */ }
  })();

  let timer;
  const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("Tempo esgotado falando com o Gmail")), TEMPO_LIMITE); });
  try {
    await Promise.race([trabalho, limite]);
  } finally {
    clearTimeout(timer);
    try { await socket.close(); } catch (e) { /* ignora */ }
  }
}

class LeitorLinhas {
  constructor(reader) { this.reader = reader; this.buf = ""; this.dec = new TextDecoder(); }
  async linha() {
    for (;;) {
      const i = this.buf.indexOf("\r\n");
      if (i >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2); return l; }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("O Gmail fechou a conexão");
      this.buf += this.dec.decode(value, { stream: true });
    }
  }
  // Resposta SMTP (pode ter várias linhas "250-..." terminando em "250 ...")
  async resposta() {
    const linhas = [];
    for (;;) {
      const l = await this.linha();
      linhas.push(l.slice(4));
      if (l.length < 4 || l[3] !== "-") return { codigo: parseInt(l.slice(0, 3), 10), texto: linhas.join(" ") };
    }
  }
}

function montarMensagem({ usuario, de, nomeRemetente, para, cc, responderPara, assunto, html, texto, anexos }) {
  const limite = () => "=_inno_" + crypto.randomUUID().replace(/-/g, "");
  const cab = [
    "From: " + (nomeRemetente ? `${palavraCodificada(nomeRemetente)} <${de || usuario}>` : (de || usuario)),
    "To: " + para.join(", "),
    cc && cc.length ? "Cc: " + cc.join(", ") : null,
    responderPara ? "Reply-To: " + responderPara : null,
    "Subject: " + palavraCodificada(assunto || ""),
    "Date: " + new Date().toUTCString().replace("GMT", "+0000"),
    "Message-ID: <" + crypto.randomUUID() + "@vagas.innomaker.com.br>",
    "MIME-Version: 1.0"
  ].filter(Boolean);

  const parte = (tipo, conteudo) =>
    `Content-Type: ${tipo}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${quebrar(b64Utf8(conteudo))}`;

  const alt = limite();
  const corpoAlt = [
    `--${alt}\r\n` + parte("text/plain", texto || (html || "").replace(/<[^>]+>/g, "")),
    html ? `--${alt}\r\n` + parte("text/html", html) : null,
    `--${alt}--`
  ].filter(Boolean).join("\r\n");
  const blocoAlt = `Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${corpoAlt}`;

  const lista = (anexos || []).filter(a => a && a.filename && a.content);
  if (!lista.length) return cab.join("\r\n") + "\r\n" + blocoAlt + "\r\n";

  const mix = limite();
  const partes = [`--${mix}\r\n${blocoAlt}`];
  for (const a of lista) {
    const nome = String(a.filename).replace(/["\r\n]/g, "");
    partes.push(`--${mix}\r\nContent-Type: ${tipoArquivo(nome)}; name="${nome}"\r\n` +
      `Content-Disposition: attachment; filename="${nome}"\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      quebrar(String(a.content).replace(/\s+/g, "")));
  }
  partes.push(`--${mix}--`);
  return cab.join("\r\n") + `\r\nContent-Type: multipart/mixed; boundary="${mix}"\r\n\r\n` + partes.join("\r\n") + "\r\n";
}

function tipoArquivo(nome) {
  const ext = nome.split(".").pop().toLowerCase();
  return { ics: "text/calendar", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" }[ext] || "application/octet-stream";
}

function palavraCodificada(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64Utf8(s) + "?=";
}

function b64Utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function quebrar(b64) {
  return b64.replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/, "");
}

export const _teste = { montarMensagem, palavraCodificada };
