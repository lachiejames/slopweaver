import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encode } from "turbo-stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publishNxCloudBrowserSurface } from "../../../../atlas/nxCloud/browserSurface.js";
import type { NxCloudTransport } from "../../../../atlas/nxCloud/client.js";
import { NX_CLOUD_CALLS } from "../../../../atlas/nxCloud/inventory.js";
import { type NxCloudAtlasPaths, nxCloudAtlasPaths } from "../../../../atlas/nxCloud/store.js";
import { readNxCloudCalls, storedNxCloudScopes } from "../../../../atlas/nxCloud/sync.js";
import { resolveNxCloudScopes } from "../../../../cli/commands/nxCloudAtlas/scope.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { memoryRecordedProfilePort } from "../../../recordedProfileFixture.js";

const SCOPE = { orgId: "o1", workspaceId: "w1" };

let home: string;
let paths: NxCloudAtlasPaths;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-nx-cloud-sync-"));
  paths = nxCloudAtlasPaths({ home });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One read's bytes: the read that ends the stream carries none, so it contributes an empty chunk. */
function chunkOf({ value }: { value: Uint8Array | undefined }): Uint8Array {
  if (value === undefined) {
    return new Uint8Array();
  }
  return value;
}

/** Encode a value the way the platform's own single fetch does. */
async function singleFetchText({ value }: { value: unknown }): Promise<string> {
  const chunks: Buffer[] = [];
  const reader = encode(value).getReader();
  let done = false;
  while (!done) {
    const read = await reader.read();
    done = read.done;
    chunks.push(Buffer.from(chunkOf({ value: read.value })));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A transport that answers every call with the same payload, and records what it was asked for. */
function fakeTransport({
  body,
  contentType = "text/x-script",
  statusCode = 200,
}: {
  body: string;
  contentType?: string;
  statusCode?: number;
}): { transport: NxCloudTransport; asked: string[] } {
  const asked: string[] = [];
  const transport: NxCloudTransport = async ({ url }) => {
    asked.push(url);
    return ok({ body, contentType, statusCode, url });
  };
  return { asked, transport };
}

const DEPS = { nowIso: (): string => "2026-09-05T00:00:00.000Z", profiles: memoryRecordedProfilePort() };

describe("readNxCloudCalls", () => {
  it("makes every call the inventory declares, in inventory order", async () => {
    const { transport, asked } = fakeTransport({ body: "[]" });
    await readNxCloudCalls({ cookieHeader: "c", deps: { ...DEPS, transport }, scope: SCOPE });
    expect(asked.length).toBe(NX_CLOUD_CALLS.length);
  });

  it("decodes a single-fetch payload into the loader blocks it carries", async () => {
    const body = await singleFetchText({ value: { "routes/_auth": { data: { ok: true } } } });
    const { transport } = fakeTransport({ body });
    const outcomes = await readNxCloudCalls({ cookieHeader: "c", deps: { ...DEPS, transport }, scope: SCOPE });
    expect(outcomes[0]!.decoded).toEqual({ "routes/_auth": { data: { ok: true } } });
  });

  it("decodes an ordinary JSON resource-route body", async () => {
    const { transport } = fakeTransport({ body: '{"a":1}', contentType: "application/json" });
    const outcomes = await readNxCloudCalls({ cookieHeader: "c", deps: { ...DEPS, transport }, scope: SCOPE });
    expect(outcomes[0]!.decoded).toEqual({ a: 1 });
  });

  it("does not decode a refused response at all, so a 403 never becomes an empty record", async () => {
    const { transport } = fakeTransport({ body: "<html>", contentType: "text/html", statusCode: 403 });
    const outcomes = await readNxCloudCalls({ cookieHeader: "c", deps: { ...DEPS, transport }, scope: SCOPE });
    expect([outcomes[0]!.decoded, outcomes[0]!.failure]).toEqual([null, null]);
  });

  it("reports a 200 whose content type is neither shape, rather than guessing at it", async () => {
    const { transport } = fakeTransport({ body: "<html>", contentType: "text/html" });
    const outcomes = await readNxCloudCalls({ cookieHeader: "c", deps: { ...DEPS, transport }, scope: SCOPE });
    expect(outcomes[0]!.failure!.code).toBe("PAYLOAD_UNREADABLE");
  });

  it("records the status every call answered with", async () => {
    const { transport } = fakeTransport({ body: "[]", statusCode: 500 });
    const outcomes = await readNxCloudCalls({ cookieHeader: "c", deps: { ...DEPS, transport }, scope: SCOPE });
    expect(outcomes.map((outcome) => outcome.response!.statusCode)).toEqual(NX_CLOUD_CALLS.map(() => 500));
  });
});

describe("storedNxCloudScopes", () => {
  it("finds nothing in an atlas that has published nothing", () => {
    expect(unwrap(storedNxCloudScopes({ paths }))).toEqual([]);
  });
});

describe("resolveNxCloudScopes", () => {
  it("takes the pair given on the command line", () => {
    const scopes = resolveNxCloudScopes({ orgId: "o1", paths, workspaceId: "w1" });
    expect(unwrap(scopes)).toEqual([{ orgId: "o1", workspaceId: "w1" }]);
  });

  it("refuses one flag without the other, because half a scope names nothing", () => {
    const refused = resolveNxCloudScopes({ orgId: "o1", paths, workspaceId: undefined });
    expect(unwrapErr(refused)).toEqual([
      "--org and --workspace are given together or not at all: one without the other names nothing",
    ]);
  });

  it("explains where to find both ids when the atlas holds none", () => {
    const refused = resolveNxCloudScopes({ orgId: undefined, paths, workspaceId: undefined });
    expect(refused._unsafeUnwrapErr().join(" ")).toContain("nxCloudId");
  });

  it("reads the pair back out of a published generation, so a later run needs no flags", () => {
    unwrap(
      publishNxCloudBrowserSurface({
        at: "2026-09-05T00:00:00.000Z",
        denylist: [],
        paths,
        scope: SCOPE,
        walk: { declaredRoutes: [], routes: [], sessionLost: false },
      }),
    );
    // The browser channel writes no workspace rows, so this asserts the honest thing: a walk alone does not
    // teach the atlas its scope, and the sync is what stores it.
    const refused = resolveNxCloudScopes({ orgId: undefined, paths, workspaceId: undefined });
    expect(unwrapErr(refused)).toEqual([
      "no Nx Cloud organisation and workspace to act on, and the stored generation holds none either",
      "pass --org <id> --workspace <id> once; later runs read the pair back out of the generation",
      "both ids are in any cloud.nx.app pipeline URL, and the workspace id is the `nxCloudId` in nx.json",
    ]);
  });
});
