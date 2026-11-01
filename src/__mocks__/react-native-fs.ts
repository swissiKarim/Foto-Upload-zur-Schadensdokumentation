/**
 * Mock for react-native-fs
 */

const DocumentDirectoryPath = '/app/private/documents';
const CachesDirectoryPath = '/app/private/caches';

const _store: Record<string, string> = {};

const exists = jest.fn(async (path: string): Promise<boolean> => {
  return path in _store || path === DocumentDirectoryPath;
});

const mkdir = jest.fn(async (_path: string): Promise<void> => {
  // no-op in mock
});

const readFile = jest.fn(async (path: string, _encoding?: string): Promise<string> => {
  if (path in _store) return _store[path];
  // Return a base64-like string for any unrecognised path
  return 'bW9ja2ZpbGVjb250ZW50'; // base64 "mockfilecontent"
});

const writeFile = jest.fn(async (path: string, content: string, _encoding?: string): Promise<void> => {
  _store[path] = content;
});

const unlink = jest.fn(async (path: string): Promise<void> => {
  delete _store[path];
});

/** Helper to reset state between tests */
export function __resetStore(): void {
  Object.keys(_store).forEach((k) => delete _store[k]);
}

export default {
  DocumentDirectoryPath,
  CachesDirectoryPath,
  exists,
  mkdir,
  readFile,
  writeFile,
  unlink,
  __resetStore,
};
