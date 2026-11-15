import nodemailer from "nodemailer";

/**
 * Sends email through any SMTP provider (set SMTP_URL and EMAIL_FROM).
 * Without SMTP_URL, messages are not sent: in development they are printed to the
 * server log so you can click the links; in production only a warning is logged.
 */
export function createMailer({ smtpUrl, from, production = false } = {}) {
  if (smtpUrl) {
    const transport = nodemailer.createTransport(smtpUrl);
    return {
      configured: true,
      send: ({ to, subject, text }) => transport.sendMail({ from, to, subject, text }),
      verify: () => transport.verify(),
    };
  }
  return {
    configured: false,
    async send({ to, subject, text }) {
      if (production) console.warn(`[mail] Email is not configured (SMTP_URL). Did not send "${subject}".`);
      else console.log(`[mail] (not sent, SMTP_URL is not set)\n  To: ${to}\n  Subject: ${subject}\n  ${text.replace(/\n/g, "\n  ")}`);
    },
    verify: async () => true,
  };
}
