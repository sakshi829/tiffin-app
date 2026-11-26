import { Body, Card, H1, Muted, Screen, useT } from '@amruta/app-core';

export default function SetupNeeded() {
  const tr = useT();
  return (
    <Screen>
      <H1>{tr('Almost ready')}</H1>
      <Card>
        <Body>{tr('This app is not connected to the kitchen\'s server yet.')}</Body>
        <Muted>{tr('Create apps/staff/.env.local with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see docs/SETUP_PERSONAL_LAPTOP.md).')}</Muted>
      </Card>
    </Screen>
  );
}
