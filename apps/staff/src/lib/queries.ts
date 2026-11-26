import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc, run } from '@amruta/app-core';
import { cols, type BoxOut, type StaffShift, type StaffTask } from '@amruta/shared';
import { getSupabase } from './supabase';
import { useStaffMe } from './auth';

const db = () => getSupabase();

export function useRefreshAll() {
  const qc = useQueryClient();
  const { kitchenId } = useStaffMe();
  return () => qc.invalidateQueries({ queryKey: ['staff', kitchenId] });
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useTasks(date: string, slot: string | null) {
  const { kitchenId } = useStaffMe();
  return useQuery({
    queryKey: ['staff', kitchenId, 'tasks', date, slot],
    queryFn: () => rpc<StaffTask[]>('staff_my_tasks', { p_kitchen: kitchenId, p_date: date, p_meal_slot: slot }),
    refetchInterval: 60_000,   // pick up location changes and skips while working
  });
}

export function useBoxPickups(enabled: boolean) {
  const { kitchenId } = useStaffMe();
  return useQuery({
    queryKey: ['staff', kitchenId, 'pickups'],
    enabled,
    queryFn: () => rpc<BoxOut[]>('staff_box_pickups', { p_kitchen: kitchenId }),
  });
}

export function useOpenShift() {
  const { kitchenId, staff } = useStaffMe();
  return useQuery({
    queryKey: ['staff', kitchenId, 'shift'],
    queryFn: async () => (await run<StaffShift[]>(db().from('staff_shifts').select(cols('staff_shifts'))
      .eq('staff_id', staff.id).is('ended_at', null).limit(1)))[0] ?? null,
  });
}

/** Packing instructions by tiffin type NAME (staff tasks carry the name; names are unique per kitchen). */
export function usePackingInstructions() {
  const { kitchenId } = useStaffMe();
  return useQuery({
    queryKey: ['staff', kitchenId, 'packing_instructions'],
    queryFn: async () => {
      const [types, instr] = await Promise.all([
        run<{ id: string; name: string }[]>(db().from('tiffin_types').select('id,name').eq('kitchen_id', kitchenId)),
        run<{ tiffin_type_id: string; instructions: string; photo_path: string | null }[]>(db().from('packing_instructions').select(cols('packing_instructions')).eq('kitchen_id', kitchenId)),
      ]);
      const byId = new Map(instr.map((i) => [i.tiffin_type_id, { text: i.instructions, photo: i.photo_path }]));
      return new Map(types.filter((t) => byId.has(t.id)).map((t) => [t.name, byId.get(t.id)!]));
    },
  });
}
