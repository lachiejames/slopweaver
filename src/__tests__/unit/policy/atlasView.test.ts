// deleted-with-code: readMirrorAtlasView
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyVantaKindFile, initialVantaManifest, type VantaEntity } from "../../../atlas/vanta/model.js";
import { publishVantaAtlas, readVantaKindFile, vantaAtlasPaths } from "../../../atlas/vanta/store.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { apiDetail, readPolicyAtlasView } from "../../../policy/atlasView.js";

const AT = "2026-10-01T00:00:00.000Z";

/** One stored policy entity whose Manage-API channel carries `detail` in `state`. */
function entity({
  id,
  detail,
  state = "observed",
}: {
  id: string;
  detail: unknown;
  state?: "observed" | "stale";
}): VantaEntity {
  return {
    channels: {
      browser: null,
      "manage-api": { channel: "manage-api", detail, firstSeenAt: AT, lastSeenAt: AT, source: null, state },
    },
    financialDetail: null,
    id: `policy:${id}`,
    kind: "policy",
    providerId: id,
    sensitivity: null,
  };
}

describe("apiDetail", () => {
  it("returns an observed Manage-API detail by identity", () => {
    const detail = { id: "p1", name: "Access Control" };
    expect(apiDetail({ entity: entity({ detail, id: "p1" }) })).toBe(detail);
  });

  it("returns null for a stale Manage-API channel even though its last detail is intact", () => {
    const stale = entity({ detail: { id: "p1", name: "Access Control" }, id: "p1", state: "stale" });
    expect(apiDetail({ entity: stale })).toBeNull();
  });

  it("returns null for an entity only the browser channel has seen", () => {
    const observed = entity({ detail: { id: "p1" }, id: "p1" });
    const browserOnly: VantaEntity = {
      ...observed,
      channels: { browser: { ...observed.channels["manage-api"]!, channel: "browser" }, "manage-api": null },
    };
    expect(apiDetail({ entity: browserOnly })).toBeNull();
  });

  it("returns null for an observed channel whose detail is null", () => {
    expect(apiDetail({ entity: entity({ detail: null, id: "p1" }) })).toBeNull();
  });
});

describe("readPolicyAtlasView", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "atlas-view-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Publish one generation holding exactly these policy entities and no policy-document file. */
  function publish({ policies }: { policies: readonly VantaEntity[] }): void {
    unwrap(
      publishVantaAtlas({
        derivedFrom: null,
        files: { policy: { ...emptyVantaKindFile({ kind: "policy", updatedAt: AT }), entities: [...policies] } },
        manifest: initialVantaManifest({ updatedAt: AT }),
        paths: vantaAtlasPaths({ home }),
      }),
    );
  }

  it("refuses an atlas that holds no policy file, naming the sync to run", () => {
    expect(unwrapErr(readPolicyAtlasView({ home }))).toEqual([
      "the Vanta atlas holds no policies — run: slopweaver atlas vanta sync",
    ]);
  });

  it("passes an unreadable policy kind file's refusal through unchanged", () => {
    const paths = vantaAtlasPaths({ home });
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.kinds.policy, "{not json\n", "utf8");
    const own = unwrapErr(readVantaKindFile({ kind: "policy", paths }));

    expect(own.length).toBeGreaterThan(0);
    expect(unwrapErr(readPolicyAtlasView({ home }))).toEqual(own);
  });

  it("reads policies from an atlas that holds no policy-document file", () => {
    publish({
      policies: [
        entity({ detail: { id: "p1", latestVersion: { status: "APPROVED" }, name: "Access Control" }, id: "p1" }),
        entity({ detail: { id: "p2", name: "Backup" }, id: "p2" }),
      ],
    });

    expect(unwrap(readPolicyAtlasView({ home }))).toEqual({
      policies: [
        { name: "Access Control", policyId: "p1" },
        { name: "Backup", policyId: "p2" },
      ],
    });
  });

  it("omits policies missing a required non-empty field, stale ones, and non-record details, beside one valid near miss", () => {
    publish({
      policies: [
        entity({ detail: { id: "p-ok", name: "Kept" }, id: "p-ok" }),
        entity({ detail: { id: "", name: "Blank id" }, id: "p-blank" }),
        entity({ detail: { id: "p-noname" }, id: "p-noname" }),
        entity({ detail: { id: "p-stale", name: "Stale" }, id: "p-stale", state: "stale" }),
        entity({ detail: ["not", "a", "record"], id: "p-array" }),
      ],
    });

    expect(unwrap(readPolicyAtlasView({ home })).policies.map((policy) => policy.policyId)).toEqual(["p-ok"]);
  });
});
