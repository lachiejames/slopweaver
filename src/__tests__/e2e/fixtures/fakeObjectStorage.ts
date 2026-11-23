/**
 * The console lane's Storage: an in-memory, loopback stand-in for the exact slice of the Supabase Storage API the
 * store's object client calls through `@supabase/storage-js` (`src/store/objects/client.ts`) — read a bucket, create
 * one, upload an object, download it, batch-sign keys, and fetch a signed address. CI's lane has a plain Postgres and
 * no Supabase stack, so without this a published page has nowhere to live and the console has nothing to serve.
 *
 * Every route but a signed fetch wants the run's generated key as both the bearer and `apikey`, as the real gateway
 * does; a signed fetch wants instead the token minted for that one key, unexpired. Anything else answers 404, so a
 * client upgrade that calls a route this does not answer turns the lane red rather than passing by accident. The real
 * protocol is proven against the real stack by the opt-in `src/__tests__/integration/publishedPageObjects.test.ts`.
 *
 * The routes are read off `node_modules/@supabase/storage-js/dist/index.mjs` (`getBucket`, `createBucket`,
 * `uploadOrUpdate`, `download`, `createSignedUrls`): `grep -n "async getBucket\|async createSignedUrls" <that file>`.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { z } from "zod";

import { safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";

/** The lane's Storage, running. */
export interface FakeObjectStorage {
  /** `http://127.0.0.1:<port>`, the base the client appends `/storage/v1` to. */
  readonly apiUrl: string;
  /** The run's generated key, never written anywhere. */
  readonly serviceKey: string;
  /** Close the server. */
  readonly stop: () => Promise<void>;
}

/** The API's own base under the origin. */
const STORAGE_BASE = "/storage/v1";

/** One minted signed address: what it reads and until when. */
interface SignedGrant {
  readonly bucket: string;
  readonly key: string;
  readonly expiresAtMs: number;
}

/** What the fake holds: buckets, each a map of object keys to bytes, and the live signed grants by token. */
interface Held {
  readonly buckets: Map<string, Map<string, Uint8Array>>;
  readonly grants: Map<string, SignedGrant>;
}

/**
 * Read a request's whole body.
 *
 * @param request the incoming request
 * @returns its bytes
 */
async function bodyOf({ request }: { request: IncomingMessage }): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  // A request with no encoding set yields Buffers; anything else is refused rather than coerced.
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError("the request body yielded something other than bytes");
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** `createBucket`'s body, the one field the fake reads. */
const BucketCreate = z.looseObject({ id: z.string().min(1) });

/** `createSignedUrls`'s body. */
const SignBatch = z.object({ expiresIn: z.number().positive(), paths: z.array(z.string()) });

/**
 * Read a request's body as JSON.
 *
 * @param request the incoming request
 * @returns the parsed value, unchecked
 */
async function jsonOf({ request }: { request: IncomingMessage }): Promise<unknown> {
  const text = Buffer.from(await bodyOf({ request })).toString("utf8");
  return safeJsonParse({ label: "fake Storage request", text });
}

/**
 * Answer JSON with a status.
 *
 * @param response the response to write
 * @param status the HTTP status
 * @param value what to answer
 */
function answer({ response, status, value }: { response: ServerResponse; status: number; value: unknown }): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(safeJsonStringify({ label: "fake Storage answer", value }));
}

/** Answer the API's error shape. */
function refuse({ response, status, error }: { response: ServerResponse; status: number; error: string }): void {
  answer({ response, status, value: { error, message: error, statusCode: String(status) } });
}

/** Answer an object's bytes. */
function bytesOf({ response, bytes }: { response: ServerResponse; bytes: Uint8Array }): void {
  response.writeHead(200, { "content-length": String(bytes.byteLength), "content-type": "application/octet-stream" });
  response.end(Buffer.from(bytes));
}

/**
 * Whether a request carries the run's key as both the bearer and `apikey`.
 *
 * @param request the incoming request
 * @param serviceKey the run's key
 * @returns true when both headers carry it exactly
 */
function authorised({ request, serviceKey }: { request: IncomingMessage; serviceKey: string }): boolean {
  return request.headers.authorization === `Bearer ${serviceKey}` && request.headers["apikey"] === serviceKey;
}

/**
 * Answer a signed fetch: the token must be live and minted for exactly this bucket and key.
 *
 * @param held the fake's state
 * @param bucket the bucket the address names
 * @param key the object the address names
 * @param token the address's token
 * @param response the response to write
 */
function signedFetch({
  held,
  bucket,
  key,
  token,
  response,
}: {
  held: Held;
  bucket: string;
  key: string;
  token: string | null;
  response: ServerResponse;
}): void {
  const grant = token === null ? undefined : held.grants.get(token);
  const bytes = held.buckets.get(bucket)?.get(key);
  const live = grant?.bucket === bucket && grant.key === key && grant.expiresAtMs > Date.now();
  if (!live || bytes === undefined) {
    refuse({ error: "invalid signature", response, status: 400 });
    return;
  }
  bytesOf({ bytes, response });
}

/**
 * Mint one signed address per requested key, the row shape `createSignedUrls` reads.
 *
 * @param held the fake's state
 * @param bucket the bucket the keys are in
 * @param body the request's `{ expiresIn, paths }`
 * @returns one row per path, an error row for a key the bucket does not hold
 */
function signBatch({
  held,
  bucket,
  body,
}: {
  held: Held;
  bucket: string;
  body: { expiresIn: number; paths: readonly string[] };
}): readonly { path: string; signedURL: string | null; error: string | null }[] {
  return body.paths.map((path) => {
    if (held.buckets.get(bucket)?.has(path) !== true) {
      return { error: "Either the object does not exist or you do not have access to it", path, signedURL: null };
    }
    const token = randomBytes(24).toString("base64url");
    held.grants.set(token, { bucket, expiresAtMs: Date.now() + body.expiresIn * 1000, key: path });
    return { error: null, path, signedURL: `/object/sign/${bucket}/${path}?token=${token}` };
  });
}

/** One authorised API call, as the router hands it to a handler. */
interface ApiCall {
  readonly held: Held;
  readonly method: string;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
}

/**
 * Answer `getBucket` (GET `bucket/<id>`) or `createBucket` (POST `bucket`).
 *
 * @param call the call
 * @param id the bucket the path names, absent for a create
 * @returns whether the call was a bucket call this answered
 */
async function bucketCall({ call, id }: { call: ApiCall; id: string | undefined }): Promise<boolean> {
  const { held, method, request, response } = call;
  if (method === "GET" && id !== undefined) {
    if (held.buckets.has(id)) {
      answer({ response, status: 200, value: { id, name: id, public: false } });
    } else {
      refuse({ error: "Bucket not found", response, status: 400 });
    }
    return true;
  }
  if (method !== "POST" || id !== undefined) {
    return false;
  }
  const created = BucketCreate.parse(await jsonOf({ request }));
  if (!held.buckets.has(created.id)) {
    held.buckets.set(created.id, new Map());
  }
  answer({ response, status: 200, value: { name: created.id } });
  return true;
}

/**
 * Answer `uploadOrUpdate` (POST `object/<bucket>/<key>`) or `download` (GET of the same address).
 *
 * @param call the call
 * @param bucket the bucket the path names
 * @param key the object the path names
 * @returns whether the call was an object call this answered
 */
async function objectCall({ call, bucket, key }: { call: ApiCall; bucket: string; key: string }): Promise<boolean> {
  const { held, method, request, response } = call;
  const objects = held.buckets.get(bucket);
  if (objects === undefined) {
    refuse({ error: "Bucket not found", response, status: 404 });
    return true;
  }
  if (method === "POST") {
    objects.set(key, await bodyOf({ request }));
    answer({ response, status: 200, value: { Id: key, Key: `${bucket}/${key}` } });
    return true;
  }
  const bytes = objects.get(key);
  if (method !== "GET" || bytes === undefined) {
    return false;
  }
  bytesOf({ bytes, response });
  return true;
}

/**
 * Route one authorised API call to the handler its path names, answering 404 for anything none of them answers.
 *
 * @param call the call
 * @param parts the path's segments under the API base
 */
async function route({ call, parts }: { call: ApiCall; parts: readonly string[] }): Promise<void> {
  const [area, first, second, third] = parts;
  // The last segment of a path exactly two deep under its area, absent for any other depth.
  const leaf = third === undefined ? second : undefined;
  let answered = false;
  if (area === "bucket" && second === undefined) {
    answered = await bucketCall({ call, id: first });
  } else if (area === "object" && first === "sign" && leaf !== undefined && call.method === "POST") {
    const body = SignBatch.parse(await jsonOf({ request: call.request }));
    answer({ response: call.response, status: 200, value: signBatch({ body, bucket: leaf, held: call.held }) });
    answered = true;
  } else if (area === "object" && first !== undefined && first !== "sign" && leaf !== undefined) {
    answered = await objectCall({ bucket: first, call, key: leaf });
  }
  if (!answered) {
    refuse({ error: "not found", response: call.response, status: 404 });
  }
}

/**
 * Start the lane's Storage on a kernel-chosen loopback port, with a key generated for this run.
 *
 * @returns the running fake
 */
export async function startFakeObjectStorage(): Promise<FakeObjectStorage> {
  const serviceKey = randomBytes(24).toString("base64url");
  const held: Held = { buckets: new Map(), grants: new Map() };
  const server = createServer((request, response) => {
    const { method } = request;
    if (request.url === undefined || method === undefined) {
      refuse({ error: "not found", response, status: 404 });
      return;
    }
    const url = new URL(request.url, "http://127.0.0.1");
    if (!url.pathname.startsWith(`${STORAGE_BASE}/`)) {
      refuse({ error: "not found", response, status: 404 });
      return;
    }
    const parts = url.pathname.slice(STORAGE_BASE.length + 1).split("/");
    if (method === "GET" && parts[0] === "object" && parts[1] === "sign" && parts.length === 4) {
      signedFetch({ bucket: parts[2]!, held, key: parts[3]!, response, token: url.searchParams.get("token") });
      return;
    }
    if (!authorised({ request, serviceKey })) {
      refuse({ error: "Unauthorized", response, status: 401 });
      return;
    }
    route({ call: { held, method, request, response }, parts }).catch((cause: unknown) => {
      refuse({ error: cause instanceof Error ? cause.message : "failed", response, status: 500 });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the kernel handed the fake Storage no port");
  }
  return {
    apiUrl: `http://127.0.0.1:${String(address.port)}`,
    serviceKey,
    stop: async () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }
          reject(error);
        });
      }),
  };
}
