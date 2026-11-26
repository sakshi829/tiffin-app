import { useAuth } from '../lib/auth';
import { Body, Button, Card, H1, Muted, Screen } from '../ui/kit';
import { useT } from '@amruta/app-core';

export default function NotOwner() {
  const tr = useT();
  const { state, signOut } = useAuth();
  return (
    <Screen>
      <H1>{tr('This is the owner app')}</H1>
      <Card>
        <Body>{state.status === 'not-owner' ? tr('{email} is not an owner of a kitchen.', { email: state.email }) : tr('This account is not an owner of a kitchen.')}</Body>
        <Muted>{tr('Customers and staff use their own apps. If you are the owner, make sure the kitchen was set up for this email.')}</Muted>
        <Button title={tr('Sign out')} onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}
