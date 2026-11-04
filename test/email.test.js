import { test } from "node:test";
import assert from "node:assert/strict";
import { _teste } from "../src/lib/smtp.js";

const { montarMensagem, palavraCodificada } = _teste;
const b64 = s => Buffer.from(s, "utf8").toString("base64");

test("assunto com acento vira palavra codificada UTF-8", () => {
  assert.equal(palavraCodificada("Teste"), "Teste");
  assert.equal(palavraCodificada("Proposta — Técnico"), "=?UTF-8?B?" + b64("Proposta — Técnico") + "?=");
});

test("mensagem tem remetente do Gmail, texto, html e anexo", () => {
  const m = montarMensagem({
    usuario: "rh.innomaker@gmail.com", nomeRemetente: "Innomaker Recrutamento",
    para: ["a@x.com"], cc: ["b@x.com"], responderPara: "c@x.com",
    assunto: "Olá", html: "<p>Oi</p>", texto: "Oi",
    anexos: [{ filename: "inicio.ics", content: b64("BEGIN:VCALENDAR") }]
  });
  assert.match(m, /^From: Innomaker Recrutamento <rh\.innomaker@gmail\.com>\r\n/);
  assert.match(m, /\r\nTo: a@x\.com\r\n/);
  assert.match(m, /\r\nCc: b@x\.com\r\n/);
  assert.match(m, /\r\nReply-To: c@x\.com\r\n/);
  assert.match(m, /multipart\/mixed/);
  assert.match(m, /multipart\/alternative/);
  assert.ok(m.includes(b64("<p>Oi</p>")));
  assert.match(m, /Content-Type: text\/calendar; name="inicio\.ics"/);
  assert.ok(!/\n(?!\r)/.test(m.replace(/\r\n/g, "")), "só CRLF");
});
