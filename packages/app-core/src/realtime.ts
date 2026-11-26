import { useEffect, useRef } from 'react';
import { getSupabase } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Live chat (F29): when a message in this customer's thread is added or marked
 * read, `onChange` runs (the screen refetches). Supabase Realtime applies the same
 * row-level security as normal reads, so nobody receives another person's thread.
 * The screens keep their 15-second refresh as a fallback.
 */
export function useLiveThread(customerId: string | null | undefined, onChange: () => void): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!customerId || !UUID.test(customerId)) return;
    const db = getSupabase();
    const channel = db
      .channel(`chat-${customerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `customer_id=eq.${customerId}` },
        () => latest.current())
      .subscribe();
    return () => { void db.removeChannel(channel); };
  }, [customerId]);
}
