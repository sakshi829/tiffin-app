import { useState } from 'react';
import { Share, View } from 'react-native';
import { Stack } from 'expo-router';
import { istClock, type StaffMember, type StaffRole } from '@amruta/shared';
import { AppError, rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useStepUp } from '../../../lib/stepup';
import { useOpenShifts, useRefreshAll, useStaff } from '../../../lib/queries';
import { Badge, Body, Button, Card, Chips, ErrorText, Field, H2, ListRow, Loading, Muted, Screen, SwitchRow, useAction } from '../../../ui/kit';
import { useT } from '@amruta/app-core';

type WorkRole = Exclude<StaffRole, 'owner'>;
const ROLES = [
  { value: 'kitchen', label: 'Kitchen' }, { value: 'delivery', label: 'Delivery' }, { value: 'kitchen_delivery', label: 'Both' },
] as const;

export default function StaffScreen() {
  const tr = useT();
  const { kitchenId } = useOwner();
  const staff = useStaff();
  const withStepUp = useStepUp();
  const [name, setName] = useState('');
  const [role, setRole] = useState<WorkRole>('delivery');
  const [code, setCode] = useState<string | null>(null);

  const invite = useAction(async () => {
    if (!name.trim()) throw new AppError('NAME_REQUIRED');
    setCode(await withStepUp(() => rpc<string>('owner_create_staff_invite', {
      p_kitchen: kitchenId, p_role: role, p_display_name: name.trim(), p_valid_days: 3,
    })));
  });

  if (staff.isLoading) return <Loading />;
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Staff') }} />
      <Muted>{tr('Staff use the separate AK Staff app. They never see prices, payments or your reports.')}</Muted>
      {(staff.data ?? []).filter((s) => s.role !== 'owner').map((s) => <StaffRow key={s.id} member={s} />)}
      <Card>
        <H2>{tr('Invite a staff member')}</H2>
        <Field label={tr('Name')} value={name} onChangeText={setName} maxLength={100} />
        <Chips value={role} onChange={setRole} options={ROLES} />
        <ErrorText error={invite.error} />
        <Button title={tr('Create staff invite')} loading={invite.busy} onPress={() => void invite.run()} />
        {code ? (
          <>
            <Body bold>{tr('Code: {code}', { code: code })}</Body>
            <Muted>{tr('Works once, for 3 days. Shown only now.')}</Muted>
            <Button small variant="secondary" title={tr('Share')} onPress={() => void Share.share({ message: tr('Amruta\'s Kitchen staff app code: {code}', { code }) })} />
          </>
        ) : null}
      </Card>
    </Screen>
  );
}

function StaffRow({ member }: { member: StaffMember }) {
  const tr = useT();
  const refreshAll = useRefreshAll();
  const shifts = useOpenShifts();
  const onShift = shifts.data?.find((s) => s.staff_id === member.id);
  const withStepUp = useStepUp();
  const update = useAction(async (patch: Partial<Pick<StaffMember, 'role' | 'can_see_phone' | 'active'>>) => {
    const next = { role: member.role, can_see_phone: member.can_see_phone, active: member.active, ...patch };
    await withStepUp(() => rpc('owner_set_staff', {
      p_staff: member.id, p_role: next.role, p_can_see_phone: next.can_see_phone, p_active: next.active,
    }));
    await refreshAll();
  });
  return (
    <Card>
      <ListRow title={member.display_name}
        subtitle={[member.phone, onShift ? `On shift since ${istClock(onShift.started_at)}` : 'Not on shift'].filter(Boolean).join(' · ')}
        right={<Badge text={member.active ? tr('Active') : tr('Removed')} tone={member.active ? 'good' : 'bad'} />} />
      <View style={{ gap: 8, opacity: update.busy ? 0.6 : 1 }}>
        <Chips value={member.role as WorkRole} onChange={(r) => void update.run({ role: r })} options={ROLES} />
        <SwitchRow label={tr('Can see customer phone numbers')} value={member.can_see_phone}
          onValueChange={(v) => void update.run({ can_see_phone: v })} hint={tr('Only for today\'s deliveries assigned to them.')} />
        <SwitchRow label={tr('Active')} value={member.active} onValueChange={(v) => void update.run({ active: v })}
          hint={tr('Turning off removes their access immediately and unassigns their upcoming deliveries.')} />
      </View>
      <ErrorText error={update.error} />
    </Card>
  );
}
