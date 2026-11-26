import { Body, Card, H1, Muted, Screen } from '@amruta/app-core';

export default function SetupNeeded() {
  return (
    <Screen>
      <H1>Almost ready</H1>
      <Card>
        <Body>This app is not connected to the kitchen's server yet.</Body>
        <Muted>Create apps/customer/.env.local with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see docs/SETUP_PERSONAL_LAPTOP.md).</Muted>
      </Card>
    </Screen>
  );
}
