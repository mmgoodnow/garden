import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const keyBase64 = process.env.APP_ENC_KEY_BASE64;
  if (!keyBase64) {
    throw new Error("APP_ENC_KEY_BASE64 is required to encrypt secrets.");
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENC_KEY_BASE64 must be 32 bytes (base64-encoded).");
  }
  return key;
}

export function encryptSecret(value: string) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string) {
  const key = getKey();
  const [ivBase64, tagBase64, ciphertextBase64] = payload.split(".");
  if (!ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Invalid encrypted payload.");
  }
  const iv = Buffer.from(ivBase64, "base64");
  const tag = Buffer.from(tagBase64, "base64");
  const ciphertext = Buffer.from(ciphertextBase64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
