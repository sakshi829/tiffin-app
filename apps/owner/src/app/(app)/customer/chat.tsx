import { useEffect } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { ChatView, uploadFile, useLiveThread, VOICE_EXT, VOICE_TYPE, useT } from '@amruta/app-core';
import { rpc } from '../../../lib/api';
import { useOwner } from '../../../lib/auth';
import { useChat, useCustomer, useRefreshAll } from '../../../lib/queries';

export default function OwnerChat() {
  const tr = useT();
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { kitchenId } = useOwner();
  const customer = useCustomer(customerId);
  const chat = useChat(customerId);
  useLiveThread(customerId, () => void chat.refetch());   // new messages appear at once
  const refreshAll = useRefreshAll();
  const unread = (chat.data ?? []).some((m) => m.sender_role === 'customer' && !m.read_at);

  useEffect(() => {
    if (unread) void rpc('chat_mark_read', { p_customer: customerId }).then(() => refreshAll());
  }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Stack.Screen options={{ title: customer.data?.full_name ?? tr('Chat') }} />
      <ChatView messages={chat.data ?? []} mySide="owner" loading={chat.isLoading} error={chat.error}
        onSend={async (text) => { await rpc('owner_send_message', { p_customer: customerId, p_body: text }); await refreshAll(); }}
        onSendVoice={async (uri, seconds) => {
          const path = `${kitchenId}/${customerId}/${Crypto.randomUUID()}.${VOICE_EXT}`;
          await uploadFile('voice-notes', path, uri, VOICE_TYPE);
          await rpc('owner_send_voice', { p_customer: customerId, p_path: path, p_seconds: seconds });
          await refreshAll();
        }} />
    </>
  );
}
