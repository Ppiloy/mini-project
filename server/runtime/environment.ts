import { createHash } from "node:crypto";
import type { PgPoolLike } from "../postgres.js";

export type RuntimeEnvironmentKind = "production" | "preview" | "local";
export interface RuntimeEnvironmentConfig {
  kind: RuntimeEnvironmentKind;
  databaseFingerprint: string;
  storageStore: string;
  storageRegion: string;
  deploymentContext: string;
}
export interface EnvironmentMarker extends RuntimeEnvironmentConfig {
  id: string;
  initializedAt: string;
}

const supportedRegions = new Set(["ap-southeast-1", "ap-southeast-2", "eu-central-1", "us-east-2"]);

function databaseIdentity(connectionString: string): string {
  const parsed = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("NETLIFY_DB_URL must be a PostgreSQL connection URL.");
  if (!parsed.username) throw new Error("NETLIFY_DB_URL must identify its database role.");
  const routing = [...parsed.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`).join("&");
  const identity = `${parsed.protocol}//${parsed.username}@${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}${parsed.pathname}?${routing}`;
  return createHash("sha256").update(identity).digest("hex");
}

function safeSiteName(siteId: string): string {
  const normalized = siteId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!normalized) throw new Error("SITE_ID must identify the hosted site.");
  return normalized.slice(0, 24);
}

export function resolveRuntimeEnvironmentConfig(env: NodeJS.ProcessEnv): RuntimeEnvironmentConfig {
  const isHosted = env.NETLIFY === "true" || Boolean(env.SITE_ID || env.NETLIFY_SITE_ID || env.URL);
  const context = env.FTC_DEPLOYMENT_CONTEXT ?? (!isHosted ? env.CONTEXT ?? "dev" : undefined);
  if (!context) throw new Error("FTC_DEPLOYMENT_CONTEXT is required in the hosted Function runtime.");
  const kind: RuntimeEnvironmentKind = context === "production" ? "production"
    : context === "deploy-preview" || context === "branch-deploy" ? "preview"
      : context === "dev" ? "local"
        : (() => { throw new Error("Unsupported Netlify deployment context."); })();
  const connectionString = env.NETLIFY_DB_URL;
  if (!connectionString) throw new Error("NETLIFY_DB_URL is required to identify the active database branch.");
  const databaseFingerprint = databaseIdentity(connectionString);
  const region = env.FTC_BLOB_REGION ?? "us-east-2";
  if (!supportedRegions.has(region)) throw new Error("FTC_BLOB_REGION is unsupported.");
  const siteId = env.SITE_ID ?? env.NETLIFY_SITE_ID;
  let storageStore: string;
  if (kind === "local") storageStore = "ftc-evidence-local";
  else {
    if (!siteId) throw new Error("SITE_ID is required for hosted evidence isolation.");
    const site = safeSiteName(siteId);
    storageStore = kind === "production"
      ? `ftc-evidence-prod-${site}`.slice(0, 64)
      : `ftc-evidence-preview-${site}-${databaseFingerprint.slice(0, 16)}`.slice(0, 64);
  }
  return { kind, databaseFingerprint, storageStore, storageRegion: region, deploymentContext: context };
}

export async function ensureEnvironmentMarker(pool: PgPoolLike, config: RuntimeEnvironmentConfig): Promise<EnvironmentMarker> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ftc-hosting-environment-marker'))");
    const active = await client.query<{
      id: string; kind: RuntimeEnvironmentKind; database_fingerprint: string; storage_store: string;
      storage_region: string; deployment_context: string; initialized_at: Date | string;
    }>(
      `SELECT marker.* FROM active_hosting_environment active
       JOIN hosting_environment_markers marker ON marker.id=active.marker_id
       WHERE active.singleton=true FOR UPDATE OF active`,
    );
    const existing = active.rows[0];
    let marker: EnvironmentMarker;
    if (!existing) {
      const inserted = await client.query<{ id: string; initialized_at: Date | string }>(
        `INSERT INTO hosting_environment_markers(kind,database_fingerprint,storage_store,storage_region,deployment_context)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,initialized_at`,
        [config.kind, config.databaseFingerprint, config.storageStore, config.storageRegion, config.deploymentContext],
      );
      const row = inserted.rows[0]!;
      await client.query("INSERT INTO active_hosting_environment(singleton,marker_id) VALUES (true,$1)", [row.id]);
      marker = { ...config, id: row.id, initializedAt: new Date(row.initialized_at).toISOString() };
    } else {
      const matches = existing.kind === config.kind && existing.database_fingerprint === config.databaseFingerprint &&
        existing.storage_store === config.storageStore && existing.storage_region === config.storageRegion &&
        existing.deployment_context === config.deploymentContext;
      if (matches) {
        marker = { kind: existing.kind, databaseFingerprint: existing.database_fingerprint,
          storageStore: existing.storage_store, storageRegion: existing.storage_region,
          deploymentContext: existing.deployment_context, id: existing.id,
          initializedAt: new Date(existing.initialized_at).toISOString() };
      } else if (config.kind === "preview" && existing.database_fingerprint !== config.databaseFingerprint) {
        const inserted = await client.query<{ id: string; initialized_at: Date | string }>(
          `INSERT INTO hosting_environment_markers(kind,database_fingerprint,storage_store,storage_region,deployment_context)
           VALUES ($1,$2,$3,$4,$5) RETURNING id,initialized_at`,
          [config.kind, config.databaseFingerprint, config.storageStore, config.storageRegion, config.deploymentContext],
        );
        const row = inserted.rows[0]!;
        await client.query("UPDATE active_hosting_environment SET marker_id=$1,updated_at=now() WHERE singleton=true", [row.id]);
        await client.query("DELETE FROM user_sessions");
        marker = { ...config, id: row.id, initializedAt: new Date(row.initialized_at).toISOString() };
      } else {
        throw new Error("Stored hosting environment does not match this trusted runtime configuration.");
      }
    }
    await client.query("COMMIT");
    return marker;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}
