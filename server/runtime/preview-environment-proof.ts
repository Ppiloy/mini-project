import { createHmac, hkdfSync } from "node:crypto";
import type { RuntimeEnvironmentConfig } from "./environment.js";

export const FTC_ENVIRONMENT_CHALLENGE_HEADER = "x-ftc-environment-challenge";
export const FTC_ENVIRONMENT_PROOF_HEADER = "x-ftc-environment-proof";

const challengePattern = /^[a-f0-9]{32}$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;

/** Create an opaque, request-bound attestation for an already-ready preview runtime. */
export function createPreviewEnvironmentProof(
  challenge: string,
  environment: RuntimeEnvironmentConfig,
  sessionSecret: string,
): string | null {
  if (!challengePattern.test(challenge) || environment.kind !== "preview" || sessionSecret.length < 32 ||
      !fingerprintPattern.test(environment.databaseFingerprint) || !environment.storageStore ||
      !environment.storageRegion || !environment.deploymentContext) return null;

  const key = Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(sessionSecret, "utf8"),
    Buffer.from("ftc-preview-environment-proof-salt-v1", "utf8"),
    Buffer.from("ftc-preview-environment-proof-key-v1", "utf8"),
    32,
  ));
  const message = JSON.stringify([
    "ftc-preview-environment-proof-v1",
    challenge,
    environment.kind,
    environment.databaseFingerprint,
    environment.storageStore,
    environment.storageRegion,
    environment.deploymentContext,
  ]);
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}
