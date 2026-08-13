export interface Mail {
  to: string;
  subject: string;
  body: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Preview only: lets the UI and the tests read what would have been sent. */
  outbox?(): readonly Mail[];
}

/**
 * The local preview profile has no SMTP relay (§10 assumes one only for a
 * deployed installation), so mail is written to the log and retained in memory
 * where the reset flow can be exercised end to end.
 */
export class ConsoleMailer implements Mailer {
  private readonly sent: Mail[] = [];

  constructor(private readonly log: (message: string) => void = console.log) {}

  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    if (this.sent.length > 50) this.sent.shift();
    this.log(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.body}`);
  }

  outbox(): readonly Mail[] {
    return this.sent;
  }
}
