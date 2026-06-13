/**
 * Morning delivery via Resend (Phase 5). Thin wrapper; the athlete-facing
 * wording is produced upstream from the engine's structured readiness output
 * (LLM phrases it in the coach's voice, template-reviewed once).
 */
import { Resend } from 'resend';

let client: Resend | null = null;

function resend(): Resend {
  if (!client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    client = new Resend(key);
  }
  return client;
}

export interface MorningEmail {
  to: string;
  athleteName: string;
  readinessSentence: string;
  sessionSummary: string;
  checkInUrl: string; // magic link to the 3-slider micro-form
}

export async function sendMorningEmail(msg: MorningEmail) {
  const from = process.env.EMAIL_FROM ?? 'Throughline <coach@throughline.app>';
  return resend().emails.send({
    from,
    to: msg.to,
    subject: `Today's session, ${msg.athleteName.split(' ')[0]}`,
    text: [
      msg.readinessSentence,
      '',
      msg.sessionSummary,
      '',
      `Quick check-in (10s): ${msg.checkInUrl}`,
    ].join('\n'),
  });
}

export interface NudgeEmail {
  to: string;
  subject: string;
  body: string;
  portalUrl: string;
}

/** Proactive nudge (workout reminder / streak protection / comeback). */
export async function sendNudgeEmail(msg: NudgeEmail) {
  const from = process.env.EMAIL_FROM ?? 'Throughline <coach@throughline.app>';
  return resend().emails.send({
    from,
    to: msg.to,
    subject: msg.subject,
    text: [msg.body, '', `Open your plan: ${msg.portalUrl}`, '', 'Reply STOP to turn off these nudges.'].join('\n'),
  });
}
