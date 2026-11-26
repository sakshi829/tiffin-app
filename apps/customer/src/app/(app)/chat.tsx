import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { ChatView, rpc, uploadFile, useLiveThread, VOICE_EXT, VOICE_TYPE, useT } from '@amruta/app-core';
import { useMe } from '../../lib/auth';
import { useMyChat, useRefreshAll } from '../../lib/queries';

export default function Chat() {
  const tr = useT();
  const { customer, kitchenId } = useMe();
  const chat = useMyChat();
  useLiveThread(customer.id, () => void chat.refetch());   // new messages appear at once
  const refreshAll = useRefreshAll();
  const unread = (chat.data ?? []).some((m) => m.sender_role === 'owner' && !m.read_at);
  useEffect(() => {
    if (unread) void rpc('chat_mark_read', { p_customer: customer.id }).then(() => refreshAll());
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Stack.Screen options={{ title: tr('Message the kitchen') }} />
      <ChatView messages={chat.data ?? []} mySide="customer" loading={chat.isLoading} error={chat.error}
        intro={tr('For changes to today\'s meal use the meal screen; it\'s faster. Messages are for anything else. Voice notes are kept 30 days.')}
        onSend={async (text) => { await rpc('customer_send_message', { p_kitchen: kitchenId, p_body: text }); await refreshAll(); }}
        onSendVoice={async (uri, seconds) => {
          const path = `${kitchenId}/${customer.id}/${Crypto.randomUUID()}.${VOICE_EXT}`;
          await uploadFile('voice-notes', path, uri, VOICE_TYPE);
          await rpc('customer_send_voice', { p_kitchen: kitchenId, p_path: path, p_seconds: seconds });
          await refreshAll();
        }} />
    </>
  );
}
