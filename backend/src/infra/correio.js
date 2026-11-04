// Envio de e-mail pelo SMTP do .env (Gmail), com nodemailer — igual ao SAC.
// Sem SMTP_USER/SMTP_PASS o sistema só registra os e-mails no Histórico do painel.
import nodemailer from "nodemailer";

export function criarCorreio(e) {
  if (!e.SMTP_USER || !e.SMTP_PASS) return null;
  const transporte = nodemailer.createTransport({
    host: e.SMTP_HOST || "smtp.gmail.com",
    port: Number(e.SMTP_PORT || 587),
    secure: String(e.SMTP_SECURE) === "true",
    auth: { user: String(e.SMTP_USER).trim(), pass: String(e.SMTP_PASS).replace(/\s+/g, "") }
  });
  return {
    async enviar(m) {
      await transporte.sendMail({
        from: m.nomeRemetente ? { name: m.nomeRemetente, address: m.de } : m.de,
        to: m.para,
        cc: m.cc && m.cc.length ? m.cc : undefined,
        replyTo: m.responderPara || undefined,
        subject: m.assunto,
        text: m.texto,
        html: m.html,
        attachments: (m.anexos || []).filter(a => a && a.filename && a.content)
          .map(a => ({ filename: a.filename, content: a.content, encoding: "base64" }))
      });
    }
  };
}
