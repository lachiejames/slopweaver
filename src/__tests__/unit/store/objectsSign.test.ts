/**
 * `signedAddressesByKey`: the pure half of a batch sign, where one key the API did not sign, or signed as another
 * object, fails the whole batch; and `sign` itself, which answers a scrubbed failure whatever its arguments throw.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { openObjectStore, signedAddressesByKey } from "../../../store/objects/client.js";

const BUCKET = "fixture";
const FIRST = "a".repeat(64);
const SECOND = "b".repeat(64);

const STORAGE_URL = "http://127.0.0.1:55321/storage/v1";

/** The address the local Storage API signs one key as. */
function addressOf({ key }: { key: string }): string {
  return `${STORAGE_URL}/object/sign/${BUCKET}/${key}?token=FIXTURE`;
}

describe("signedAddressesByKey", () => {
  it("maps every key to its own address, whatever order the API answered in", () => {
    const result = signedAddressesByKey({
      bucket: BUCKET,
      storageUrl: STORAGE_URL,
      keys: [FIRST, SECOND],
      rows: [
        { error: null, path: SECOND, signedUrl: addressOf({ key: SECOND }) },
        { error: null, path: FIRST, signedUrl: addressOf({ key: FIRST }) },
      ],
    });

    expect([...unwrap(result).entries()]).toEqual([
      [FIRST, addressOf({ key: FIRST })],
      [SECOND, addressOf({ key: SECOND })],
    ]);
  });

  it("answers an empty map for no keys", () => {
    expect(unwrap(signedAddressesByKey({ bucket: BUCKET, storageUrl: STORAGE_URL, keys: [], rows: [] })).size).toBe(0);
  });

  it("fails the batch on a key the API answered with its own error, naming the key and the reason", () => {
    const failure = unwrapErr(
      signedAddressesByKey({
        bucket: BUCKET,
        storageUrl: STORAGE_URL,
        keys: [FIRST, SECOND],
        rows: [
          { error: null, path: FIRST, signedUrl: addressOf({ key: FIRST }) },
          { error: "Either the object does not exist or you do not have access to it", path: SECOND, signedUrl: null },
        ],
      }),
    );

    expect(failure.code).toBe("OBJECT_REQUEST_FAILED");
    expect(failure.message).toBe(
      `the Storage API refused ${SECOND}: Either the object does not exist or you do not have access to it`,
    );
  });

  it("fails the batch on a key the API answered no row for", () => {
    const failure = unwrapErr(
      signedAddressesByKey({
        bucket: BUCKET,
        storageUrl: STORAGE_URL,
        keys: [FIRST],
        rows: [{ error: null, path: SECOND, signedUrl: addressOf({ key: SECOND }) }],
      }),
    );

    expect(failure.message).toBe(`the Storage API refused ${FIRST}: the API answered no row for it`);
  });

  it("fails the batch on a row carrying neither an address nor an error", () => {
    const failure = unwrapErr(
      signedAddressesByKey({
        bucket: BUCKET,
        storageUrl: STORAGE_URL,
        keys: [FIRST],
        rows: [{ error: null, path: FIRST, signedUrl: null }],
      }),
    );

    expect(failure.message).toBe(`the Storage API refused ${FIRST}: its row carried no address`);
  });

  it.each(["victim?x", "a".repeat(63), "A".repeat(64), `${"a".repeat(63)}/`])(
    "refuses the key %s before reading any row, because it is not a content address",
    (key) => {
      const failure = unwrapErr(
        signedAddressesByKey({
          bucket: BUCKET,
          keys: [key],
          rows: [{ error: null, path: key, signedUrl: addressOf({ key }) }],
          storageUrl: STORAGE_URL,
        }),
      );

      expect(failure.message).toBe(`the Storage API refused ${key}: it is not a sha-256 content address`);
    },
  );

  it.each([
    ["another key's address", addressOf({ key: SECOND })],
    ["another bucket's address", `${STORAGE_URL}/object/sign/other/${FIRST}?token=FIXTURE`],
    ["a longer route ending in its own path", `${STORAGE_URL}/object/sign/other/decoy/object/sign/${BUCKET}/${FIRST}`],
    ["another host's address", `http://127.0.0.2:55321/storage/v1/object/sign/${BUCKET}/${FIRST}?token=FIXTURE`],
    ["something that is not an address", "not an address"],
  ])("fails the batch on a row carrying %s", (_, signedUrl) => {
    const failure = unwrapErr(
      signedAddressesByKey({
        bucket: BUCKET,
        storageUrl: STORAGE_URL,
        keys: [FIRST],
        rows: [{ error: null, path: FIRST, signedUrl }],
      }),
    );

    expect(failure.message).toBe(`the Storage API refused ${FIRST}: its address names another object`);
  });
});

describe("signedAddressesByKey over a bucket holding URL structure", () => {
  it.each(["victim?ignored", "victim#ignored", "victim/ignored", "Victim", ""])("refuses %j", (bucket) => {
    const failure = unwrapErr(
      signedAddressesByKey({
        bucket,
        keys: [FIRST],
        rows: [{ error: null, path: FIRST, signedUrl: `${STORAGE_URL}/object/sign/victim?token=FIXTURE` }],
        storageUrl: STORAGE_URL,
      }),
    );

    expect(failure.message).toBe(`the Storage API refused ${bucket}: it is not a plain bucket name`);
  });
});

describe("signedAddressesByKey over a Storage base holding URL structure", () => {
  it.each([
    "http://127.0.0.1:55321#cut/storage/v1",
    "http://127.0.0.1:55321?cut/storage/v1",
    "http://user:pass@127.0.0.1:55321/storage/v1",
    "http://127.0.0.1:55321/elsewhere",
    "not a url",
  ])("refuses %j", (storageUrl) => {
    const failure = unwrapErr(
      signedAddressesByKey({
        bucket: BUCKET,
        keys: [FIRST],
        rows: [{ error: null, path: FIRST, signedUrl: "http://127.0.0.1:55321/?token=FIXTURE" }],
        storageUrl,
      }),
    );

    expect(failure.message).toBe(
      `the Storage API refused ${BUCKET}: the Storage API's base address is not a plain /storage/v1 address`,
    );
  });
});

// Both cases throw before any request is made, so the unreachable address is never dialled.
describe("ObjectStore.sign over hostile arguments", () => {
  const SERVICE_KEY = "FIXTURE_SERVICE_KEY_0123456789";
  const store = openObjectStore({ apiUrl: "http://127.0.0.1:9", bucket: BUCKET, serviceKey: SERVICE_KEY });

  it("answers the scrubbed failure when reading an argument throws the service key", async () => {
    const args = {
      keys: [FIRST],
      get expiresInSeconds(): number {
        throw new Error(SERVICE_KEY);
      },
    };

    const failure = unwrapErr(await store.sign(args));

    expect(failure.code).toBe("OBJECT_REQUEST_FAILED");
    expect(failure.message).toBe(
      "the Storage API refused [withheld]: the failure was withheld because it carried the service key",
    );
  });

  it("answers a fixed failure when the thrown value cannot itself be read", async () => {
    const hostile = new Proxy(
      {},
      {
        has(): boolean {
          throw new Error(SERVICE_KEY);
        },
      },
    );
    const keys: Iterable<string> = {
      [Symbol.iterator]: () => ({
        next: (): IteratorResult<string> => {
          throw hostile;
        },
      }),
    };

    const failure = unwrapErr(await store.sign({ expiresInSeconds: 60, keys: keys as readonly string[] }));

    expect(failure.message).toBe(`the Storage API refused ${BUCKET}: the call threw a value that could not be read`);
  });
});
