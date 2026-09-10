/**
 * Sending the sign-in link.
 *
 * A seam with two implementations, because the pilot needs to be developed
 * without an account and operated with one. The interface is deliberately
 * narrow -- one address, one subject, one body -- so that a later move to
 * Deloitte's own relay is a new file rather than a change to the sign-in flow.
 *
 * NOTHING HERE LOGS THE LINK IN PRODUCTION. The development sender prints it,
 * which is how magic link is developed locally; it refuses to run outside
 * development so a deployed instance cannot be made to write a working
 * credential into a log aggregator.
 */

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

export type MailSender = {
  name: string;
  send(mail: Mail): Promise<void>;
};

export class MailNotConfigured extends Error {
  constructor(what: string) {
    super(`mail is not configured: ${what}`);
    this.name = "MailNotConfigured";
  }
}

/** Prints the message. Development only, and it enforces that itself. */
export function logSender(): MailSender {
  return {
    name: "log",
    async send(mail) {
      if (process.env.NODE_ENV === "production") {
        throw new MailNotConfigured(
          "the log sender refuses to run in production, because it would write a " +
          "working sign-in link into the server log. Set MM_MAIL=resend.",
        );
      }
      console.log(
        `\n--- sign-in mail (not sent; MM_MAIL=log) ---\n` +
        `to: ${mail.to}\nsubject: ${mail.subject}\n\n${mail.text}\n` +
        `-------------------------------------------\n`);
    },
  };
}

/**
 * Resend, over plain HTTPS. No SDK: the whole API surface used here is one
 * POST, and a dependency that ships its own HTTP client is a larger thing to
 * audit than the request it replaces.
 */
export function resendSender(
  key: string | undefined = process.env.MM_RESEND_KEY,
  from: string | undefined = process.env.MM_MAIL_FROM,
  fetchImpl: typeof fetch = fetch,
): MailSender {
  return {
    name: "resend",
    async send(mail) {
      if (!key) throw new MailNotConfigured("MM_RESEND_KEY is not set");
      if (!from) throw new MailNotConfigured("MM_MAIL_FROM is not set");
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from, to: [mail.to], subject: mail.subject, text: mail.text,
        }),
      });
      if (!res.ok) {
        // The body can name the address it refused. It is quoted here for the
        // server log and never returned to the browser, because the sign-in
        // form must answer identically whoever asks.
        const detail = await res.text().catch(() => "");
        throw new Error(
          `resend refused the message: ${res.status} ${detail.slice(0, 300)}`);
      }
    },
  };
}

/** `MM_MAIL` selects: `log` in development, `resend` when it is configured. */
export function mailSender(which: string | undefined = process.env.MM_MAIL): MailSender {
  const choice = which ?? (process.env.MM_RESEND_KEY ? "resend" : "log");
  switch (choice) {
    case "resend": return resendSender();
    case "log": return logSender();
    default:
      throw new MailNotConfigured(`MM_MAIL=${choice} is not a sender (log, resend)`);
  }
}
