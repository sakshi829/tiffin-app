import { Body, Card, H1, Muted, Screen } from '../ui/kit';
import { useT } from '@amruta/app-core';

export default function SetupNeeded() {
  const tr = useT();
  return (
    <Screen>
      <H1>{tr('Almost ready')}</H1>
      <Card>
        <Body>{tr('This app is not connected to your Supabase project yet.')}</Body>
        <Muted>{tr('On your personal laptop, create apps/owner/.env.local with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see docs/SETUP_PERSONAL_LAPTOP.md), then restart the app.')}</Muted>
      </Card>
    </Screen>
  );
}
