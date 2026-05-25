/**
 * Credentials encryption/decryption tests.
 */

import { describe, it, expect } from "vitest";
import {
  encryptPayload,
  decryptPayload,
  isCredentialRef,
  makeCredentialRef,
  CredentialError,
  safeEqual,
} from "../src/credentials.js";

const TEST_KEY = "this-is-a-strong-32-char-test-key-please-rotate";

describe("encrypt / decrypt round-trip", () => {
  it("encrypts and decrypts simple payloads", () => {
    const payload = { apiKey: "sk-secret-123", baseUrl: "https://api.example.com" };
    const encrypted = encryptPayload(payload, TEST_KEY);
    expect(typeof encrypted).toBe("string");
    expect(encrypted).not.toContain("sk-secret-123"); // sanity: secret not in plaintext

    const decrypted = decryptPayload(encrypted, TEST_KEY);
    expect(decrypted).toEqual(payload);
  });

  it("encrypts complex nested payloads", () => {
    const payload = {
      type: "oauth2",
      tokens: { accessToken: "xxx", refreshToken: "yyy", expiresAt: 12345 },
      scopes: ["read", "write"],
    };
    const encrypted = encryptPayload(payload, TEST_KEY);
    const decrypted = decryptPayload(encrypted, TEST_KEY);
    expect(decrypted).toEqual(payload);
  });

  it("produces different ciphertexts for the same payload (random IV)", () => {
    const payload = { secret: "same" };
    const c1 = encryptPayload(payload, TEST_KEY);
    const c2 = encryptPayload(payload, TEST_KEY);
    expect(c1).not.toBe(c2);
    // Both decrypt to the same value
    expect(decryptPayload(c1, TEST_KEY)).toEqual(decryptPayload(c2, TEST_KEY));
  });
});

describe("encrypt / decrypt error cases", () => {
  it("rejects short master keys", () => {
    expect(() => encryptPayload({ x: 1 }, "short")).toThrow(CredentialError);
  });

  it("decryption fails with wrong key", () => {
    const encrypted = encryptPayload({ secret: "hello" }, TEST_KEY);
    const wrongKey = "another-32-char-key-totally-different-aaa";
    expect(() => decryptPayload(encrypted, wrongKey)).toThrow(CredentialError);
  });

  it("decryption fails on tampered ciphertext", () => {
    const encrypted = encryptPayload({ secret: "hello" }, TEST_KEY);
    // Flip a byte in the middle (after IV+authTag)
    const tampered = Buffer.from(encrypted, "base64");
    tampered[40] = (tampered[40]! + 1) % 256;
    expect(() => decryptPayload(tampered.toString("base64"), TEST_KEY)).toThrow(CredentialError);
  });

  it("decryption fails on truncated blob", () => {
    expect(() => decryptPayload("AAAA", TEST_KEY)).toThrow(CredentialError);
  });
});

describe("CredentialRef helpers", () => {
  it("makeCredentialRef builds a recognizable ref", () => {
    const ref = makeCredentialRef("cred-123");
    expect(ref.__credentialRef).toBe(true);
    expect(ref.credentialId).toBe("cred-123");
    expect(ref.field).toBeUndefined();
  });

  it("makeCredentialRef supports field paths", () => {
    const ref = makeCredentialRef("cred-123", "apiKey");
    expect(ref.field).toBe("apiKey");
  });

  it("isCredentialRef correctly identifies refs", () => {
    expect(isCredentialRef(makeCredentialRef("x"))).toBe(true);
    expect(isCredentialRef({ credentialId: "x" })).toBe(false); // missing __credentialRef
    expect(isCredentialRef({ __credentialRef: true })).toBe(false); // missing id
    expect(isCredentialRef("string")).toBe(false);
    expect(isCredentialRef(null)).toBe(false);
    expect(isCredentialRef(undefined)).toBe(false);
    expect(isCredentialRef({ __credentialRef: false, credentialId: "x" })).toBe(false);
  });
});

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("hello", "hello")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(safeEqual("hello", "world")).toBe(false);
  });

  it("returns false for strings of different length without throwing", () => {
    expect(safeEqual("a", "ab")).toBe(false);
  });
});
