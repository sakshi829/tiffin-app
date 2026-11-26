import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  useColorScheme, useWindowDimensions, type PressableProps, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { addDays, cleanNumericInput, formatDate, formatRupees, isIsoDate, istToday, numericInputProblem, type NumericKind } from '@amruta/shared';
import { toAppError, type AppError } from '../api';
import { cardShadow, radius, space, useColors } from './theme';
import { useT } from '../i18n';

// ------------------------------------------------------------------ layout
/** Widest the content gets on tablets and laptops (Screen column and tab bar line up on it). */
export const CONTENT_MAX_WIDTH = 760;

/**
 * Tab bar options for every app. Wide screens: the tabs sit over the centred content column
 * instead of spreading to the window edges. Phones: no extra side padding per tab, and a
 * smaller label when each tab is narrow, so "Customers" / "My meals" are never cut to "Custom...".
 * (Measured: 13 px "Customers" needs 63 px; a 72 px tab leaves 62 px for the label.)
 */
export function useTabBarLayout(labelSize: number, tabCount: number): {
  tabBarStyle: ViewStyle; tabBarItemStyle: ViewStyle; tabBarLabelStyle: TextStyle;
} {
  const { width } = useWindowDimensions();
  const perTab = Math.min(width, CONTENT_MAX_WIDTH) / tabCount;
  const fontSize = perTab >= 80 ? labelSize : perTab >= 68 ? Math.min(labelSize, 12) : Math.min(labelSize, 11);
  return {
    tabBarStyle: { paddingHorizontal: Math.max(0, (width - CONTENT_MAX_WIDTH) / 2) },
    tabBarItemStyle: { paddingHorizontal: 0 },
    tabBarLabelStyle: { fontSize, fontWeight: '600' },
  };
}

export function Screen({ children, refreshing, onRefresh }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void;
}) {
  const c = useColors();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      // Phones: full width. Tablets and laptops: a centred column, so lines stay readable.
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets   // iPhone: keep the focused field above the keyboard
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  const dark = useColorScheme() === 'dark';
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, boxShadow: cardShadow(dark) }, style]}>{children}</View>;
}

/** Tinted highlight card (today's meal, the balance): same shape as Card, no shadow. */
export function Hero({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.accentSoft, borderColor: 'transparent' }, style]}>{children}</View>;
}

/** Small rounded label on the tinted colour (e.g. "Extras / skip closes in 1 h 59 min"). */
export function InfoPill({ text, icon }: { text: string; icon?: IconName }) {
  const c = useColors();
  return (
    <View style={[styles.pill, { backgroundColor: c.accentSoft }]}>
      {icon ? <Icon name={icon} size={16} color={c.onAccentSoft} /> : null}
      <Text style={{ color: c.onAccentSoft, fontSize: 13, fontWeight: '600', flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ icons
/** One icon: SF Symbols name (iPhone) and Material Symbols name (Android + web). */
export interface IconName { ios: string; android: string; web: string }
export const ICONS = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  meals: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  bill: { ios: 'doc.text.fill', android: 'receipt_long', web: 'receipt_long' },
  bell: { ios: 'bell.fill', android: 'notifications', web: 'notifications' },
  person: { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' },
  clock: { ios: 'clock', android: 'schedule', web: 'schedule' },
  pin: { ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' },
  wallet: { ios: 'indianrupeesign.circle', android: 'account_balance_wallet', web: 'account_balance_wallet' },
} satisfies Record<string, IconName>;

/** Decorative icon (screen readers skip it; the text next to it says the same). */
export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SymbolView name={name as never} size={size} tintColor={color} fallback={<View style={{ width: size, height: size }} />} />
    </View>
  );
}

// ------------------------------------------------------------------ loading placeholders
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** Grey bar that gently pulses while content loads (still when the phone asks for reduced motion). */
export function Skeleton({ width = '100%', height = 14 }: { width?: number | `${number}%`; height?: number }) {
  const c = useColors();
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  return <Animated.View style={{ width, height, borderRadius: radius.sm, backgroundColor: c.chip, opacity: reduce ? 0.8 : pulse }} />;
}

/** A card-shaped placeholder: what a loading list shows instead of a spinner. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  const tr = useT();
  return (
    <Card>
      <View accessible accessibilityLabel={tr('Loading')} style={{ gap: space.sm }}>
        <Skeleton width="45%" height={18} />
        {Array.from({ length: lines }, (_, i) => <Skeleton key={i} width={i === lines - 1 ? '60%' : '90%'} />)}
      </View>
    </Card>
  );
}

export function RowWrap({ children }: { children: ReactNode }) {
  return <View style={styles.rowWrap}>{children}</View>;
}

// ------------------------------------------------------------------ text
export function H1({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={[styles.h1, { color: useColors().text }]}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={[styles.h2, { color: useColors().text }]}>{children}</Text>;
}
export function Body({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return <Text style={[styles.body, { color: useColors().text }, bold && { fontWeight: '600' }]}>{children}</Text>;
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={[styles.muted, { color: useColors().muted }]}>{children}</Text>;
}
export function Money({ paise, bold }: { paise: number; bold?: boolean }) {
  return <Body bold={bold}>{formatRupees(paise)}</Body>;
}

// ------------------------------------------------------------------ status bits
export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'primary' }) {
  const c = useColors();
  const color = { neutral: c.muted, good: c.success, bad: c.danger, warn: c.warning, primary: c.primary }[tone];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function VegDot({ veg }: { veg: boolean }) {
  const tr = useT();
  const c = useColors();
  const color = veg ? c.veg : c.nonVeg;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={veg ? tr('Veg') : tr('Non-veg')} style={[styles.vegBox, { borderColor: color }]}>
      <View style={[styles.vegDot, { backgroundColor: color }]} />
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const tr = useT();
  if (!error) return null;
  const msg = tr((error as AppError).code ? (error as AppError).message : toAppError(error).message);   // errors.ts English is the key
  return <Text accessibilityRole="alert" style={[styles.body, { color: useColors().danger }]}>{msg}</Text>;
}

export function Empty({ text }: { text: string }) {
  return <View style={{ paddingVertical: space.xl, alignItems: 'center' }}><Muted>{text}</Muted></View>;
}

export function Loading() {
  const tr = useT();
  return <View style={{ padding: space.xl }}><ActivityIndicator accessibilityLabel={tr('Loading')} /></View>;
}

// ------------------------------------------------------------------ inputs
/** `label` is what a screen reader says when the visible title is a symbol or emoji ("+", "▶ Play"). */
export function Button({ title, onPress, variant = 'primary', loading, disabled, small, label }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean; disabled?: boolean; small?: boolean; label?: string;
}) {
  const c = useColors();
  const bg = { primary: c.primary, secondary: c.chip, danger: c.danger, ghost: 'transparent' }[variant];
  const fg = { primary: c.onPrimary, secondary: c.text, danger: c.onDanger, ghost: c.primary }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label ?? title} accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress} hitSlop={small ? SMALL_SLOP : undefined}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.88 : 1, transform: [{ scale: pressed && !off ? 0.97 : 1 }] }]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

/** Keypad each kind of number box asks for (phones; `inputMode` does the same in mobile browsers). */
const NUMERIC_KEYS: Record<NumericKind, { keyboardType: TextInputProps['keyboardType']; inputMode: TextInputProps['inputMode'] }> = {
  'money': { keyboardType: 'decimal-pad', inputMode: 'decimal' },
  'signed-money': { keyboardType: 'numbers-and-punctuation', inputMode: 'text' },   // needs the minus key
  'quantity': { keyboardType: 'decimal-pad', inputMode: 'decimal' },
  'integer': { keyboardType: 'number-pad', inputMode: 'numeric' },
  'phone': { keyboardType: 'phone-pad', inputMode: 'tel' },
};

/**
 * Text box with a label. `numeric` makes it a number box: what is typed or pasted is cleaned
 * (letters never get in), and an unfinished / out-of-range value is explained under the box.
 * Screens and the database still check everything on Save.
 */
export function Field({ label, error, hint, numeric, min, max, onChangeText, ...input }: TextInputProps & {
  label: string; error?: string | null; hint?: string; numeric?: NumericKind; min?: number; max?: number;
}) {
  const c = useColors();
  const tr = useT();
  const problem = numeric ? numericInputProblem(numeric, typeof input.value === 'string' ? input.value : '', { min, max }) : null;
  const typingError = problem === 'unfinished'
    ? (numeric === 'quantity' ? tr('Finish the number, e.g. 2 or 0.5') : tr('Finish the amount, e.g. 450 or 450.50'))
    : problem === 'too-large' ? tr('That is too much: the most is ₹1,00,00,000.')
    : problem === 'range'
      ? (min !== undefined && max !== undefined ? tr('Enter a number from {min} to {max}', { min, max })
        : min !== undefined ? tr('Enter {min} or more', { min }) : tr('Enter {max} or less', { max: max ?? '' }))
      : null;
  const shown = error ?? typingError;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...(numeric ? NUMERIC_KEYS[numeric] : null)}
        {...input}
        onChangeText={numeric && onChangeText ? (t) => onChangeText(cleanNumericInput(numeric, t)) : onChangeText}
        accessibilityHint={shown ?? hint}
        style={[styles.input, { color: c.text, borderColor: shown ? c.danger : c.inputBorder, backgroundColor: c.card },
          input.multiline && { minHeight: 80, textAlignVertical: 'top' }]}
      />
      {hint && !shown ? <Muted>{hint}</Muted> : null}
      {shown ? <Text accessibilityLiveRegion="polite" style={{ color: c.danger }}>{shown}</Text> : null}
    </View>
  );
}

export function SwitchRow({ label, value, onValueChange, hint }: {
  label: string; value: boolean; onValueChange: (v: boolean) => void; hint?: string;
}) {
  // The whole row is the control: one big tap target, read out once as "label, switch, on/off".
  // The switch is drawn here (not the platform Switch): on web that is a 40x20 checkbox that
  // stays reachable with Tab even when hidden, so the row would be two controls.
  const c = useColors();
  return (
    <Pressable style={styles.switchRow} onPress={() => onValueChange(!value)}
      role="switch" aria-checked={value} aria-label={label} accessibilityHint={hint}
      // web: Space toggles a switch (react-native-web only presses buttons on Space; Enter already works)
      {...(Platform.OS === 'web' ? ({ onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === ' ') { e.preventDefault(); onValueChange(!value); } } } as unknown as Partial<PressableProps>) : {})}>
      <View style={{ flex: 1 }}><Body>{label}</Body>{hint ? <Muted>{hint}</Muted> : null}</View>
      <View style={[styles.track, value ? { backgroundColor: c.primary, borderColor: c.primary } : { backgroundColor: c.card, borderColor: c.inputBorder }]}>
        <View style={[styles.thumb, { backgroundColor: value ? c.onPrimary : c.inputBorder, alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

export function Chips<T extends string | number>({ options, value, onChange, label }: {
  options: readonly { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; label?: string;
}) {
  const c = useColors();
  const tr = useT();   // option labels are English keys (often module-level lists); names and numbers pass through unchanged
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={[styles.label, { color: c.text }]}>{label}</Text> : null}
      <View style={styles.rowWrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable key={String(o.value)} accessibilityRole="radio" accessibilityState={{ selected: active, checked: active }}
              onPress={() => onChange(o.value)} hitSlop={SMALL_SLOP}
              style={[styles.chip, { backgroundColor: active ? c.chipActive : c.chip }]}>
              <Text style={{ color: active ? c.onChipActive : c.text, fontWeight: '600' }}>{tr(o.label)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function MultiChips<T extends string | number>({ options, values, onChange, label }: {
  options: readonly { value: T; label: string }[]; values: readonly T[]; onChange: (v: T[]) => void; label?: string;
}) {
  const c = useColors();
  const tr = useT();
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={[styles.label, { color: c.text }]}>{label}</Text> : null}
      <View style={styles.rowWrap}>
        {options.map((o) => {
          const active = values.includes(o.value);
          return (
            <Pressable key={String(o.value)} accessibilityRole="checkbox" accessibilityState={{ checked: active }} hitSlop={SMALL_SLOP}
              onPress={() => onChange(active ? values.filter((v) => v !== o.value) : [...values, o.value])}
              style={[styles.chip, { backgroundColor: active ? c.chipActive : c.chip }]}>
              <Text style={{ color: active ? c.onChipActive : c.text, fontWeight: '600' }}>{tr(o.label)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 20, label }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label: string;
}) {
  const tr = useT();
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}><Body>{label}</Body></View>
      <Button small variant="secondary" title="−" label={tr('Less {label}', { label: label })} onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} />
      <Text accessibilityLabel={tr('{label}: {value}', { label: label, value: value })} accessibilityLiveRegion="polite" style={[styles.h2, { minWidth: 32, textAlign: 'center', color: useColors().text }]}>{value}</Text>
      <Button small variant="secondary" title="+" label={tr('More {label}', { label: label })} onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} />
    </View>
  );
}

/** Date as YYYY-MM-DD with quick ±1 day / Today buttons (no native picker dependency). */
export function DateField({ label, value, onChange, allowEmpty }: {
  label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean;
}) {
  const tr = useT();
  const valid = isIsoDate(value);
  const error = value === '' ? (allowEmpty ? null : 'Required') : valid ? null : 'Use YYYY-MM-DD';
  return (
    <View style={{ gap: space.xs }}>
      <Field label={label} value={value} onChangeText={onChange} placeholder={tr('YYYY-MM-DD')} autoCapitalize="none"
        keyboardType="numbers-and-punctuation" error={error} hint={valid ? formatDate(value) : undefined} />
      <RowWrap>
        <Button small variant="secondary" title={tr('− 1 day')} disabled={!valid} onPress={() => onChange(addDays(value, -1))} />
        <Button small variant="secondary" title={tr('Today')} onPress={() => onChange(istToday())} />
        <Button small variant="secondary" title={tr('+ 1 day')} disabled={!valid} onPress={() => onChange(addDays(value, 1))} />
        {allowEmpty && value !== '' ? <Button small variant="ghost" title={tr('Clear')} onPress={() => onChange('')} /> : null}
      </RowWrap>
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress, left }: {
  title: string; subtitle?: string | null; right?: ReactNode; onPress?: () => void; left?: ReactNode;
}) {
  const c = useColors();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress}
      style={({ pressed }) => [styles.listRow, { borderColor: c.border, backgroundColor: pressed && onPress ? c.chip : 'transparent', borderRadius: radius.sm }]}>
      {left}
      <View style={{ flex: 1 }}>
        <Body bold>{title}</Body>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      {right}
    </Pressable>
  );
}

// ------------------------------------------------------------------ actions
/** Run an async action with busy + safe error state. Returns true on success. */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const runAction = useCallback(async (...args: A): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn(...args);
      return true;
    } catch (e) {
      setError(toAppError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [fn]);
  return { run: runAction, busy, error, clearError: () => setError(null) };
}

/** Small buttons and chips are 40 px tall; the slop makes the touch area 48 px (Android's minimum). */
const SMALL_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  h1: { fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  muted: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 15, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, alignSelf: 'flex-start' },
  vegBox: { width: 16, height: 16, borderWidth: 2, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegDot: { width: 7, height: 7, borderRadius: 4 },
  button: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { minHeight: 40, paddingHorizontal: space.md },
  buttonText: { fontSize: 16, fontWeight: '700' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },
  track: { width: 52, height: 32, borderRadius: 16, borderWidth: 2, padding: 2, justifyContent: 'center' },
  thumb: { width: 24, height: 24, borderRadius: 12 },
  chip: { minHeight: 40, paddingHorizontal: space.md, borderRadius: 999, justifyContent: 'center' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
});
