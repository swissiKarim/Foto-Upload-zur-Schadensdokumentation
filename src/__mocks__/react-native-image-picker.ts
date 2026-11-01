/**
 * Mock for react-native-image-picker
 */

export type MediaType = 'photo' | 'video' | 'mixed';

export interface CameraOptions {
  mediaType: MediaType;
  saveToPhotos?: boolean;
  includeBase64?: boolean;
  quality?: number;
}

export interface Asset {
  uri: string;
  fileName: string;
  fileSize: number;
  type: string;
}

export interface ImagePickerResponse {
  didCancel?: boolean;
  errorCode?: string;
  errorMessage?: string;
  assets?: Asset[];
}

export const launchCamera = jest.fn(
  (_options: CameraOptions, callback: (response: ImagePickerResponse) => void) => {
    callback({
      assets: [
        {
          uri: 'file:///tmp/test_capture.jpg',
          fileName: 'test_capture.jpg',
          fileSize: 1024 * 1024, // 1 MB
          type: 'image/jpeg',
        },
      ],
    });
  },
);

export const launchImageLibrary = jest.fn(
  (_options: CameraOptions, callback: (response: ImagePickerResponse) => void) => {
    callback({
      assets: [
        {
          uri: 'file:///tmp/gallery_image.jpg',
          fileName: 'gallery_image.jpg',
          fileSize: 512 * 1024,
          type: 'image/jpeg',
        },
      ],
    });
  },
);
