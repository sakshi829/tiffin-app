import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { AppError, toAppError } from './api';
import { useSignedUrl } from './media';
import { Button, ErrorText, Muted, RowWrap } from './ui/kit';
import { useT } from './i18n';

/**
 * 30 s max (decision 12). Mono 64 kbps AAC -> about 240 KB per 30 s on phones (.m4a).
 * Browsers: WebM where supported (Chrome, Firefox); Safari (iPhone/Mac) can only
 * record MP4/AAC, so it is saved as .m4a, which also plays everywhere.
 */
export const VOICE_MAX_SECONDS = 30;
const WEB_MP4 = Platform.OS === 'web' && typeof MediaRecorder !== 'undefined'
  && !MediaRecorder.isTypeSupported('audio/webm') && MediaRecorder.isTypeSupported('audio/mp4');
const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000,
  web: { ...RecordingPresets.HIGH_QUALITY.web, mimeType: WEB_MP4 ? 'audio/mp4' : 'audio/webm' },
};
export const VOICE_EXT = Platform.OS !== 'web' || WEB_MP4 ? 'm4a' : 'webm';
export const VOICE_TYPE = Platform.OS !== 'web' || WEB_MP4 ? 'audio/mp4' : 'audio/webm';

/** Tap to record, tap to stop (auto-stops at 30 s). Calls onRecorded(localUri, seconds). */
export function VoiceRecorder({ onRecorded, disabled }: { onRecorded: (uri: string, seconds: number) => Promise<void>; disabled?: boolean }) {
  const tr = useT();
  const recorder = useAudioRecorder(OPTIONS);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = async () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    setBusy(true);
    try {
      await recorder.stop();
      const seconds = Math.max(1, Math.min(VOICE_MAX_SECONDS, Math.round((Date.now() - startedAt.current) / 1000)));
      if (!recorder.uri) throw new AppError('UNKNOWN');
      await onRecorded(recorder.uri, seconds);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setError(null);
    try {
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) throw new AppError('NOT_ALLOWED');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timer.current = setInterval(() => {
        const s = Math.round((Date.now() - startedAt.current) / 1000);
        setElapsed(s);
        if (s >= VOICE_MAX_SECONDS) void stop();
      }, 500);
    } catch (e) {
      setError(toAppError(e));
    }
  };

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  return (
    <>
      <RowWrap>
        {recording
          ? <Button small variant="danger" title={tr('Stop & send ({elapsed} s)', { elapsed: elapsed })} onPress={() => void stop()} />
          : <Button small variant="secondary" title={tr('🎤 Voice note')} label={tr('Record a voice note')} loading={busy} disabled={disabled} onPress={() => void start()} />}
      </RowWrap>
      {recording ? <Muted>{tr('Recording… up to {VOICE_MAX_SECONDS} seconds.', { VOICE_MAX_SECONDS: VOICE_MAX_SECONDS })}</Muted> : null}
      <ErrorText error={error} />
    </>
  );
}

/** Plays a private voice note (signed link, 5 min). */
export function VoicePlayer({ path, seconds }: { path: string; seconds: number | null }) {
  const tr = useT();
  const url = useSignedUrl('voice-notes', path);
  const player = useAudioPlayer(url.data ?? null);
  const [playing, setPlaying] = useState(false);
  if (url.error) return <Muted>{tr('Voice note no longer available.')}</Muted>;
  return (
    <Button small variant="ghost" title={playing ? tr('⏸ Pause') : seconds ? tr('▶ Play ({seconds} s)', { seconds }) : tr('▶ Play')}
      label={playing ? tr('Pause voice note') : seconds ? tr('Play voice note, {seconds} seconds', { seconds }) : tr('Play voice note')} disabled={!url.data}
      onPress={() => {
        if (playing) { player.pause(); setPlaying(false); }
        else { player.seekTo(0); player.play(); setPlaying(true); setTimeout(() => setPlaying(false), (seconds ?? 30) * 1000); }
      }} />
  );
}
