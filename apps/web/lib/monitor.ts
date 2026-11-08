import { Settings } from '@mailops/schema';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';

/**
 * Daily check for engines that stopped checking in. The engine already emails its owner when a
 * run fails; this catches the case where the engine itself is dead (trigger removed, permission
 * revoked, account locked). Marks the mailbox and, if an email provider is configured, notifies.
 */
export async function checkStaleEngines(now = Date.now()) {
  const db = adminDb();
  const users = await db.collection('users').get();
  const report: { mailbox: string; hoursSilent: number; notified: boolean }[] = [];
  for (const u of users.docs) {
    const mailboxes = await u.ref.collection('mailboxes').where('connected', '==', true).get();
    for (const m of mailboxes.docs) {
      const settings = Settings.parse(m.get('settings') ?? {});
      const hb = await m.ref.collection('heartbeat').doc('engine').get();
      const seen =
        (hb.get('lastSeenAt') as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      const hours = seen ? (now - seen) / 3_600_000 : Infinity;
      const stale = hours > settings.staleAfterHours;
      const alerted =
        (m.get('staleAlertedAt') as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      if (!stale) {
        if (alerted) await m.ref.update({ staleAlertedAt: FieldValue.delete() });
        continue;
      }
      let notified = false;
      if (now - alerted > 23 * 3_600_000) {
        notified = await sendAlert(
          String(u.get('email') ?? ''),
          `MailOps engine for ${m.get('email')} is not checking in`,
          `The MailOps engine for ${m.get('email')} last checked in ${seen ? `${Math.floor(hours)} hours ago` : 'never'}.\n\n` +
            'Open its Apps Script project and run `status`, or run `setup` again to reconnect.\n',
        );
        await m.ref.update({ staleAlertedAt: FieldValue.serverTimestamp() });
      }
      report.push({ mailbox: String(m.get('email')), hoursSilent: Math.floor(hours), notified });
    }
  }
  return report;
}

/** Sends an email through Resend when RESEND_API_KEY and ALERT_FROM are set; otherwise skips. */
async function sendAlert(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM;
  if (!key || !from || !to) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject: `[MailOps] ${subject}`, text }),
  });
  return res.ok;
}
