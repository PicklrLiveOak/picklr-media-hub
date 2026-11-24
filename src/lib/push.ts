// Phone / computer push notifications (Web Push — no email, no app store).
//
// iPhone: only works once Media Hub is added to the Home Screen and opened
// from that icon (iOS 16.4+). Safari tabs can't get notifications.
import { supabase } from './supabase';

// Public half of the VAPID key pair (safe to publish). The private half is a
// Supabase secret used by the push-send Edge Function.
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)
  || 'BHVZZNqjZHxS3vFCAYS679c9ET8_kpe_r_yEqcIbxCTRUp6McH9gfy85tN7QDPvuyBzyBw6DVH6HeJA6AXY1dzY';

// What people can choose (profiles.notify_prefs; missing = on)
export const NOTIFY_OPTIONS: { key: string; label: string; perm?: string }[] = [
  { key: 'chat.message', label: 'Direct messages & group chats' },
  { key: 'chat.general', label: 'General chat' },
  { key: 'chat.mention', label: '@mentions' },
  { key: 'chat.request', label: 'Comments on requests I’m part of' },
  { key: 'request.status', label: 'Updates on my requests (status changes)' },
  { key: 'request.assigned', label: 'I’m assigned to a request' },
  { key: 'calendar.assigned', label: 'I’m scheduled on the calendar' },
  { key: 'request.new', label: 'New requests (Strategy team)', perm: 'team.strategy' },
  { key: 'request.approved', label: 'Approved requests (Execution team)', perm: 'team.execution' },
];

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export type PushState = 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on';

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIOS() && !isInstalled() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(b64url: string) {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${browser ? ` · ${browser}` : ''}${isInstalled() ? ' (app)' : ''}`;
}

async function save(sub: PushSubscription) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_device: deviceName(),
  });
  if (error) throw error;
}

/** Ask permission (must run from a tap) and register this device. */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in your phone’s Settings → Notifications → Media Hub.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  await save(sub);
}

/** Stop notifications on this device. */
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** On app start: if this device is already subscribed, make sure it's linked to whoever is signed in. */
export async function resyncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await save(sub);
  } catch { /* offline etc. */ }
}

export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke('push-send', { body: { action: 'test' } });
  if (error) throw error;
  return (data as { sent: number }).sent;
}
