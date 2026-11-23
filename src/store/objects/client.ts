/**
 * The store's object half: one private Supabase Storage bucket, reached through the official client.
 *
 * The first thing in this repository to write through the Storage API, which holds media. `@supabase/storage-js` is the official SDK, per `docs/provider-sdks.md`; the local
 * stack's gateway takes the storage container's own JWT service key as both `apikey` and bearer — MEASURED,
 * `listBuckets()` through that install's gateway at `/storage/v1` answered `[]` with no error.
 * The URL and the key are read off the running stack on each open (`./selection.ts`), never stored.
 *
 * Every object is CONTENT-ADDRESSED: its key is the sha-256 of its bytes. So a `put` of an existing key
 * writes the same bytes again and is safe to repeat, and every `get` re-hashes what came back and refuses a
 * body that does not match its own key rather than handing a reader bytes nobody stored.
 */
import { createHash } from "node:crypto";

import { StorageClient } from "@supabase/storage-js";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { type ObjectStoreError, ObjectStoreErrors } from "./errors.js";

/** What stands in for the object key or bucket of a failure that carried the service key. */
const WITHHELD_KEY = "[withheld]";

/** What stands in for the reason of a failure that carried the service key. */
const WITHHELD_REASON = "the failure was withheld because it carried the service key";

/** One bucket's worth of the operations the store needs, and nothing else. */
export interface ObjectStore {
  /** Create the bucket, private, when it does not already exist. */
  readonly ensureBucket: () => Promise<Result<void, ObjectStoreError>>;
  /** Write one object at its key, replacing identical bytes when it is already there. */
  readonly put: (args: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }) => Promise<Result<void, ObjectStoreError>>;
  /** Read one object's bytes, verified against the key they were stored under. */
  readonly get: (args: { key: string }) => Promise<Result<Uint8Array, ObjectStoreError>>;
  /** Mint one short-lived read address per key in a single request. An address is a capability; the key never leaves. */
  readonly sign: (args: {
    keys: readonly string[];
    expiresInSeconds: number;
  }) => Promise<Result<ReadonlyMap<string, string>, ObjectStoreError>>;
}

/**
 * Open one bucket on the selected Storage API.
 *
 * @param apiUrl the Supabase API's base URL, without `/storage/v1`
 * @param serviceKey the key the API is called with
 * @param bucket the bucket every call addresses
 * @returns the bucket's operations — no request is made until one is called
 */
export function openObjectStore({
  apiUrl,
  serviceKey,
  bucket,
}: {
  apiUrl: string;
  serviceKey: string;
  bucket: string;
}): ObjectStore {
  const storageUrl = `${apiUrl.replace(/\/+$/u, "")}/storage/v1`;
  const client = new StorageClient(storageUrl, {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  });
  // Every failure an operation returns passes this one scrub, so no field of it — the API's message, the
  // object key, a digest — can carry the key, whichever of them happens to spell it.
  const scrubbed = <T>({ result }: { result: Result<T, ObjectStoreError> }): Result<T, ObjectStoreError> =>
    result.mapErr((failure) => withoutServiceKey({ failure, serviceKey }));
  return {
    ensureBucket: async () => {
      try {
        const found = await client.getBucket(bucket);
        if (found.error === null) {
          return ok(undefined);
        }
        const created = await client.createBucket(bucket, { public: false });
        if (created.error !== null) {
          return scrubbed({ result: err(objectFailure({ error: created.error, key: bucket })) });
        }
        return ok(undefined);
      } catch (cause) {
        return scrubbed({ result: err(objectFailure({ error: cause, key: bucket })) });
      }
    },
    get: async ({ key }) => {
      try {
        const downloaded = await client.from(bucket).download(key);
        if (downloaded.error !== null) {
          return scrubbed({ result: err(objectFailure({ error: downloaded.error, key })) });
        }
        const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
        return scrubbed({ result: verifiedBytes({ bytes, key }) });
      } catch (cause) {
        return scrubbed({ result: err(objectFailure({ error: cause, key })) });
      }
    },
    put: async ({ key, bytes, contentType }) => {
      try {
        const uploaded = await client.from(bucket).upload(key, Buffer.from(bytes), { contentType, upsert: true });
        if (uploaded.error !== null) {
          return scrubbed({ result: err(objectFailure({ error: uploaded.error, key })) });
        }
        return ok(undefined);
      } catch (cause) {
        return scrubbed({ result: err(objectFailure({ error: cause, key })) });
      }
    },
    sign: async (args) => scrubbed({ result: await signBatch({ args, bucket, client, storageUrl }) }),
  };
}

/**
 * {@link ObjectStore.sign}'s body, unscrubbed: the caller passes every answer through the scrub. It never rejects —
 * the arguments are read inside the `try`, and the catch builds its failure through `thrownFailure`, so nothing a
 * caller hands in (a throwing getter, a hostile iterable) can escape past the scrub.
 *
 * @param args the caller's keys and lifetime, read only inside the `try`
 * @param client the Storage client the bucket is reached through
 * @param storageUrl the Storage API's base every address must sit under
 * @returns one address per key, or the typed failure
 */
async function signBatch({
  args,
  bucket,
  client,
  storageUrl,
}: {
  args: { keys: readonly string[]; expiresInSeconds: number };
  bucket: string;
  client: StorageClient;
  storageUrl: string;
}): Promise<Result<ReadonlyMap<string, string>, ObjectStoreError>> {
  try {
    const { keys, expiresInSeconds } = args;
    // One snapshot for the request and the check, so a caller's array changing mid-request cannot shrink the answer.
    const requested = [...keys];
    if (requested.length === 0) {
      return ok(new Map<string, string>());
    }
    const signed = await client.from(bucket).createSignedUrls(requested, expiresInSeconds);
    if (signed.error !== null) {
      return err(objectFailure({ error: signed.error, key: bucket }));
    }
    return signedAddressesByKey({ bucket, keys: requested, rows: signed.data, storageUrl });
  } catch (cause) {
    return err(thrownFailure({ error: cause, key: bucket }));
  }
}

/**
 * Every key's signed read address, or the failure of the first key the API did not sign. One unsigned key fails the
 * whole batch, because a page served with one image silently missing is the partial answer a reader cannot see. An
 * address that is not exactly this API's sign route for that bucket and key fails it too, for the same reason: a
 * swapped image is invisible. Exact rather than a suffix, because a longer path can end in the right one.
 *
 * @param bucket the bucket every address must name
 * @param keys the object keys that were asked for
 * @param rows what the API answered, one row per path, each carrying either an address or its own error
 * @param storageUrl the Storage API's base, ending `/storage/v1`, whose origin and path each address must share
 * @returns one address per key, or the failure naming the key that has none
 */
export function signedAddressesByKey({
  bucket,
  keys,
  rows,
  storageUrl,
}: {
  bucket: string;
  keys: readonly string[];
  rows: readonly SignedRow[];
  storageUrl: string;
}): Result<ReadonlyMap<string, string>, ObjectStoreError> {
  const base = plainSigningBase({ bucket, storageUrl });
  if (base.isErr()) {
    return err(base.error);
  }
  const addresses = new Map<string, string>();
  for (const key of keys) {
    const address = signedAddressOf({ base: base.value, bucket, key, rows });
    if (address.isErr()) {
      return err(address.error);
    }
    addresses.set(key, address.value);
  }
  return ok(addresses);
}

/** One row of the API's batch signing answer. */
type SignedRow = { readonly path: string | null; readonly error: string | null; readonly signedUrl: string | null };

/** A failure of the signing batch that names nothing but what it addressed and why, with no HTTP status. */
function signingFailure({ key, reason }: { key: string; reason: string }): ObjectStoreError {
  return ObjectStoreErrors.requestFailed({ key, reason, status: undefined });
}

/**
 * The Storage API's parsed base, once both it and the bucket hold no URL structure. The bucket is spliced into the
 * expected address, so one holding `?`, `#` or `/` would cut the compared path short and let a wrong address through.
 * The base is parsed ONCE and the expected path built as a string on its parsed pathname, never by re-parsing a
 * concatenation: a `?` or `#` in the base would otherwise swallow the route, and both paths would collapse alike.
 *
 * @param bucket the bucket every address must name
 * @param storageUrl the Storage API's base, which must end `/storage/v1`
 * @returns the parsed base, or the failure naming which of the two is not plain
 */
function plainSigningBase({
  bucket,
  storageUrl,
}: {
  bucket: string;
  storageUrl: string;
}): Result<URL, ObjectStoreError> {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(bucket)) {
    return err(signingFailure({ key: bucket, reason: "it is not a plain bucket name" }));
  }
  const base = URL.canParse(storageUrl) ? new URL(storageUrl) : undefined;
  const plainBase =
    base?.search === "" &&
    base.hash === "" &&
    base.username === "" &&
    base.password === "" &&
    base.pathname.endsWith("/storage/v1");
  if (base === undefined || !plainBase) {
    return err(
      signingFailure({ key: bucket, reason: "the Storage API's base address is not a plain /storage/v1 address" }),
    );
  }
  return ok(base);
}

/**
 * One key's signed address, only when the API answered it one that is exactly this API's sign route for that bucket
 * and key. Every object here is content-addressed, so a key is a sha-256 and can hold nothing a URL reads as structure.
 *
 * @param base the parsed Storage API base every address must share an origin and path with
 * @param bucket the bucket the address must name
 * @param key the object key that was asked for
 * @param rows what the API answered for the whole batch
 * @returns the address, or the failure naming why this key has none
 */
function signedAddressOf({
  base,
  bucket,
  key,
  rows,
}: {
  base: URL;
  bucket: string;
  key: string;
  rows: readonly SignedRow[];
}): Result<string, ObjectStoreError> {
  if (!/^[0-9a-f]{64}$/u.test(key)) {
    return err(signingFailure({ key, reason: "it is not a sha-256 content address" }));
  }
  const row = rows.find((candidate) => candidate.path === key);
  if (row === undefined) {
    return err(signingFailure({ key, reason: "the API answered no row for it" }));
  }
  if (row.error !== null) {
    return err(signingFailure({ key, reason: row.error }));
  }
  if (row.signedUrl === null) {
    return err(signingFailure({ key, reason: "its row carried no address" }));
  }
  const actual = URL.canParse(row.signedUrl) ? new URL(row.signedUrl) : undefined;
  const namesItsOwnObject =
    actual?.origin === base.origin && actual.pathname === `${base.pathname}/object/sign/${bucket}/${key}`;
  if (!namesItsOwnObject) {
    return err(signingFailure({ key, reason: "its address names another object" }));
  }
  return ok(row.signedUrl);
}

/**
 * A failure with nothing of the service key in it. When ANY string field — the message, an object key, a
 * digest, the API's own reason — contains the key, the whole failure is replaced by one that names nothing
 * the call addressed: a gateway can echo a request header into its error body, and an object key can be
 * chosen to equal the key. Withheld whole rather than redacted in place, because a marker can itself spell
 * a short key; `serviceKeyFromInspect` refuses any key short enough to fit in this replacement's fixed text.
 *
 * @param failure what an operation would have returned
 * @param serviceKey the key the request carried
 * @returns the failure unchanged, or the withheld one keeping only its HTTP status
 */
export function withoutServiceKey({
  failure,
  serviceKey,
}: {
  failure: ObjectStoreError;
  serviceKey: string;
}): ObjectStoreError {
  if (serviceKey === "") {
    return failure;
  }
  const carries = Object.values(failure).some((value) => typeof value === "string" && value.includes(serviceKey));
  if (!carries) {
    return failure;
  }
  const status = failure.code === "OBJECT_REQUEST_FAILED" ? failure.status : undefined;
  return ObjectStoreErrors.requestFailed({ key: WITHHELD_KEY, reason: WITHHELD_REASON, status });
}

/**
 * The bytes, only when they hash to the key they were stored under.
 *
 * @param bytes what the API returned
 * @param key the object key, which is the expected sha-256
 * @returns the bytes, or the mismatch naming what they hashed to
 */
export function verifiedBytes({
  bytes,
  key,
}: {
  bytes: Uint8Array;
  key: string;
}): Result<Uint8Array, ObjectStoreError> {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== key) {
    return err(ObjectStoreErrors.digestMismatch({ actual, key }));
  }
  return ok(bytes);
}

/**
 * A Storage failure — the client's own error value, or anything thrown on the way — as the typed failure.
 *
 * `storage-js` answers most failures as a returned `StorageError` carrying `status`; a transport failure
 * (the API not listening) is thrown as a plain `TypeError` with no status. Both are read by shape rather
 * than by class, so a test can hand in either as a plain value.
 *
 * The API's own message is copied in verbatim; {@link withoutServiceKey} is what keeps the key out of it.
 *
 * @param key the object key or bucket the call addressed
 * @param error what the client returned or threw
 * @returns the typed failure
 */
export function objectFailure({ key, error }: { key: string; error: unknown }): ObjectStoreError {
  const status = statusOf({ error });
  return ObjectStoreErrors.requestFailed({ key, reason: errorMessage({ error }), status });
}

/** What a thrown value that could not itself be read is reported as. */
const UNREADABLE_THROW = "the call threw a value that could not be read";

/**
 * {@link objectFailure} for a value caught in a `catch`, which can never throw itself. Reading a caught value runs
 * its code — a getter, a proxy trap — so a failure there answers a fixed reason instead of escaping the handler.
 *
 * @param key the object key or bucket the call addressed
 * @param error what the call threw
 * @returns the typed failure, or the fixed one when the thrown value could not be read
 */
function thrownFailure({ key, error }: { key: string; error: unknown }): ObjectStoreError {
  try {
    return objectFailure({ error, key });
  } catch {
    return ObjectStoreErrors.requestFailed({ key, reason: UNREADABLE_THROW, status: undefined });
  }
}

/**
 * The HTTP status a failure carries, when it carries one.
 *
 * @param error what the client returned or threw
 * @returns the status, or `undefined` for a failure that never reached the API
 */
function statusOf({ error }: { error: unknown }): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const { status } = error;
  if (typeof status !== "number") {
    return undefined;
  }
  return status;
}
