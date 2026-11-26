import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/**
 * Phones: turn HTML into a PDF file and open the share sheet (WhatsApp, Drive...).
 * Web: open the document in a new tab and show the browser's print dialog
 * ("Save as PDF"), because expo-print on web prints the current page.
 * The HTML must come from packages/shared/src/html.ts (values are escaped there).
 */
export async function shareHtmlAsPdf(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    const w = globalThis.open?.('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: '.pdf', dialogTitle: title });
  } else {
    await Print.printAsync({ uri });
  }
}
