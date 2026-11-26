import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cols, formatDate, istClock, istToday } from '@amruta/shared';
import { getSupabase } from './supabase';
import { rpc, run } from './api';
import { registerForPush, type PushSetupResult } from './push';
import { enableWebAlerts, isIosBrowser, webAlertsState, type WebAlertsState } from './webpush';
import { Body, Button, Card, Empty, ErrorText, H2, ListRow, Loading, Muted, Screen, SwitchRow, useAction } from './ui/kit';
import { useT } from './i18n';

export interface InboxItem { id: string; kind: string; title: string; body: string; data: Record<string, unknown>; created_at: string; read_at: string | null }

/** Latest 50 alerts of the signed-in person (RLS: own rows only). */
export function useInbox() {
  return useQuery({
    queryKey: ['inbox', 'list'],
    queryFn: () => run<InboxItem[]>(getSupabase().from('notifications').select(cols('notifications'))
      .order('created_at', { ascending: false }).limit(50)),
    refetchInterval: 60_000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['inbox', 'unread'],
    queryFn: async () => {
      const { count, error } = await getSupabase().from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}

export interface PrefOption { kind: string; label: string }

/** The Alerts screen used by all three apps: list, mark read, phone-alert setup, which alerts to receive. */
/** webPushKey: the public VAPID key (EXPO_PUBLIC_VAPID_PUBLIC_KEY) for alerts in the web app. */
export function InboxScreen({ appLabel, prefs, webPushKey = '' }: { appLabel: string; prefs: readonly PrefOption[]; webPushKey?: string }) {
  const tr = useT();
  const qc = useQueryClient();
  const inbox = useInbox();
  const refresh = () => qc.invalidateQueries({ queryKey: ['inbox'] });
  const markAll = useAction(async () => { await rpc('mark_notifications_read', { p_ids: null }); await refresh(); });
  const today = istToday();

  return (
    <Screen refreshing={inbox.isFetching} onRefresh={() => void refresh()}>
      {inbox.isLoading ? <Loading /> : null}
      <ErrorText error={inbox.error ?? markAll.error} />
      <Card>
        {(inbox.data ?? []).length === 0 && !inbox.isLoading ? <Empty text={tr('No alerts yet.')} /> : null}
        {(inbox.data ?? []).map((n) => {
          const d = new Date(Date.parse(n.created_at) + 330 * 60_000).toISOString().slice(0, 10);
          return (
            <ListRow key={n.id} title={`${n.read_at ? '' : '● '}${n.title}`}
              subtitle={`${n.body}\n${d === today ? tr('Today') : formatDate(d)} · ${istClock(n.created_at)}`} />
          );
        })}
        {(inbox.data ?? []).some((n) => !n.read_at) ? (
          <Button small variant="secondary" title={tr('Mark all as read')} loading={markAll.busy} onPress={() => void markAll.run()} />
        ) : null}
      </Card>
      {Platform.OS === 'web' ? <WebAlertsCard appLabel={appLabel} vapidKey={webPushKey} /> : <PhoneAlertsCard appLabel={appLabel} />}
      {prefs.length > 0 ? <PrefsCard prefs={prefs} /> : null}
    </Screen>
  );
}

const RESULT_TEXT: Record<PushSetupResult, string> = {
  registered: 'Phone alerts are on for this phone.',
  denied: 'Alerts are blocked. Allow notifications for this app in your phone settings, then tap again.',
  unsupported: Platform.OS === 'web'
    ? 'Phone pop-ups are not available in the web version yet. New alerts always appear on this screen.'
    : 'This device cannot receive phone alerts (for example an emulator).',
  'no-project-id': 'Phone alerts are not set up in this app build yet (see setup guide step 11). Alerts still appear here.',
  error: 'Could not turn on phone alerts right now. Try again later.',
};

function PhoneAlertsCard({ appLabel }: { appLabel: string }) {
  const tr = useT();
  const [result, setResult] = useState<PushSetupResult | null>(null);
  const turnOn = useAction(async () => setResult(await registerForPush(appLabel)));
  return (
    <Card>
      <H2>{tr('Phone alerts')}</H2>
      {result ? <Body>{tr(RESULT_TEXT[result])}</Body> : <Muted>{tr('Get a pop-up on your phone for new alerts.')}</Muted>}
      {Platform.OS !== 'web' ? <Button small variant="secondary" title={tr('Turn on / check phone alerts')} loading={turnOn.busy} onPress={() => void turnOn.run()} /> : null}
    </Card>
  );
}

const WEB_TEXT: Record<WebAlertsState, string> = {
  on: 'Alerts are on for this browser. You get a pop-up even when the app is closed.',
  off: 'Get a pop-up for new alerts, even when the app is closed.',
  blocked: 'Alerts are blocked for this site. Allow notifications for it in your browser or phone settings, then come back.',
  'install-first': 'On iPhone, alerts work in the app added to your Home Screen: tap Share › Add to Home Screen, open it from there, then turn alerts on.',
  unsupported: 'This browser cannot show alerts. New alerts always appear on this screen.',
};

function WebAlertsCard({ appLabel, vapidKey }: { appLabel: string; vapidKey: string }) {
  const tr = useT();
  const [state, setState] = useState<WebAlertsState | null>(null);
  useEffect(() => { void webAlertsState().then(setState); }, []);
  const turnOn = useAction(async () => setState(await enableWebAlerts(vapidKey, `${appLabel} (${isIosBrowser() ? 'iPhone' : 'browser'})`)));
  return (
    <Card>
      <H2>{tr('Alerts on this device')}</H2>
      {state ? <Body>{vapidKey || state !== 'off' ? tr(WEB_TEXT[state]) : tr('Pop-up alerts are not set up for the web app yet. New alerts always appear on this screen.')}</Body> : null}
      {state === 'off' && vapidKey ? <Button small variant="secondary" title={tr('Turn on alerts')} loading={turnOn.busy} onPress={() => void turnOn.run()} /> : null}
      <ErrorText error={turnOn.error} />
    </Card>
  );
}

function PrefsCard({ prefs }: { prefs: readonly PrefOption[] }) {
  const tr = useT();
  const current = useQuery({
    queryKey: ['inbox', 'prefs'],
    queryFn: async () => (await run<{ muted_kinds: string[] }[]>(getSupabase().from('notification_prefs').select('muted_kinds')))[0]?.muted_kinds ?? [],
  });
  const [muted, setMuted] = useState<string[]>([]);
  useEffect(() => { if (current.data) setMuted(current.data); }, [current.data]);
  const save = useAction(async (next: string[]) => { await rpc('set_notification_prefs', { p_muted: next }); setMuted(next); });
  return (
    <Card>
      <H2>{tr('Which alerts to send to my phone')}</H2>
      {prefs.map((p) => (
        <SwitchRow key={p.kind} label={tr(p.label)} value={!muted.includes(p.kind)}
          onValueChange={(on) => void save.run(on ? muted.filter((k) => k !== p.kind) : [...muted, p.kind])} />
      ))}
      <Muted>{tr('Switched-off alerts still appear on this screen. Days off, payments and bills always come through.')}</Muted>
      <ErrorText error={save.error} />
    </Card>
  );
}
