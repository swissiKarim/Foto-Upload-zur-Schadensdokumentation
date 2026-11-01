/**
 * Ambient module declarations for native dependencies that are mocked in tests.
 */

declare module 'react-native-image-picker' {
  export interface ImagePickerAsset {
    uri?: string;
    fileName?: string;
    type?: string;
    fileSize?: number;
    width?: number;
    height?: number;
  }

  export interface ImagePickerResponse {
    didCancel?: boolean;
    errorCode?: string;
    errorMessage?: string;
    assets?: ImagePickerAsset[];
  }

  export interface ImageLibraryOptions {
    mediaType: 'photo' | 'video' | 'mixed';
    selectionLimit?: number;
    quality?: number;
    includeBase64?: boolean;
  }

  export interface CameraOptions {
    mediaType: 'photo' | 'video' | 'mixed';
    quality?: number;
    includeBase64?: boolean;
  }

  export function launchImageLibrary(options: ImageLibraryOptions): Promise<ImagePickerResponse>;
  export function launchCamera(options: CameraOptions): Promise<ImagePickerResponse>;
}

declare module '@react-native-camera-roll/camera-roll' {
  export const CameraRoll: {
    getPhotos: (options: unknown) => Promise<unknown>;
    save: (uri: string) => Promise<string>;
  };
  export default CameraRoll;
}
