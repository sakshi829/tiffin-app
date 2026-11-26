/** Display-only helpers. The DATABASE remains the authority for cutoffs. */
import { formatTime } from './dates.ts';
import { translate } from './i18n.ts';
import type { LocationNode, MealSlotRow, Place } from './types.ts';

export interface SlotOverrideLike {
  delivery_time: string | null; addon_cutoff_time: string | null; location_cutoff_time: string | null;
}

function toMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}
function fromMinutes(total: number): string {
  const t = Math.max(0, total);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * Same rule as app.slot_times(): override > fixed time > (delivery - minutes),
 * never later than delivery. Returns 24h "HH:MM" strings.
 */
export function slotTimes(slot: MealSlotRow, override?: SlotOverrideLike | null) {
  const delivery = toMinutes(override?.delivery_time ?? slot.delivery_time);
  const pick = (ov: string | null | undefined, mode: 'relative' | 'fixed', fixed: string | null, minutes: number) =>
    Math.min(delivery, ov ? toMinutes(ov) : mode === 'fixed' && fixed ? toMinutes(fixed) : delivery - minutes);
  return {
    delivery: fromMinutes(delivery),
    addonCutoff: fromMinutes(pick(override?.addon_cutoff_time, slot.addon_cutoff_mode, slot.addon_cutoff_time, slot.addon_cutoff_minutes)),
    locationCutoff: fromMinutes(pick(override?.location_cutoff_time, slot.location_cutoff_mode, slot.location_cutoff_time, slot.location_cutoff_minutes)),
  };
}

export function describeSlotTimes(slot: MealSlotRow, override?: SlotOverrideLike | null): string {
  const t = slotTimes(slot, override);
  return translate('Delivery {delivery} · extras/skip until {addon} · location until {location}',
    { delivery: formatTime(t.delivery), addon: formatTime(t.addonCutoff), location: formatTime(t.locationCutoff) });
}

/** "City Hospital > Ward 5" for a location node, from loaded place/node lists (null if unknown). */
export function nodePath(
  nodeId: string | null | undefined,
  data: { places: readonly Place[]; nodes: readonly LocationNode[] } | undefined,
): string | null {
  if (!nodeId || !data) return null;
  const parts: string[] = [];
  let cur = data.nodes.find((n) => n.id === nodeId);
  const placeId = cur?.place_id;
  for (let guard = 0; cur && guard < 10; guard++) {
    parts.unshift(cur.name);
    const parentId: string | null = cur.parent_id;
    cur = parentId ? data.nodes.find((n) => n.id === parentId) : undefined;
  }
  const place = data.places.find((p) => p.id === placeId);
  if (place) parts.unshift(place.name);
  return parts.length ? parts.join(' > ') : null;
}

/** Indian mobile -> digits with country code (91XXXXXXXXXX), or null if it doesn't look like a phone. */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export function telLink(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  return d ? `tel:+${d}` : null;
}

/** Click-to-chat link (opens WhatsApp with the text ready; you press send). */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const d = phoneDigits(phone);
  if (!d) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
