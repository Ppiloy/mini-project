import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const PARAMETERS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function derive(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, result) => error ? reject(error) : resolve(result));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await derive(password, salt, KEY_LENGTH, PARAMETERS);
  return `scrypt$${PARAMETERS.N}$${PARAMETERS.r}$${PARAMETERS.p}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, nText, rText, pText, saltHex, keyHex, extra] = encoded.split("$");
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (
    extra !== undefined || algorithm !== "scrypt" || !Number.isSafeInteger(N) || N < 2_048 || N > 131_072 ||
    !Number.isSafeInteger(r) || r < 1 || r > 16 || !Number.isSafeInteger(p) || p < 1 || p > 4 ||
    !saltHex || !/^[a-f\d]{32,128}$/i.test(saltHex) || !keyHex || !/^[a-f\d]{128}$/i.test(keyHex)
  ) return false;

  try {
    const expected = Buffer.from(keyHex, "hex");
    const actual = await derive(password, Buffer.from(saltHex, "hex"), expected.length, {
      N, r, p, maxmem: Math.max(PARAMETERS.maxmem, 128 * N * r + 1024),
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Test setup helper. Production user creation belongs to the operator seed command. */
export const hashPasswordForTest = hashPassword;
