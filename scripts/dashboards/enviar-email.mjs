// scripts/dashboards/enviar-email.mjs
//
// BL-326 (G12): envía el email de estado que arma send-status-email.mjs.
// Reemplaza a la action de terceros dawidd6/action-send-mail: la contraseña
// del correo ya no pasa por código ajeno. Usa nodemailer, que queda en el
// lockfile del repo (la revisan Trivy, dependency-review y Dependabot).
//
// Se ejecuta en el job "Email de estado" de publicar-dashboards.yml, que
// declara el environment "notificaciones" (solo develop): un workflow lanzado
// desde otra rama no puede leer la contraseña.
//
// Variables de entorno requeridas:
//   MAIL_USERNAME, MAIL_PASSWORD -> cuenta que envía (secrets del environment)
//   EMAIL_TO                     -> destinatarios separados por coma
//   EMAIL_FROM                   -> remitente, ej: "Nombre <correo@dominio>"
//   EMAIL_SUBJECT                -> asunto
//   EMAIL_BODY_PATH              -> ruta del HTML generado
// Opcionales:
//   EMAIL_CC                     -> en copia, separados por coma (BL-599)
//   SMTP_HOST, SMTP_PORT         -> por defecto smtp.gmail.com y 465 (TLS)
//
// No escribe en el log destinatarios ni credenciales: el repositorio es
// público y los logs de Actions también.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const REQUERIDAS = [
  "MAIL_USERNAME",
  "MAIL_PASSWORD",
  "EMAIL_TO",
  "EMAIL_FROM",
  "EMAIL_SUBJECT",
  "EMAIL_BODY_PATH",
];

/**
 * Valida las variables de entorno y arma la configuración del envío.
 * No se conecta a ningún servidor: se puede probar sin mandar correos.
 */
export function leerConfiguracion(env) {
  const faltan = REQUERIDAS.filter((nombre) => !env[nombre]?.trim());
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno: ${faltan.join(", ")}`);
  }

  const lista = (texto) =>
    (texto ?? "")
      .split(",")
      .map((correo) => correo.trim())
      .filter(Boolean);
  const destinatarios = lista(env.EMAIL_TO);
  if (destinatarios.length === 0) {
    throw new Error("EMAIL_TO no tiene destinatarios");
  }

  const puerto = Number(env.SMTP_PORT?.trim() || 465);
  if (!Number.isInteger(puerto) || puerto <= 0 || puerto > 65535) {
    throw new Error("SMTP_PORT tiene que ser un número de puerto válido");
  }

  return {
    transporte: {
      host: env.SMTP_HOST?.trim() || "smtp.gmail.com",
      port: puerto,
      // 465: TLS desde el inicio. Otro puerto (587): STARTTLS obligatorio,
      // nunca se manda la contraseña sin cifrar.
      secure: puerto === 465,
      requireTLS: puerto !== 465,
      auth: { user: env.MAIL_USERNAME.trim(), pass: env.MAIL_PASSWORD },
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    },
    mensaje: {
      from: env.EMAIL_FROM.trim(),
      to: destinatarios,
      ...(lista(env.EMAIL_CC).length > 0 && { cc: lista(env.EMAIL_CC) }),
      subject: env.EMAIL_SUBJECT.trim(),
    },
    rutaCuerpo: env.EMAIL_BODY_PATH.trim(),
  };
}

async function main() {
  const { transporte, mensaje, rutaCuerpo } = leerConfiguracion(process.env);
  const html = await fs.readFile(rutaCuerpo, "utf-8");

  const info = await nodemailer
    .createTransport(transporte)
    .sendMail({ ...mensaje, html });

  const rechazados = info.rejected?.length ?? 0;
  if (rechazados > 0) {
    throw new Error(`El servidor rechazó ${rechazados} destinatario(s)`);
  }
  console.log(`✅ Correo enviado a ${info.accepted.length} destinatario(s).`);
}

// Solo envía si se ejecuta directo (node enviar-email.mjs), no al importarlo
// desde los tests.
const esPrincipal =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (esPrincipal) {
  main().catch((err) => {
    console.error("❌ No se pudo enviar el correo:", err.message);
    process.exit(1);
  });
}
