import { useAuth } from '../lib/auth';
import { Body, Button, Card, H1, Muted, Screen, useAction } from '../ui/kit';
import { useT } from '@amruta/app-core';

/** Shown when the server can't be reached at start-up but a sign-in is saved. */
export default function Offline() {
  const tr = useT();
  const { refresh, signOut } = useAuth();
  const retry = useAction(refresh);
  return (
    <Screen>
      <H1>{tr('Can\'t connect')}</H1>
      <Card>
        <Body>{tr('Check your internet connection and try again.')}</Body>
        <Button title={tr('Try again')} onPress={() => void retry.run()} loading={retry.busy} />
        <Muted>{tr('You are still signed in; no new code is needed.')}</Muted>
      </Card>
      <Button title={tr('Sign out')} variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
