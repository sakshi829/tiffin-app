import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Save a CSV (built by toCsv in @amruta/shared, which neutralises spreadsheet
 * formulas) and open the share sheet (WhatsApp, Drive, email...). Web: download.
 * The file goes to the app's cache folder only; nothing is written elsewhere.
 */
export async function shareCsv(csv: string, fileName: string): Promise<void> {
  const name = `${fileName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'export'}.csv`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = globalThis.document?.createElement('a');
    if (!a) return;
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: name });
  }
}
