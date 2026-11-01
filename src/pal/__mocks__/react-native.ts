/**
 * Minimal React Native mock for Jest (headless, no native bridge).
 */

export const Platform = {
  OS: 'ios' as 'ios' | 'android',
  Version: 33 as number | string,
  select: <T>(obj: { ios?: T; android?: T; default?: T }): T | undefined =>
    obj[Platform.OS as 'ios' | 'android'] ?? obj.default,
};

export const Linking = {
  openSettings: jest.fn().mockResolvedValue(undefined),
  openURL: jest.fn().mockResolvedValue(undefined),
};

export const Alert = {
  alert: jest.fn(),
};

export const PermissionsAndroid = {
  PERMISSIONS: {
    READ_MEDIA_IMAGES: 'android.permission.READ_MEDIA_IMAGES',
    READ_EXTERNAL_STORAGE: 'android.permission.READ_EXTERNAL_STORAGE',
    CAMERA: 'android.permission.CAMERA',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
  request: jest.fn().mockResolvedValue('granted'),
  check: jest.fn().mockResolvedValue('granted'),
};

export default {
  Platform,
  Linking,
  Alert,
  PermissionsAndroid,
};
