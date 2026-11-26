import { Body, Button, Card, H1, Muted, Screen, useT } from '@amruta/app-core';
import { useAuth } from '../lib/auth';

export default function NoAccess() {
  const tr = useT();
  const { state, signOut } = useAuth();
  const owner = state.status === 'no-access' && state.reason === 'owner';
  return (
    <Screen>
      <H1>{owner ? tr('This is the owner account') : tr('Access removed')}</H1>
      <Card>
        <Body>{owner ? tr('Please use the AK Owner app.') : tr('The kitchen has turned off your staff access.')}</Body>
        {!owner ? <Muted>{tr('If this is a mistake, ask the owner to turn it back on.')}</Muted> : null}
        <Button title={tr('Sign out')} onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}
