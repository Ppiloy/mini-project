import { createHmac, hkdfSync } from "node:crypto";
import type { RuntimeEnvironmentConfig } from "./environment.js";

export const FTC_ENVIRONMENT_CHALLENGE_HEADER = "x-ftc-environment-challenge";
export const FTC_ENVIRONMENT_PROOF_HEADER = "x-ftc-environment-proof";
export const FTC_ENVIRONMENT_DIAGNOSTICS_HEADER = "x-ftc-environment-diagnostics";
export const FTC_DATABASE_IDENTITY_DIAGNOSTICS_HEADER = "x-ftc-database-identity-diagnostics";

export interface PreviewEnvironmentDiagnostics {
  key: string;
  database: string;
  store: string;
  region: string;
  context: string;
}

export interface PreviewDatabaseIdentityDiagnostics {
  protocol: string;
  role: string;
  host: string;
  port: string;
  path: string;
  routing: string;
}

const challengePattern = /^[a-f0-9]{32}$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;

function deriveProofKey(sessionSecret: string): Buffer {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(sessionSecret, "utf8"),
    Buffer.from("ftc-preview-environment-proof-salt-v1", "utf8"),
    Buffer.from("ftc-preview-environment-proof-key-v1", "utf8"),
    32,
  ));
}

function isEligibleProof(challenge: string, environment: RuntimeEnvironmentConfig, sessionSecret: string): boolean {
  return challengePattern.test(challenge) && environment.kind === "preview" && sessionSecret.length >= 32 &&
    fingerprintPattern.test(environment.databaseFingerprint) && Boolean(environment.storageStore) &&
    Boolean(environment.storageRegion) && Boolean(environment.deploymentContext);
}

/** Create an opaque, request-bound attestation for an already-ready preview runtime. */
export function createPreviewEnvironmentProof(
  challenge: string,
  environment: RuntimeEnvironmentConfig,
  sessionSecret: string,
): string | null {
  if (!isEligibleProof(challenge, environment, sessionSecret)) return null;

  const key = deriveProofKey(sessionSecret);
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

/** Create a challenge-bound, field-separated diagnostic for an eligible preview runtime. */
export function createPreviewEnvironmentDiagnostics(
  challenge: string,
  environment: RuntimeEnvironmentConfig,
  sessionSecret: string,
): PreviewEnvironmentDiagnostics | null {
  if (!isEligibleProof(challenge, environment, sessionSecret)) return null;

  const key = deriveProofKey(sessionSecret);
  const attest = (field: keyof PreviewEnvironmentDiagnostics, value: string): string => createHmac("sha256", key)
    .update(JSON.stringify(["ftc-preview-environment-diagnostics-v1", field, challenge, value]), "utf8")
    .digest("hex");

  return {
    key: attest("key", "ftc-preview-environment-diagnostic-key-confirmation-v1"),
    database: attest("database", environment.databaseFingerprint),
    store: attest("store", environment.storageStore),
    region: attest("region", environment.storageRegion),
    context: attest("context", environment.deploymentContext),
  };
}

/** Create opaque component attestations using the same URL parts as databaseIdentity. */
export function createPreviewDatabaseIdentityDiagnostics(
  challenge: string,
  environment: RuntimeEnvironmentConfig,
  connectionString: string,
  sessionSecret: string,
): PreviewDatabaseIdentityDiagnostics | null {
  if (!isEligibleProof(challenge, environment, sessionSecret)) return null;

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return null;
  }
  if (!(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") || !parsed.username) return null;

  const routing = [...parsed.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`).join("&");
  const key = deriveProofKey(sessionSecret);
  const attest = (field: keyof PreviewDatabaseIdentityDiagnostics, value: string): string => createHmac("sha256", key)
    .update(JSON.stringify(["ftc-preview-database-identity-diagnostics-v1", field, challenge, value]), "utf8")
    .digest("hex");

  return {
    protocol: attest("protocol", parsed.protocol),
    role: attest("role", parsed.username),
    host: attest("host", parsed.hostname.toLowerCase()),
    port: attest("port", parsed.port || "5432"),
    path: attest("path", parsed.pathname),
    routing: attest("routing", routing),
  };
}
