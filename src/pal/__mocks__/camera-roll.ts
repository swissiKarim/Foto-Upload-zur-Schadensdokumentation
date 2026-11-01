/**
 * Mock for @react-native-camera-roll/camera-roll
 */

export const CameraRoll = {
  getPhotos: jest.fn().mockResolvedValue({ edges: [], page_info: { has_next_page: false } }),
  save: jest.fn().mockResolvedValue('file://saved/photo.jpg'),
};

export default CameraRoll;
