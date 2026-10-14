import { getStore } from "@netlify/blobs";
import type { EnvironmentMarker } from "../runtime/environment.js";

type BlobsRegion = "ap-southeast-1" | "ap-southeast-2" | "eu-central-1" | "us-east-2";

export interface BlobIO {
  put(marker: EnvironmentMarker, key: string, bytes: Uint8Array): Promise<void>;
  get(marker: EnvironmentMarker, key: string): Promise<Uint8Array | null>;
  delete(marker: EnvironmentMarker, key: string): Promise<void>;
}

/** Every operation selects the store and region from a trusted DB marker. */
export const netlifyBlobIO: BlobIO = {
  async put(marker, key, bytes) {
    const store = getStore({ name: marker.storageStore, region: marker.storageRegion as BlobsRegion, consistency: "strong" });
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const result = await store.set(key, arrayBuffer, { onlyIfNew: true });
    if (!result.modified) {
      const existing = await this.get(marker, key);
      if (!existing || Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) !== 0) {
        throw new Error("Existing evidence object does not match the reserved upload.");
      }
    }
  },
  async get(marker, key) {
    const store = getStore({ name: marker.storageStore, region: marker.storageRegion as BlobsRegion, consistency: "strong" });
    const data = await store.get(key, { type: "arrayBuffer", consistency: "strong" });
    return data === null ? null : new Uint8Array(data);
  },
  async delete(marker, key) {
    const store = getStore({ name: marker.storageStore, region: marker.storageRegion as BlobsRegion, consistency: "strong" });
    await store.delete(key);
  },
};
