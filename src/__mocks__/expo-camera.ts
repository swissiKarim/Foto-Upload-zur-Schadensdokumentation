/**
 * Mock for expo-camera (used in tests that reference it)
 */

export const Camera = {
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
};

export const CameraType = {
  back: 'back',
  front: 'front',
};

export default Camera;
