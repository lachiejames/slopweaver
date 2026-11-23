/**
 * The lane's own Storage (`./fixtures/fakeObjectStorage.ts`) answers the store's REAL object client
 * (`src/store/objects/client.ts`, over `@supabase/storage-js`) the way every console spec relies on: a bucket made,
 * an object written and read back byte for byte, a signed address that fetches those bytes with no key, and the
 * refusals a client upgrade or a wrong key would meet. Without this, a fake drifting from the client turns the
 * viewer spec red for a reason no test names.
 *
 * It starts its own fake rather than reading global setup's, so a run's key never reaches a spec.
 */
import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { unwrap, unwrapErr } from "../../lib/result.js";
import { openObjectStore } from "../../store/objects/client.js";
import { ObjectStoreErrors } from "../../store/objects/errors.js";
import { type FakeObjectStorage, startFakeObjectStorage } from "./fixtures/fakeObjectStorage.js";

const BUCKET = "published-pages";
const BYTES = new TextEncoder().encode("<!doctype html><title>acme</title>");
const KEY = createHash("sha256").update(BYTES).digest("hex");

let storage: FakeObjectStorage;

test.beforeAll(async () => {
  storage = await startFakeObjectStorage();
});

test.afterAll(async () => {
  await storage.stop();
});

test("the real client makes a bucket, writes, signs and reads an object through the lane's Storage", async () => {
  const store = openObjectStore({ apiUrl: storage.apiUrl, bucket: BUCKET, serviceKey: storage.serviceKey });
  unwrap(await store.ensureBucket());
  unwrap(await store.ensureBucket());
  unwrap(await store.put({ bytes: BYTES, contentType: "text/html", key: KEY }));
  const addresses = unwrap(await store.sign({ expiresInSeconds: 60, keys: [KEY] }));
  const fetched = await fetch(addresses.get(KEY)!);
  expect(fetched.status).toBe(200);
  expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(BYTES);
  expect(unwrap(await store.get({ key: KEY }))).toEqual(BYTES);
});

test("a wrong key is refused, and a signed address with its token changed fetches nothing", async () => {
  const stranger = openObjectStore({ apiUrl: storage.apiUrl, bucket: BUCKET, serviceKey: "x".repeat(32) });
  expect(unwrapErr(await stranger.get({ key: KEY })).code).toBe("OBJECT_REQUEST_FAILED");
  const store = openObjectStore({ apiUrl: storage.apiUrl, bucket: BUCKET, serviceKey: storage.serviceKey });
  unwrap(await store.ensureBucket());
  unwrap(await store.put({ bytes: BYTES, contentType: "text/html", key: KEY }));
  const address = new URL(unwrap(await store.sign({ expiresInSeconds: 60, keys: [KEY] })).get(KEY)!);
  address.searchParams.set("token", "forged");
  expect((await fetch(address)).status).toBe(400);
});

test("a key the bucket does not hold is not signed", async () => {
  const store = openObjectStore({ apiUrl: storage.apiUrl, bucket: BUCKET, serviceKey: storage.serviceKey });
  unwrap(await store.ensureBucket());
  const missing = "0".repeat(64);
  expect(unwrapErr(await store.sign({ expiresInSeconds: 60, keys: [missing] }))).toEqual(
    ObjectStoreErrors.requestFailed({
      key: missing,
      reason: "Either the object does not exist or you do not have access to it",
      status: undefined,
    }),
  );
});
