/**
 * Mock for react-native-image-picker (used as a thin shim in tests only;
 * production code uses the PAL which calls native pickers directly).
 */

export const launchImageLibrary = jest.fn().mockResolvedValue({
  didCancel: false,
  assets: [
    {
      uri: 'file://photo1.jpg',
      fileName: 'photo1.jpg',
      type: 'image/jpeg',
      fileSize: 1024 * 1024, // 1 MB
    },
  ],
});

export const launchCamera = jest.fn().mockResolvedValue({
  didCancel: false,
  assets: [
    {
      uri: 'file://camera_photo.jpg',
      fileName: 'camera_photo.jpg',
      type: 'image/jpeg',
      fileSize: 2 * 1024 * 1024, // 2 MB
    },
  ],
});

export default { launchImageLibrary, launchCamera };
