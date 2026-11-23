import { encode } from "turbo-stream";
import { describe, expect, it } from "vitest";

import {
  decodeResourceJson,
  decodeSingleFetch,
  loaderBlocks,
  loaderData,
  resolveDeferred,
} from "../../../../atlas/nxCloud/dataRoute.js";
import { unwrap } from "../../../../lib/result.js";

/** One read's bytes: the read that ends the stream carries none, so it contributes an empty chunk. */
function chunkOf({ value }: { value: Uint8Array | undefined }): Uint8Array {
  if (value === undefined) {
    return new Uint8Array();
  }
  return value;
}

/** Encode a value the way React Router's own single fetch does, so the decoder is tested against the format. */
async function singleFetchText({ value }: { value: unknown }): Promise<string> {
  const stream = encode(value);
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let done = false;
  while (!done) {
    const read = await reader.read();
    done = read.done;
    chunks.push(chunkOf({ value: read.value }));
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

describe("decodeSingleFetch", () => {
  it("decodes a payload the way the client's own transport encodes one", async () => {
    const text = await singleFetchText({ value: { root: { data: { ok: true } } } });
    expect(unwrap(await decodeSingleFetch({ call: "c", text }))).toEqual({ root: { data: { ok: true } } });
  });

  it("resolves a DEFERRED value, which is how the run list actually arrives", async () => {
    const text = await singleFetchText({
      value: { "routes/x": { data: { deferredRunListPage: Promise.resolve({ runs: [1, 2] }) } } },
    });
    const decoded = unwrap(await decodeSingleFetch({ call: "c", text }));
    expect(loaderData({ routeId: "routes/x", value: decoded })).toEqual({ deferredRunListPage: { runs: [1, 2] } });
  });

  // The round-trip tests above encode and decode with the SAME installed turbo-stream, so they pass under
  // ANY version and cannot see a wire-format change. This one pins the literal bytes React Router v7's
  // server actually sends. MEASURED while bumping every dependency (reproduce with a scratch
  // project holding `turbo-stream@2.4.0` and `turbo-stream@3.2.1` side by side, encode with v2 and decode
  // with v3): turbo-stream 3 is a ground-up rewrite with a DIFFERENT encoding, and its decoder does not
  // refuse a v2 payload — it returns the flat chunk array verbatim, so every route lookup below would find
  // nothing and this atlas would record the family as empty. A confident wrong answer with no witness is
  // exactly what this file's header warns about, and only a fixed-bytes assertion can catch it.
  it("decodes the LITERAL bytes React Router v7 serves, so a wire-format change fails loudly", async () => {
    const wire = '[{"_1":2},"routes/x",{"_3":4},"data",{"_5":6,"_9":10},"runs",[7,8],1,2,"name","ok"]\n';
    const decoded = unwrap(await decodeSingleFetch({ call: "workspace-runs", text: wire }));
    expect(loaderData({ routeId: "routes/x", value: decoded })).toEqual({ name: "ok", runs: [1, 2] });
  });

  it("reports a body it cannot read rather than answering an empty record", async () => {
    const failed = await decodeSingleFetch({ call: "workspace-runs", text: "not a turbo stream" });
    expect(failed._unsafeUnwrapErr().code).toBe("PAYLOAD_UNREADABLE");
  });

  it("names the call in the failure, so a reader knows which surface is missing", async () => {
    const failed = await decodeSingleFetch({ call: "workspace-runs", text: "{" });
    expect(failed._unsafeUnwrapErr().message).toContain("workspace-runs");
  });
});

describe("resolveDeferred", () => {
  it("awaits a promise sitting inside an ordinary object", async () => {
    const resolved = await resolveDeferred({ depth: 0, value: { a: Promise.resolve(1) } });
    expect(resolved).toEqual({ a: 1 });
  });

  it("turns a REJECTED deferred into null rather than losing the rest of the payload", async () => {
    const resolved = await resolveDeferred({
      depth: 0,
      value: { bad: Promise.reject(new Error("boom")), good: 2 },
    });
    expect(resolved).toEqual({ bad: null, good: 2 });
  });

  it("resolves promises inside an array", async () => {
    expect(await resolveDeferred({ depth: 0, value: [Promise.resolve("x")] })).toEqual(["x"]);
  });

  it("stops at the depth cap rather than walking an unbounded structure", async () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(await resolveDeferred({ depth: 0, value: deep })).toEqual(deep);
  });
});

describe("loaderBlocks", () => {
  it("returns one entry per route that contributed loader data", () => {
    const blocks = loaderBlocks({ value: { root: { data: 1 }, "routes/x": { data: 2 } } });
    expect(blocks.map((block) => block.routeId)).toEqual(["root", "routes/x"]);
  });

  it("drops a block carrying no data key, which is what an error envelope looks like", () => {
    expect(loaderBlocks({ value: { "routes/x": { error: "nope" } } })).toEqual([]);
  });

  it("answers an empty list for a payload that is not a record", () => {
    expect(loaderBlocks({ value: "nonsense" })).toEqual([]);
  });
});

describe("loaderData", () => {
  it("reads one route's own block", () => {
    expect(loaderData({ routeId: "routes/x", value: { "routes/x": { data: { a: 1 } } } })).toEqual({ a: 1 });
  });

  it("answers null when the payload carries no such route", () => {
    expect(loaderData({ routeId: "routes/y", value: { "routes/x": { data: 1 } } })).toBe(null);
  });
});

describe("decodeResourceJson", () => {
  it("parses an ordinary JSON resource-route body", () => {
    expect(unwrap(decodeResourceJson({ call: "c", text: '{"a":1}' }))).toEqual({ a: 1 });
  });

  it("reports a body that is not JSON", () => {
    expect(decodeResourceJson({ call: "c", text: "<html>" })._unsafeUnwrapErr().code).toBe("PAYLOAD_UNREADABLE");
  });
});
