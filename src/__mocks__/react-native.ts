/**
 * Mock for react-native – used by Jest (node environment).
 * We expose Platform.OS as a mutable property so tests can override it.
 */

const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select: (obj: Record<string, unknown>) => obj[Platform.OS] ?? obj.default,
};

const PermissionsAndroid = {
  PERMISSIONS: {
    CAMERA: 'android.permission.CAMERA',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
  request: jest.fn().mockResolvedValue('granted'),
};

const Linking = {
  openURL: jest.fn().mockResolvedValue(undefined),
  openSettings: jest.fn().mockResolvedValue(undefined),
};

const StyleSheet = {
  create: <T extends Record<string, object>>(styles: T): T => styles,
};

// Minimal React Native component stubs
const View = 'View';
const Text = 'Text';
const TouchableOpacity = 'TouchableOpacity';

export {
  Platform,
  PermissionsAndroid,
  Linking,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
};
