/**
 * The `drive` noun's manifest: no verb writes to a Drive. `connect` stores a credential under the home (local-state),
 * `drives`, `list` and `read` are external reads, and only `read` is no-args-safe — a bare `list` or `drives` is a valid
 * whole-Drive read. That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { driveManifest } from "../../../../cli/manifests/drive.js";

import { classificationsOf } from "./_classification.js";

describe("driveManifest", () => {
  it("declares exactly `connect`, `drives`, `list` and `read`", () => {
    expect(Object.keys(driveManifest).toSorted()).toEqual(["connect", "drives", "list", "read"]);
  });

  it("classifies `connect` local-state, the three reads external-read, and only `read` dry-parse-safe", () => {
    expect(classificationsOf({ manifest: driveManifest })).toEqual({
      connect: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      drives: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      list: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      read: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
    });
  });
});
