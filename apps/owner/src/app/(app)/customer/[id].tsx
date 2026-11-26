import { useState } from 'react';
import { Linking, Share } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import { formatDate, formatRupees, telLink, whatsappLink, type CustomerStatus, type LoyaltyProgress } from '@amruta/shared';
import { getSupabase } from '../../../lib/supabase';
import { rpc, run } from '../../../lib/api';
import { useStepUp } from '../../../lib/stepup';
import {
  nodePath, useBalances, useCustomer, usePlaces, useRecentPayments, useRefreshAll, useSubscriptions, useTiffinTypes, useItems,
} from '../../../lib/queries';
import { Badge, Body, Button, Card, Chips, ErrorText, H2, ListRow, Loading, Muted, RowWrap, Screen, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS_TEXT: Record<CustomerStatus, string> = { active: 'Active', paused: 'Paused', stopped: 'Stopped', archived: 'Archived' };

export default function CustomerDetail() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const customer = useCustomer(id);
  const subs = useSubscriptions(id);
  const balances = useBalances();
  const payments = useRecentPayments(id);
  const types = useTiffinTypes();
  const items = useItems();
  const places = usePlaces();
  const refreshAll = useRefreshAll();
  const withStepUp = useStepUp();
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const c = customer.data;
  const bal = balances.data?.find((b) => b.customer_id === id);
  const loyalty = useQuery({
    queryKey: ['owner', 'loyalty', id],
    enabled: !!id,
    queryFn: () => rpc<LoyaltyProgress>('loyalty_progress', { p_customer: id! }),
  });

  const invite = useAction(async () => {
    setInviteCode(await rpc<string>('owner_create_customer_invite', { p_customer: id, p_valid_days: 7 }));
  });
  const unlink = useAction(async () => {
    await withStepUp(() => rpc('owner_unlink_customer', { p_customer: id }));
    await refreshAll();
  });
  const [confirmErase, setConfirmErase] = useState(false);
  const erase = useAction(async () => {
    await withStepUp(() => rpc('owner_erase_customer', { p_customer: id }));
    setConfirmErase(false);
    await refreshAll();
  });
  const setStatus = useAction(async (status: CustomerStatus) => {
    // Pausing/stopping removes future unlocked meals; re-activating recreates them (database trigger).
    // Archiving needs the authenticator code (database rule); pausing/stopping does not.
    await withStepUp(() => run(getSupabase().from('customers').update({ status }).eq('id', id!).select('id').single()));
    await refreshAll();
  });

  if (customer.isLoading) return <Loading />;
  if (!c) return <Screen><ErrorText error={customer.error ?? new Error('NOT_FOUND')} /></Screen>;

  const call = telLink(c.phone);
  const inviteText = inviteCode
    ? tr('Hello {name}, welcome to Amruta\'s Kitchen! Install our app and enter this code: {code} (valid for 7 days, works once).', { name: c.full_name, code: inviteCode })
    : '';
  const wa = whatsappLink(c.phone, inviteText || undefined);

  return (
    <Screen refreshing={customer.isFetching} onRefresh={() => void refreshAll()}>
      <Stack.Screen options={{ title: c.full_name }} />
      <Card>
        <RowWrap>
          <Badge text={tr(STATUS_TEXT[c.status])} tone={c.status === 'active' ? 'good' : 'warn'} />
          <Badge text={c.user_id ? tr('App linked') : tr('App not linked')} tone={c.user_id ? 'good' : 'neutral'} />
          <Badge text={c.billing_mode === 'advance' ? tr('Pays in advance') : tr('Pays monthly')} />
        </RowWrap>
        {c.phone ? <Body>{c.phone}</Body> : null}
        {c.email ? <Muted>{c.email}</Muted> : null}
        {c.food_notes ? <Body>{tr('Food notes: {food_notes}', { food_notes: c.food_notes })}</Body> : null}
        <Muted>{tr('Usual place: {place}', { place: nodePath(c.default_location_node_id, places.data) ?? c.default_location_text ?? tr('not set') })}</Muted>
        <Muted>{tr('Joined {formatDate}', { formatDate: formatDate(c.joined_on) })}</Muted>
        <RowWrap>
          <Button small variant="secondary" title={tr('Edit')} onPress={() => router.push({ pathname: '/customer/edit', params: { id: c.id } })} />
          {c.user_id ? <Button small variant="secondary" title={tr('Message')} onPress={() => router.push({ pathname: '/customer/chat', params: { customerId: c.id } })} /> : null}
          {call ? <Button small variant="ghost" title={tr('Call')} onPress={() => void Linking.openURL(call)} /> : null}
          {wa && !inviteCode ? <Button small variant="ghost" title={tr('WhatsApp')} onPress={() => void Linking.openURL(wa)} /> : null}
        </RowWrap>
      </Card>

      {loyalty.data?.active ? (
        <Card>
          <H2>{tr('Loyalty')}</H2>
          <Body>{tr('{toward_next} of {every_n} meals toward the next {reward_label} ({to_go} to go)', { toward_next: loyalty.data.toward_next, every_n: loyalty.data.every_n, reward_label: loyalty.data.reward_label, to_go: loyalty.data.to_go })}</Body>
          <Muted>{loyalty.data.rewards_given === 1
            ? tr('{delivered} meals delivered in all · 1 reward given', { delivered: loyalty.data.delivered })
            : tr('{delivered} meals delivered in all · {given} rewards given', { delivered: loyalty.data.delivered, given: loyalty.data.rewards_given })}</Muted>
        </Card>
      ) : null}

      <Card>
        <H2>{tr('Status')}</H2>
        <Chips value={c.status} onChange={(s) => void setStatus.run(s)} options={[
          { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' },
          { value: 'stopped', label: 'Stopped' }, { value: 'archived', label: 'Archived' },
        ]} />
        <Muted>{tr('Paused or stopped: future meals not yet past their cutoff are removed. Active again: they come back.')}</Muted>
        <ErrorText error={setStatus.error} />
      </Card>

      {c.status === 'archived' && !c.erased_at ? (
        <Card>
          <H2>{tr('Erase personal data')}</H2>
          <Muted>{tr('When a customer asks to delete their account: removes name, phone, email, notes, delivery places, messages, voice notes and photos. Bills and payments stay (as "Deleted customer") for your accounts. Cannot be undone. Needs your authenticator code.')}</Muted>
          {confirmErase ? <Body bold>{tr('Tap again to erase {full_name}\'s personal data for good.', { full_name: c.full_name })}</Body> : null}
          <Button small variant="danger" title={confirmErase ? tr('Yes, erase for good') : tr('Erase personal data')} loading={erase.busy}
            onPress={() => { if (!confirmErase) setConfirmErase(true); else void erase.run(); }} />
          <ErrorText error={erase.error} />
        </Card>
      ) : null}

      <Card>
        <H2>{tr('Customer app')}</H2>
        {c.user_id ? (
          <>
            <Body>{tr('Linked to their phone.')}</Body>
            <Muted>{tr('Lost phone or wrong person? Unlink, then send a new invite. Needs your authenticator code.')}</Muted>
            <Button small variant="danger" title={tr('Unlink login')} loading={unlink.busy} onPress={() => void unlink.run()} />
            <ErrorText error={unlink.error} />
          </>
        ) : inviteCode ? (
          <>
            <Body bold>{tr('Invite code: {inviteCode}', { inviteCode: inviteCode })}</Body>
            <Muted>{tr('Shown only now. Works once, for 7 days. Creating a new code cancels this one.')}</Muted>
            <RowWrap>
              <Button small title={tr('Share')} onPress={() => void Share.share({ message: inviteText })} />
              {wa ? <Button small variant="secondary" title={tr('Send on WhatsApp')} onPress={() => void Linking.openURL(wa)} /> : null}
              <Button small variant="ghost" title={tr('Copy')} onPress={() => void Clipboard.setStringAsync(inviteCode)} />
            </RowWrap>
          </>
        ) : (
          <>
            <Muted>{tr('Give them a one-time code to join the customer app.')}</Muted>
            <Button small title={tr('Create invite code')} loading={invite.busy} onPress={() => void invite.run()} disabled={c.status === 'archived'} />
            <ErrorText error={invite.error} />
          </>
        )}
      </Card>

      <Card>
        <H2>{tr('Meals (subscriptions)')}</H2>
        {(subs.data ?? []).length === 0 ? <Muted>{tr('No subscriptions yet.')}</Muted> : null}
        {(subs.data ?? []).map((s) => {
          const type = types.data?.find((t) => t.id === s.tiffin_type_id);
          const extras = s.addons.map((a) => `${items.data?.find((i) => i.id === a.item_id)?.name ?? tr('Item')} × ${a.qty}`).join(', ');
          const days = s.days_of_week.length === 7 ? tr('Every day') : s.days_of_week.map((d) => tr(DAY[d]!)).join(', ');
          return (
            <ListRow key={s.id} title={`${tr(s.meal_slot === 'lunch' ? 'Lunch' : 'Dinner')} · ${type?.name ?? ''}`}
              subtitle={[days, s.end_date ? tr('From {start} to {end}', { start: formatDate(s.start_date), end: formatDate(s.end_date) }) : tr('From {start}', { start: formatDate(s.start_date) }), extras ? tr('Extras: {extras}', { extras }) : '']
                .filter(Boolean).join(' · ')}
              right={<Badge text={s.status} tone={s.status === 'active' ? 'good' : 'neutral'} />}
              onPress={() => router.push({ pathname: '/customer/subscription', params: { customerId: c.id, id: s.id } })} />
          );
        })}
        <Button small variant="secondary" title={tr('Add lunch / dinner')}
          onPress={() => router.push({ pathname: '/customer/subscription', params: { customerId: c.id } })} />
      </Card>

      <Card>
        <H2>{tr('Money')}</H2>
        {bal ? (
          <Body bold>
            {bal.balance_paise > 0 ? tr('Due: {formatRupees}', { formatRupees: formatRupees(bal.balance_paise) })
              : bal.balance_paise < 0 ? tr('Advance: {formatRupees}', { formatRupees: formatRupees(-bal.balance_paise) }) : tr('Nothing due')}
          </Body>
        ) : null}
        <RowWrap>
          <Button small title={tr('Record payment')} onPress={() => router.push({ pathname: '/customer/payment', params: { customerId: c.id } })} />
          <Button small variant="secondary" title={tr('Statement & bill')} onPress={() => router.push({ pathname: '/customer/statement', params: { customerId: c.id } })} />
        </RowWrap>
        {(payments.data ?? []).slice(0, 5).map((p) => (
          <ListRow key={p.id} title={`${formatRupees(p.amount_paise)} · ${p.method.toUpperCase()}`}
            subtitle={[formatDate(p.paid_on), p.utr ? `UTR ${p.utr}` : ''].filter(Boolean).join(' · ')}
            right={<Badge text={p.status} tone={p.status === 'confirmed' ? 'good' : p.status === 'rejected' ? 'bad' : 'warn'} />} />
        ))}
      </Card>
    </Screen>
  );
}
