import { encrypt, decrypt, deriveKey } from "../src/crypto";

describe("AES-256-GCM crypto helpers", () => {
  const key = deriveKey("test-passphrase-for-unit-tests");

  it("derives a 32-byte key from a passphrase", () => {
    expect(key.length).toBe(32);
  });

  it("encrypts and decrypts a buffer correctly", () => {
    const plaintext = Buffer.from("Hello, insurance photo!");
    const ciphertext = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("produces different ciphertext each call (random IV)", () => {
    const plaintext = Buffer.from("same data");
    const c1 = encrypt(plaintext, key);
    const c2 = encrypt(plaintext, key);
    expect(c1.equals(c2)).toBe(false);
  });

  it("ciphertext is longer than plaintext (IV + authTag overhead)", () => {
    const plaintext = Buffer.from("photo bytes");
    const ciphertext = encrypt(plaintext, key);
    // 12 (IV) + 16 (authTag) + plaintext.length
    expect(ciphertext.length).toBe(12 + 16 + plaintext.length);
  });

  it("throws when decrypting with wrong key", () => {
    const wrongKey = deriveKey("wrong-key");
    const plaintext = Buffer.from("secret");
    const ciphertext = encrypt(plaintext, key);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });

  it("throws when ciphertext is tampered (integrity check)", () => {
    const plaintext = Buffer.from("secret data");
    const ciphertext = encrypt(plaintext, key);
    // Flip a byte in the ciphertext portion
    ciphertext[ciphertext.length - 1] ^= 0xff;
    expect(() => decrypt(ciphertext, key)).toThrow();
  });

  it("handles empty buffer", () => {
    const plaintext = Buffer.alloc(0);
    const ciphertext = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, key);
    expect(decrypted.length).toBe(0);
  });

  it("handles large buffers (15 MB image simulation)", () => {
    const plaintext = Buffer.alloc(15 * 1024 * 1024, 0xab);
    const ciphertext = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });
});
