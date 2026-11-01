/**
 * Mock for react-native-aes-crypto
 */

const randomKey = jest.fn(async (length: number): Promise<string> => {
  // Return a deterministic hex string of the right length
  return 'ab'.repeat(length);
});

const pbkdf2 = jest.fn(
  async (
    _password: string,
    _salt: string,
    _iterations: number,
    _keySize: number,
  ): Promise<string> => {
    return 'mockaes256key0000000000000000000'; // 32 chars ~ 256-bit key placeholder
  },
);

const encrypt = jest.fn(
  async (
    data: string,
    _key: string,
    _iv: string,
    _algorithm: string,
  ): Promise<string> => {
    // Simulate encryption by base64-encoding the input (NOT real crypto – test only)
    return Buffer.from(data).toString('base64');
  },
);

const decrypt = jest.fn(
  async (
    data: string,
    _key: string,
    _iv: string,
    _algorithm: string,
  ): Promise<string> => {
    // Reverse the mock encryption
    return Buffer.from(data, 'base64').toString('utf8');
  },
);

export default { randomKey, pbkdf2, encrypt, decrypt };
