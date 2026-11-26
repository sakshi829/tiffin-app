import { useState } from 'react';
import { Text, View } from 'react-native';
import { formatDate, istClock, istToday, type ChatMessage } from '@amruta/shared';
import { Button, Empty, ErrorText, Field, Loading, Muted, Screen, useAction } from './ui/kit';
import { space, useColors } from './ui/theme';
import { VoicePlayer, VoiceRecorder } from './voice';
import { useT } from './i18n';

/** Simple chat: my messages on the right, theirs on the left; newest at the bottom. */
export function ChatView({ messages, mySide, onSend, onSendVoice, loading, error, intro }: {
  messages: readonly ChatMessage[];
  mySide: 'customer' | 'owner';
  onSend: (text: string) => Promise<void>;
  /** Upload + send a recorded voice note (local uri, seconds). Omit to hide the microphone. */
  onSendVoice?: (uri: string, seconds: number) => Promise<void>;
  loading?: boolean;
  error?: unknown;
  intro?: string;
}) {
  const tr = useT();
  const c = useColors();
  const [text, setText] = useState('');
  const send = useAction(async () => { await onSend(text.trim()); setText(''); });
  const today = istToday();
  return (
    <Screen>
      {intro ? <Muted>{intro}</Muted> : null}
      {loading ? <Loading /> : null}
      <ErrorText error={error} />
      {!loading && messages.length === 0 ? <Empty text={tr('No messages yet.')} /> : null}
      {messages.map((m) => {
        const mine = m.sender_role === mySide;
        const d = new Date(Date.parse(m.created_at) + 330 * 60_000).toISOString().slice(0, 10);
        return (
          <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
            <View style={{ maxWidth: '85%', backgroundColor: mine ? c.primary : c.chip, borderRadius: 12, padding: space.md }}>
              <Text style={{ color: mine ? c.onPrimary : c.text, fontSize: 16 }}>{m.body}</Text>
            </View>
            {m.voice_path ? <VoicePlayer path={m.voice_path} seconds={m.voice_seconds} /> : null}
            <Muted>{d === today ? '' : `${formatDate(d)} · `}{istClock(m.created_at)}{mine && m.read_at ? ` · ${tr('Seen')}` : ''}</Muted>
          </View>
        );
      })}
      <Field label={tr('Message')} value={text} onChangeText={setText} maxLength={1000} multiline />
      <ErrorText error={send.error} />
      <Button title={tr('Send')} onPress={() => void send.run()} loading={send.busy} disabled={!text.trim()} />
      {onSendVoice ? <VoiceRecorder onRecorded={onSendVoice} /> : null}
    </Screen>
  );
}
