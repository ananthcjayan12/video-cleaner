import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import webpush from 'web-push';

/**
 * Phone notifications (Web Push). On iPhone they work once PractiReel is added to the Home Screen (iOS 16.4+).
 * Keys live in ~/.video-cleaner/vapid.json and subscriptions in ~/.video-cleaner/push.json (both mode 600).
 */
export type PushSubscriber = { username: string; role: 'admin' | 'member'; workspaceId?: string; subscription: webpush.PushSubscription; createdAt: string };
export type PushMessage = { title: string; body: string; url: string; tag?: string };

const dir = () => process.env.VIDEO_CLEANER_CONFIG_DIR || path.join(os.homedir(), '.video-cleaner');
const vapidPath = () => path.join(dir(), 'vapid.json');
const subsPath = () => path.join(dir(), 'push.json');
const SUBJECT = 'https://editor.srshti.co.in';

async function writePrivate(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}

let vapid: { publicKey: string; privateKey: string } | null = null;
export async function vapidKeys() {
  if (vapid) return vapid;
  vapid = await fs.readFile(vapidPath(), 'utf8').then((text) => JSON.parse(text)).catch(() => null);
  if (!vapid?.publicKey || !vapid.privateKey) { vapid = webpush.generateVAPIDKeys(); await writePrivate(vapidPath(), vapid); }
  return vapid;
}

export async function loadSubscribers(): Promise<PushSubscriber[]> {
  const raw = await fs.readFile(subsPath(), 'utf8').then((text) => JSON.parse(text)).catch(() => []);
  return Array.isArray(raw) ? raw.filter((s) => s?.subscription?.endpoint && s.username) : [];
}
export async function addSubscriber(subscriber: Omit<PushSubscriber, 'createdAt'>) {
  if (!/^https:\/\//.test(String(subscriber.subscription?.endpoint ?? ''))) throw new Error('Not a valid notification subscription.');
  const all = (await loadSubscribers()).filter((s) => s.subscription.endpoint !== subscriber.subscription.endpoint);
  all.push({ ...subscriber, createdAt: new Date().toISOString() });
  await writePrivate(subsPath(), all);
}
export async function removeSubscriber(endpoint: string) {
  const all = await loadSubscribers(); await writePrivate(subsPath(), all.filter((s) => s.subscription.endpoint !== endpoint));
}

/** Who hears about a reel: that account's logins, and the owner for their own (Personal) reels or any failure. */
export function recipients(all: PushSubscriber[], workspaceId: string, failure = false) {
  return all.filter((s) => s.role === 'member' ? s.workspaceId === workspaceId : workspaceId === 'personal' || failure);
}

/** Best effort: a phone that is off or unsubscribed must never break a reel. Dead subscriptions are removed. */
/** Returns how many phones it was sent to (0 when nobody on the account turned notifications on). */
export async function notify(workspaceId: string, message: PushMessage, failure = false): Promise<number> {
  try {
    const keys = await vapidKeys(); const targets = recipients(await loadSubscribers(), workspaceId, failure);
    await Promise.all(targets.map(async (target) => {
      try {
        await webpush.sendNotification(target.subscription, JSON.stringify(message), { vapidDetails: { subject: SUBJECT, ...keys }, TTL: 24 * 3600, urgency: 'high' });
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await removeSubscriber(target.subscription.endpoint);
      }
    }));
    return targets.length;
  } catch { return 0; /* notifications are optional */ }
}
