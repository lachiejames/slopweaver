/*
 * `runFlatKinds`, the loop over every registered flat kind, driven directly over the all-kinds `fetch` stub
 * and a throwaway home: every kind is attempted in registry order into the shared accumulators, and a stored
 * kind file that cannot be read stops the loop before anything is appended.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { flatKindSpecs } from "../../../../../atlas/cloudflare/flatKindSpecs.js";
import { runFlatKinds } from "../../../../../atlas/cloudflare/flatKinds.js";
import type { CloudflareSyncKindOutcome } from "../../../../../atlas/cloudflare/kindFold.js";
import {
  type CloudflareKind,
  type CloudflareKindFile,
  initialCloudflareManifest,
} from "../../../../../atlas/cloudflare/model.js";
import { cloudflareAtlasPaths } from "../../../../../atlas/cloudflare/store.js";
import type { RichProgressEmitter } from "../../../../../lib/progressRichEmitter.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { ACCOUNT_ID, AT, outcomeFor, SELECTION } from "./fixtures.js";
import { allKindsFetch, freshHome, removeFixtureHomes } from "./harness.js";

/** A progress emitter that records the title of every item it is told the loop is reading. */
function recordingProgress({ titles }: { titles: (string | undefined)[] }): RichProgressEmitter {
  return {
    close: () => undefined,
    emit: (event) => {
      titles.push(event.currentItem?.title);
    },
    finish: () => undefined,
    noteStall: () => undefined,
  };
}

describe("runFlatKinds", () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });
  afterEach(removeFixtureHomes);

  it("attempts every flat kind in registry order, filling each accumulator and stamping the manifest", async () => {
    const files: Partial<Record<CloudflareKind, CloudflareKindFile>> = {};
    const outcomes: CloudflareSyncKindOutcome[] = [];
    const titles: (string | undefined)[] = [];
    const result = await runFlatKinds({
      accountId: ACCOUNT_ID,
      at: AT,
      client: createCloudflareClient({
        apiToken: "t",
        fetchImpl: allKindsFetch({ zones: [{ id: "z1", name: "one.test" }] }),
        maxRetries: 0,
      }),
      deepZoneId: SELECTION.deepZone.id,
      files,
      manifest: initialCloudflareManifest({ updatedAt: AT }),
      outcomes,
      paths: cloudflareAtlasPaths({ home }),
      progress: recordingProgress({ titles }),
    });

    const manifest = unwrap(result);
    const registryOrder = flatKindSpecs({ deepZoneId: SELECTION.deepZone.id }).map((spec) => spec.kind);
    expect(registryOrder.length).toBe(53);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(registryOrder);
    expect(titles).toEqual(registryOrder);
    expect(Object.keys(files).toSorted()).toEqual(registryOrder.toSorted());
    expect(outcomeFor({ kind: "zone", kinds: outcomes })).toEqual({
      complete: true,
      entityCount: 1,
      kind: "zone",
      reasons: [],
    });
    expect(files.zone!.entities).toHaveLength(1);
    expect(manifest.kinds.zone.lastAttempt).toEqual({ at: AT, outcome: "ok", reasons: [] });
  });

  it("stops at a stored kind file it cannot read, appending nothing", async () => {
    const paths = cloudflareAtlasPaths({ home });
    mkdirSync(dirname(paths.kinds.zone), { recursive: true });
    writeFileSync(paths.kinds.zone, "not a kind file\n");
    const files: Partial<Record<CloudflareKind, CloudflareKindFile>> = {};
    const outcomes: CloudflareSyncKindOutcome[] = [];
    const titles: (string | undefined)[] = [];
    const result = await runFlatKinds({
      accountId: ACCOUNT_ID,
      at: AT,
      client: createCloudflareClient({ apiToken: "t", fetchImpl: allKindsFetch({}), maxRetries: 0 }),
      deepZoneId: SELECTION.deepZone.id,
      files,
      manifest: initialCloudflareManifest({ updatedAt: AT }),
      outcomes,
      paths,
      progress: recordingProgress({ titles }),
    });

    expect(unwrapErr(result).join("\n")).toContain("zone");
    expect(titles).toEqual(["zone"]);
    expect(outcomes).toEqual([]);
    expect(files).toEqual({});
  });
});
