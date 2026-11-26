import { useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Body, Button, Card, Field, Muted, space, useColors, useT } from '@amruta/app-core';

const BOX_CODE = /^AK-\d{3,6}$/;

/**
 * Opens the camera to read a box sticker (AK-001...). Only accepts our own code
 * format; anything else is ignored. Typing the code is always possible too.
 */
export function ScanBox({ visible, onClose, onCode, title }: {
  visible: boolean; onClose: () => void; onCode: (code: string) => void; title: string;
}) {
  const tr = useT();
  const c = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const handled = useRef(false);

  const accept = (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!BOX_CODE.test(code) || handled.current) return;
    handled.current = true;
    onCode(code);
    setTimeout(() => { handled.current = false; }, 1500);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, gap: space.md, paddingTop: 48 }}>
        <Body bold>{title}</Body>
        {permission?.granted ? (
          <View style={{ height: 320, borderRadius: 12, overflow: 'hidden' }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(r) => accept(r.data)} />
          </View>
        ) : (
          <Card>
            <Muted>{tr('The camera is used only to read box stickers.')}</Muted>
            <Button title={tr('Allow camera')} onPress={() => void requestPermission()} />
          </Card>
        )}
        <Field label={tr('Or type the code')} value={typed} onChangeText={setTyped} autoCapitalize="characters" placeholder={tr('AK-017')} maxLength={10} />
        <Button title={tr('Use this code')} disabled={!BOX_CODE.test(typed.trim().toUpperCase())} onPress={() => accept(typed)} />
        <Button title={tr('Close')} variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}
