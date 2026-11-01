/**
 * CameraPermissionDeniedView
 *
 * Shown when the user has denied or permanently blocked camera access.
 * Displays a clear explanation and a deep-link to device settings.
 *
 * Acceptance criterion:
 *   "Wird die Berechtigung verweigert, erscheint ein verständlicher
 *    Hinweistext mit Link zu den Geräteeinstellungen."
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  StyleSheet,
  Platform,
} from 'react-native';
import { PermissionResult } from '../pal/camera/CameraTypes';

interface Props {
  permissionResult: PermissionResult;
  onRetry?: () => void;
}

function openSettings(settingsUrl?: string): void {
  const url =
    settingsUrl ??
    (Platform.OS === 'ios' ? 'app-settings:' : 'android.settings.APPLICATION_DETAILS_SETTINGS');
  Linking.openURL(url).catch(() => {
    console.warn('Could not open device settings');
  });
}

const CameraPermissionDeniedView: React.FC<Props> = ({ permissionResult, onRetry }) => {
  const message =
    permissionResult.denialMessage ??
    'Die Kamera-Berechtigung wurde verweigert. Bitte erlaube den Kamerazugriff in den Einstellungen.';

  return (
    <View style={styles.container} testID="camera-permission-denied-view">
      <Text style={styles.icon}>📷</Text>
      <Text style={styles.title}>Kamerazugriff benötigt</Text>
      <Text style={styles.message} testID="permission-denied-message">
        {message}
      </Text>

      {(permissionResult.status === 'blocked' || permissionResult.status === 'denied') && (
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => openSettings(permissionResult.settingsUrl)}
          testID="open-settings-button"
          accessibilityRole="link"
          accessibilityLabel="Zu den Einstellungen wechseln"
        >
          <Text style={styles.settingsButtonText}>Zu den Einstellungen</Text>
        </TouchableOpacity>
      )}

      {onRetry && permissionResult.status === 'denied' && (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRetry}
          testID="retry-permission-button"
          accessibilityRole="button"
          accessibilityLabel="Berechtigung erneut anfragen"
        >
          <Text style={styles.retryButtonText}>Erneut anfragen</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  icon: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  settingsButton: {
    backgroundColor: '#0056b3',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8,
    marginBottom: 12,
  },
  settingsButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  retryButtonText: {
    color: '#0056b3',
    fontSize: 15,
  },
});

export default CameraPermissionDeniedView;
