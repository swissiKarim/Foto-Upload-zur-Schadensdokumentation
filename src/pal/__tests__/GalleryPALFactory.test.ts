/**
 * Unit tests for the PAL factory – verifies that the correct platform
 * implementation is returned and that both are encapsulated behind IGalleryPAL.
 */

import { Platform } from 'react-native';
import { createGalleryPAL } from '../gallery/index';
import { IOSGalleryPAL } from '../gallery/IOSGalleryPAL';
import { AndroidGalleryPAL } from '../gallery/AndroidGalleryPAL';

describe('createGalleryPAL – PAL factory', () => {
  it('returns IOSGalleryPAL when Platform.OS is "ios"', () => {
    Platform.OS = 'ios';
    const pal = createGalleryPAL();
    expect(pal).toBeInstanceOf(IOSGalleryPAL);
  });

  it('returns AndroidGalleryPAL when Platform.OS is "android"', () => {
    Platform.OS = 'android';
    const pal = createGalleryPAL();
    expect(pal).toBeInstanceOf(AndroidGalleryPAL);
  });

  it('returned PAL exposes the IGalleryPAL interface on iOS', () => {
    Platform.OS = 'ios';
    const pal = createGalleryPAL();
    expect(typeof pal.requestPermission).toBe('function');
    expect(typeof pal.openPicker).toBe('function');
    expect(typeof pal.validateImage).toBe('function');
  });

  it('returned PAL exposes the IGalleryPAL interface on Android', () => {
    Platform.OS = 'android';
    const pal = createGalleryPAL();
    expect(typeof pal.requestPermission).toBe('function');
    expect(typeof pal.openPicker).toBe('function');
    expect(typeof pal.validateImage).toBe('function');
  });
});
