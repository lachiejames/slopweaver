/**
 * Every declared exclusion in this build, checked against the contract the owner's rule made a
 * type — and the census of what that rule currently refuses.
 *
 * ## Why this walks the tree rather than taking a list
 *
 * The failure being closed is a descriptor that declares an exclusion nobody grounded, so a hand-written
 * list of atlases to check is the same class of miss one directory later. This DISCOVERS the atlases the
 * way `unit/admit/writePolicyRegister.test.ts` does, for the reason that file states: a directory on disk
 * cannot hide from a glob, and a descriptor spells its `platform` as a shared constant, so the modules have
 * to be imported rather than text-scraped.
 *
 * ## The counts are a census, not a target
 *
 * The refusal census pins what the tree carries so that a NEW unmeasured or unfetched exclusion fails this
 * file rather than joining a backlog quietly. Landing a real measurement against one of them fails it too —
 * deliberately, because that is the moment to move the number down and say in the diff that the debt shrank.
 * It has moved down once, when Datadog's occurrence-body row was weighed. Re-derive
 * the whole register, in the order the owner ruled it should be worked, with `slopweaver atlas backlog`.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ATLAS_EXCLUSION_GROUNDS,
  type AtlasDescriptor,
  type AtlasExclusion,
  atlasDescriptorSchema,
  isRefusedExclusion,
  withholdsRecords,
} from "../../../../atlas/kit/contract.js";
import { isRecord } from "../../../../lib/parsers.js";

/** Where the per-platform atlas modules live, relative to the repository root. */
const ATLAS_DIR = "src/atlas";

/** Every directory under `src/atlas` that ships a `descriptor.ts`. */
function atlasDirs(): readonly string[] {
  return readdirSync(ATLAS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ATLAS_DIR, entry.name, "descriptor.ts")))
    .map((entry) => entry.name);
}

/**
 * Import every atlas descriptor and hand back the object each module exports.
 *
 * @returns one descriptor per module found, in directory order
 */
async function declaredDescriptors(): Promise<readonly { dir: string; descriptor: AtlasDescriptor }[]> {
  const found: { dir: string; descriptor: AtlasDescriptor }[] = [];
  for (const dir of atlasDirs()) {
    // `@vite-ignore` because the specifier is computed — the list is discovered, never written down.
    const module: Record<string, unknown> = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ATLAS_DIR, dir, "descriptor.ts")).href
    );
    for (const value of Object.values(module)) {
      if (!isRecord(value) || !Array.isArray(value["excludes"])) {
        continue;
      }
      found.push({ descriptor: value as unknown as AtlasDescriptor, dir });
      break;
    }
  }
  return found;
}

/** Every declared exclusion in the build, flattened. */
async function allExclusions(): Promise<readonly { dir: string; exclusion: AtlasExclusion }[]> {
  const descriptors = await declaredDescriptors();
  return descriptors.flatMap(({ dir, descriptor }) => descriptor.excludes.map((exclusion) => ({ dir, exclusion })));
}

describe("the exclusion ground vocabulary", () => {
  it("is the closed set the rule split `excludes` into, in the order the doc's table lists them", () => {
    expect([...ATLAS_EXCLUSION_GROUNDS]).toEqual([
      "shape-index",
      "disclosure-bound",
      "payload-not-map",
      "held-elsewhere",
      "never-acted",
      "names-not-values",
      "secret-material",
      "out-of-platform",
      "claim-not-made",
      "not-fetched",
    ]);
  });

  it("withholds a record on exactly four of the ten grounds", () => {
    const withholding = ATLAS_EXCLUSION_GROUNDS.filter((ground) =>
      withholdsRecords({ exclusion: { because: "x", ground } as AtlasExclusion }),
    );
    expect([...withholding]).toEqual(["shape-index", "disclosure-bound", "payload-not-map", "not-fetched"]);
  });

  it("refuses a shape-index claim with no measurement behind it, and accepts one with", () => {
    expect(
      isRefusedExclusion({
        exclusion: {
          because: "the audit stream",
          ground: "shape-index",
          volume: { basis: "unmeasured", unboundedBecause: "emitted per event", wouldBeMeasuredBy: "one paged read" },
        },
      }),
    ).toBe(true);
    expect(
      isRefusedExclusion({
        exclusion: {
          because: "the audit stream",
          ground: "shape-index",
          volume: {
            basis: "measured",
            establishedBy: "slopweaver atlas jumpcloud coverage --kind commandresults",
            magnitude: "54,321 rows",
            unboundedBecause: "emitted per event",
          },
        },
      }),
    ).toBe(false);
  });

  it("refuses `not-fetched` outright, since nobody having been to get it is missing coverage", () => {
    expect(
      isRefusedExclusion({
        exclusion: { because: "modern Rulesets", ground: "not-fetched", wouldBeClosedBy: "the Rulesets reads" },
      }),
    ).toBe(true);
  });
});

describe("the schema is what makes a bare exclusion impossible", () => {
  it("rejects a plain string, which is what all 228 entries were before the rule landed", () => {
    const base = {
      excludes: ["modern account and zone Rulesets"],
      kinds: ["zone"],
      platform: "example",
      question: "what does this platform hold",
      resyncCommand: "slopweaver atlas example sync",
      surfaces: [
        {
          acquisition: "api",
          denominator: { because: "a fixture surface with no provider catalogue", known: false },
          documented: true,
          name: "rest",
          role: "authoritative",
          status: "filled",
          unfilledBecause: null,
        },
      ],
      visibilityScope: "configured-token-visible",
      writePolicy: "refuse-every-write",
    };
    expect(atlasDescriptorSchema.safeParse(base).success).toBe(false);
    const grounded = {
      ...base,
      excludes: [
        { because: "modern account and zone Rulesets", ground: "not-fetched", wouldBeClosedBy: "the Rulesets reads" },
      ],
    };
    expect(atlasDescriptorSchema.safeParse(grounded).success).toBe(true);
  });

  it("rejects a shape-index ground with no volume at all", () => {
    const parsed = atlasDescriptorSchema.safeParse({
      excludes: [{ because: "the audit stream", ground: "shape-index" }],
      kinds: ["zone"],
      platform: "example",
      question: "what does this platform hold",
      resyncCommand: "slopweaver atlas example sync",
      surfaces: [
        {
          acquisition: "api",
          denominator: { because: "a fixture surface with no provider catalogue", known: false },
          documented: true,
          name: "rest",
          role: "authoritative",
          status: "filled",
          unfilledBecause: null,
        },
      ],
      visibilityScope: "configured-token-visible",
      writePolicy: "refuse-every-write",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("every descriptor this build ships", () => {
  it("finds the atlases (a glob that matched nothing would pass every test below vacuously)", async () => {
    expect((await declaredDescriptors()).length).toBe(34);
  });

  it("parses against the contract, so no atlas can carry an ungrounded exclusion", async () => {
    const failures = (await declaredDescriptors())
      .filter(({ descriptor }) => !atlasDescriptorSchema.safeParse(descriptor).success)
      .map(({ dir }) => dir);
    expect(failures).toEqual([]);
  });

  it("declares 214 exclusions in total — 227 plus the Aether atlas's 6, less the Docker Hub atlas's 8, the 33 of the five retired atlases, plus the Google SecOps atlas's 5, the Trelica atlas's measured API-key tail, the Make atlas's 6 and the KnowBe4 atlas's 5, and the Trelica atlas's 5 never-held families", async () => {
    expect((await allExclusions()).length).toBe(214);
  });

  it("refuses 63 rows: 34 not-fetched and 29 unmeasured volume claims, after the Aether atlas added 2 not-fetched, the Docker Hub atlas took 1 unmeasured claim with it, the five retired atlases took 4 not-fetched and 3 unmeasured, the Google SecOps atlas added 1 not-fetched, and the Make atlas added 1 and the Trelica atlas 3 not-fetched", async () => {
    const all = await allExclusions();
    const notFetched = all.filter(({ exclusion }) => exclusion.ground === "not-fetched");
    const unmeasured = all.filter(
      ({ exclusion }) => exclusion.ground === "shape-index" && exclusion.volume.basis === "unmeasured",
    );
    expect(notFetched.length).toBe(34);
    expect(unmeasured.length).toBe(29);
    expect(all.filter(({ exclusion }) => isRefusedExclusion({ exclusion })).length).toBe(63);
  });

  it("carries a magnitude and a reproduction on Datadog's weighed row, which is what took the census down", async () => {
    const datadog = (await allExclusions()).filter(
      ({ dir, exclusion }) => dir === "datadog" && exclusion.ground === "shape-index",
    );
    expect(datadog.length).toBe(1);
    const only = datadog[0]!.exclusion;
    expect(only.ground).toBe("shape-index");
    expect(isRefusedExclusion({ exclusion: only })).toBe(false);
  });

  it("counts Vanta's policy body among the not-fetched rows, on the ground the gate refuses", async () => {
    const vanta = (await allExclusions()).filter(
      ({ dir, exclusion }) => dir === "vanta" && exclusion.ground === "not-fetched",
    );
    expect(vanta.map(({ exclusion }) => exclusion.because.slice(0, 24))).toEqual([
      "audits and contracts, ea",
      "61 of the 107 GET operat",
    ]);
    expect(vanta.filter(({ exclusion }) => isRefusedExclusion({ exclusion })).length).toBe(2);
  });

  it("names what would close every refused row, so a refusal arrives with its own remedy", async () => {
    const all = await allExclusions();
    const silent = all
      .filter(({ exclusion }) => exclusion.ground === "not-fetched" && exclusion.wouldBeClosedBy.length === 0)
      .map(({ dir }) => dir);
    expect(silent).toEqual([]);
  });

  it("names an owner ruling on every disclosure-bound ground, which is the only one resting on a decision", async () => {
    const bound = (await allExclusions()).filter(({ exclusion }) => exclusion.ground === "disclosure-bound");
    expect(bound.map(({ dir }) => dir)).toEqual(["hex", "hex", "jam"]);
    expect(
      bound.filter(({ exclusion }) => exclusion.ground === "disclosure-bound" && exclusion.ruledBy === ""),
    ).toEqual([]);
  });

  it("names a holder on every held-elsewhere ground, because a state that cannot say WHERE is unfalsifiable", async () => {
    const held = (await allExclusions()).filter(({ exclusion }) => exclusion.ground === "held-elsewhere");
    expect(held.length).toBe(13);
    expect(held.filter(({ exclusion }) => exclusion.ground === "held-elsewhere" && exclusion.holder === "")).toEqual(
      [],
    );
  });
});
