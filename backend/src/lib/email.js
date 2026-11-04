// Envio de e-mails pelo Gmail via SMTP com senha de app — mesmas variáveis do SAC:
// SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_HOST/PORT/SECURE (backend/.env).
// env.CORREIO (nodemailer, criado em infra/correio.js) faz o envio.
// Sem usuário/senha, o e-mail é só registrado na tabela "emails" com status SEM_PROVEDOR.
import { agora, esc } from "./http.js";
import { executar } from "./db.js";

export function smtpConfigurado(env) {
  return !!(env.CORREIO && env.SMTP_USER && env.SMTP_PASS);
}

export async function enviarEmail(env, msg) {
  const para = [].concat(msg.para || []).map(s => String(s || "").trim()).filter(Boolean);
  if (!para.length) return { ok: false, erro: "sem destinatário" };

  let status = "SEM_PROVEDOR";
  let erro = "";
  if (smtpConfigurado(env)) {
    try {
      const envio = {
        usuario: String(env.SMTP_USER).trim(),
        senha: String(env.SMTP_PASS).replace(/\s+/g, ""),
        de: String(env.SMTP_FROM || env.SMTP_USER).trim(),
        nomeRemetente: env.EMAIL_NOME || "Innomaker Recrutamento",
        para,
        cc: msg.cc ? [].concat(msg.cc).map(s => String(s || "").trim()).filter(Boolean) : [],
        responderPara: msg.responderPara || env.EMAIL_REPLY_TO || "",
        assunto: msg.assunto,
        html: msg.html,
        texto: msg.texto,
        anexos: msg.anexos
      };
      await env.CORREIO.enviar(envio);
      status = "ENVIADO";
    } catch (e) {
      status = "FALHOU";
      erro = String(e && e.message || e).slice(0, 500);
    }
  }

  try {
    await executar(env, "INSERT INTO emails (quando, para, assunto, status, erro, corpo) VALUES (?, ?, ?, ?, ?, ?)",
      agora(), para.join(", "), msg.assunto, status, erro, env.DEV_USUARIO_FALSO ? (msg.texto || "") : "");
  } catch (e) { console.log("registro de e-mail falhou", e); }

  return { ok: status === "ENVIADO", status, erro };
}

// Layout padrão dos e-mails
export function layout({ titulo, paragrafos, destaque, botao, rodape }) {
  const ps = (paragrafos || []).map(p => `<p style="margin:0 0 14px;font-size:15px;color:#333;line-height:1.65;">${p}</p>`).join("");
  const box = destaque ? `<div style="margin:6px 0 18px;padding:16px;background:#f2f7f1;border-left:4px solid #41a639;border-radius:8px;font-size:14px;color:#222;line-height:1.7;">${destaque}</div>` : "";
  const bt = botao ? `<div style="margin:24px 0;"><a href="${esc(botao.url)}" style="display:inline-block;background:#41a639;color:#fff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;">${esc(botao.texto)}</a></div>` : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#efefed;padding:24px 12px;">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e5e5;">
    <div style="background:#111;padding:20px 28px;color:#fff;font-weight:800;letter-spacing:2px;font-size:18px;">INNOMAKER</div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 16px;font-size:22px;color:#111;">${esc(titulo)}</h1>
      ${ps}${box}${bt}
      <p style="margin:18px 0 0;font-size:13px;color:#777;line-height:1.6;">${rodape || "Equipe Innomaker — Gestão de Pessoas"}</p>
    </div>
  </div>
</div>`;
}

// Texto simples a partir de parágrafos
export function textoSimples(titulo, linhas, link) {
  return [titulo, "", ...(linhas || []), link ? "\n" + link : ""].join("\n").replace(/<[^>]+>/g, "");
}

// Convite de calendário (.ics) em anexo
export function anexoIcs(titulo, dataISO, descricao) {
  const d = String(dataISO || "").replace(/-/g, "");
  if (!/^\d{8}$/.test(d)) return null;
  const uid = crypto.randomUUID() + "@innomaker.com.br";
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Innomaker//Admissao//PT",
    "BEGIN:VEVENT", "UID:" + uid,
    "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
    "DTSTART;TZID=America/Sao_Paulo:" + d + "T090000",
    "DTEND;TZID=America/Sao_Paulo:" + d + "T100000",
    "SUMMARY:" + String(titulo).replace(/[,;]/g, " "),
    "DESCRIPTION:" + String(descricao || "").replace(/\n/g, "\\n").replace(/[,;]/g, " "),
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
  return { filename: "inicio.ics", content: btoa(unescape(encodeURIComponent(ics))) };
}
