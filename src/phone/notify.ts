import { api } from '../api';

/** Phone notifications ("Your reel is ready"). iPhone only allows them for apps added to the Home Screen (iOS 16.4+). */
export type PushState = 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-install';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function registerWorker() {
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !standalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

function keyBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Must be called from a tap (browsers only show the permission prompt then). */
export async function turnOnPush(): Promise<PushState> {
  const state = await pushState(); if (state === 'needs-install' || state === 'unsupported' || state === 'blocked') return state;
  const registration = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission(); if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const { publicKey } = await api.pushKey();
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api.pushSubscribe(subscription.toJSON()); return 'on';
}

export async function turnOffPush(): Promise<PushState> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) { await api.pushUnsubscribe(subscription.endpoint).catch(() => undefined); await subscription.unsubscribe(); }
  return 'off';
}
