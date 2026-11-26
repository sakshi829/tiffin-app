import { useEffect, useState } from 'react';
import { router, Stack } from 'expo-router';
import { formatRupees, parseRupeesToPaise } from '@amruta/shared';
import { AppError, rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useStepUp } from '../../../lib/stepup';
import { useRefreshAll } from '../../../lib/queries';
import { useLoyaltyRules } from '../../../lib/finance';
import { Button, Card, ErrorText, Field, Loading, Muted, Screen, SwitchRow, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

/** Off by default. When on: every N delivered meals the customer gets a discount on their bill, once per milestone. */
export default function Loyalty() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const rules = useLoyaltyRules();
  const refreshAll = useRefreshAll();
  const withStepUp = useStepUp();
  const [active, setActive] = useState(false);
  const [every, setEvery] = useState('30');
  const [reward, setReward] = useState('20');
  const [label, setLabel] = useState('free salad');

  useEffect(() => {
    const r = rules.data;
    if (!r) return;
    setActive(r.active); setEvery(String(r.every_n_meals)); setReward(String(r.reward_paise / 100)); setLabel(r.reward_label);
  }, [rules.data]);

  const save = useAction(async () => {
    const n = Number(every);
    const paise = parseRupeesToPaise(reward);
    if (!Number.isInteger(n) || n < 5 || n > 500) throw new AppError('INVALID_SETTING');
    if (paise === null || paise < 100 || paise > 100000) throw new AppError('INVALID_AMOUNT');
    if (!label.trim()) throw new AppError('INVALID_SETTING');
    await withStepUp(() => rpc('owner_set_loyalty', {
      p_kitchen: kitchenId, p_active: active, p_every_n_meals: n, p_reward_paise: paise, p_reward_label: label.trim(),
    }));
    await refreshAll();
    router.back();
  });

  if (rules.isLoading) return <Loading />;
  const paise = parseRupeesToPaise(reward);
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Loyalty reward') }} />
      <Card>
        <SwitchRow label={tr('Reward regular customers')} value={active} onValueChange={setActive}
          hint={tr('Counted on delivered meals. The reward is taken off the bill automatically and the customer gets a thank-you alert.')} />
        <Field label={tr('Every how many meals (5–500)')} value={every} onChangeText={setEvery} keyboardType="number-pad" maxLength={3} />
        <Field label={tr('Reward value ₹ (taken off the bill)')} value={reward} onChangeText={setReward} keyboardType="decimal-pad"
          hint={paise ? formatRupees(paise) : undefined} />
        <Field label={tr('Called')} value={label} onChangeText={setLabel} maxLength={60} placeholder={tr('free salad')} />
        <Muted>{tr('Example: every 30 meals, ₹20 off, "free salad". Past meals count too, so long-time customers may reach a milestone soon after you switch it on.')}</Muted>
      </Card>
      <Muted>{tr('Saving needs your authenticator code.')}</Muted>
      <ErrorText error={save.error} />
      <Button title={tr('Save')} loading={save.busy} onPress={() => void save.run()} />
    </Screen>
  );
}
