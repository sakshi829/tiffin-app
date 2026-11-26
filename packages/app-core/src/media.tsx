import { Image, Platform, type ImageStyle } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { errorCode } from '@amruta/shared';
import { getSupabase } from './supabase';
import { AppError } from './api';
import { Loading, Muted } from './ui/kit';
import { useT } from './i18n';

/**
 * Private files (Supabase Storage). Rules are enforced by storage policies
 * (supabase/migrations/...1700): nobody can read another person's photo or
 * voice note, and nothing can be overwritten.
 */
export type Bucket = 'kitchen-media' | 'delivery-proofs' | 'payment-proofs' | 'voice-notes' | 'receipts';

/** Same limits as the buckets (setup guide step 13). */
export const MAX_BYTES: Record<Bucket, number> = {
  'kitchen-media': 2 * 1024 * 1024,
  'delivery-proofs': 2 * 1024 * 1024,
  'payment-proofs': 2 * 1024 * 1024,
  'voice-notes': 1024 * 1024,
  receipts: 2 * 1024 * 1024,
};

/** Take or choose a photo. Returns a local uri, or null if the person cancelled. */
export async function pickPhoto(source: 'camera' | 'library'): Promise<string | null> {
  if (source === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new AppError('NOT_ALLOWED');
  } else if (Platform.OS !== 'web') {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) throw new AppError('NOT_ALLOWED');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  return result.assets[0]?.uri ?? null;
}

/** Shrink to 1280 px wide JPEG at 60% quality (typically 150-300 KB). Also drops photo location data. */
export async function compressPhoto(uri: string): Promise<string> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 1280 }).renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG });
  return saved.uri;
}

async function readBytes(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') return (await fetch(uri)).arrayBuffer();
  return new File(uri).arrayBuffer();
}

/** Upload a local file. Never overwrites (upsert: false). */
export async function uploadFile(bucket: Bucket, path: string, uri: string, contentType: string): Promise<void> {
  const bytes = await readBytes(uri);
  if (bytes.byteLength > MAX_BYTES[bucket]) throw new AppError('FILE_TOO_LARGE');
  const { error } = await getSupabase().storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new AppError(errorCode(error), error);
}

/** Pick, shrink and upload a photo in one step. Returns the path, or null if cancelled. */
export async function pickAndUploadPhoto(source: 'camera' | 'library', bucket: Bucket, path: string): Promise<string | null> {
  const picked = await pickPhoto(source);
  if (!picked) return null;
  const small = await compressPhoto(picked);
  await uploadFile(bucket, path, small, 'image/jpeg');
  return path;
}

/** Short-lived private link (5 min) for showing a file. */
export async function signedUrl(bucket: Bucket, path: string, seconds = 300): Promise<string> {
  const { data, error } = await getSupabase().storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new AppError(errorCode(error), error);
  return data.signedUrl;
}

export function useSignedUrl(bucket: Bucket, path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-url', bucket, path],
    enabled: !!path,
    staleTime: 4 * 60 * 1000,
    queryFn: () => signedUrl(bucket, path!),
  });
}

/** Shows a private image, or a gentle note if it has expired (deleted after the retention period). */
/** `alt` is read by screen readers; say what the photo shows ("Delivery photo", "Receipt"). */
export function PrivateImage({ bucket, path, style, alt = 'Photo' }: {
  bucket: Bucket; path: string | null | undefined; style?: ImageStyle; alt?: string;
}) {
  const tr = useT();
  const url = useSignedUrl(bucket, path);
  if (!path) return null;
  if (url.isLoading) return <Loading />;
  if (url.error || !url.data) return <Muted>{tr('Photo no longer available.')}</Muted>;
  return <Image accessibilityLabel={alt} source={{ uri: url.data }} resizeMode="contain"
    style={[{ width: '100%', height: 240, borderRadius: 8 }, style]} />;
}
