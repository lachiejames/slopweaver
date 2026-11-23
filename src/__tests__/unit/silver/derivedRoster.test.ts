import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { silverIdentitiesPath, sourceWatermarkPath } from "../../../corpus/corpusPaths.js";
import { freshnessStampPath, observeSources, writeFreshnessStamp } from "../../../silver/derive/stamp.js";
import { parseDerivedRoster, parseDerivedRosterFile } from "../../../silver/derivedRoster.js";
import { loadDerivedRoster } from "../../../silver/loadDerivedRoster.js";

/** The persisted artifact shape, exactly as `derive` writes it. */
const ARTIFACT = {
  candidates: [{ confidence: "name", personIds: ["p-one", "p-two"], reason: "shared display name" }],
  conflicts: [],
  people: [
    {
      confidence: "email",
      displayName: "Ada L",
      id: "p-ada",
      identities: [
        { handle: "ada-l-gh", nativeId: "ada-l-gh", source: "github" },
        { email: "a@example.test", handle: "ada-l", nativeId: "U_fake_ada", source: "slack" },
      ],
      kind: "person",
      kindReasons: [],
    },
  ],
};

describe("parseDerivedRoster", () => {
  it("parses the people and their per-source identities", () => {
    const roster = parseDerivedRoster({ content: JSON.stringify(ARTIFACT) });

    expect(roster.people.length).toBe(1);
    expect(roster.people[0]!.id).toBe("p-ada");
    expect(roster.people[0]!.confidence).toBe("email");
    expect(roster.people[0]!.kind).toBe("person");
    expect(roster.people[0]!.identities.length).toBe(2);
    expect(roster.people[0]!.identities[1]).toEqual({
      email: "a@example.test",
      handle: "ada-l",
      nativeId: "U_fake_ada",
      source: "slack",
    });
  });

  it("collects the HELD candidate person ids, which exist only to explain a refusal", () => {
    const roster = parseDerivedRoster({ content: JSON.stringify(ARTIFACT) });

    expect([...roster.heldPersonIds].toSorted()).toEqual(["p-one", "p-two"]);
  });

  it("degrades garbled JSON to an empty roster instead of throwing", () => {
    expect(parseDerivedRoster({ content: "{not json" }).people).toEqual([]);
  });

  it("degrades a non-object and a missing people array to an empty roster", () => {
    expect(parseDerivedRoster({ content: "[]" }).people).toEqual([]);
    expect(parseDerivedRoster({ content: '{"candidates":[]}' }).people).toEqual([]);
  });

  it("skips a malformed person entry rather than dropping the whole roster", () => {
    const roster = parseDerivedRoster({
      content: JSON.stringify({ people: [{ id: "" }, { nope: true }, ...ARTIFACT.people] }),
    });

    expect(roster.people.length).toBe(1);
    expect(roster.people[0]!.id).toBe("p-ada");
  });

  it("defaults a missing confidence to single-source and leaves kind absent", () => {
    const roster = parseDerivedRoster({ content: JSON.stringify({ people: [{ id: "p-x", identities: [] }] }) });

    expect(roster.people[0]!.confidence).toBe("single-source");
    expect(roster.people[0]!.kind).toBe(undefined);
  });
});

/** Write a file, creating its parents. */
function writeAt({ path, content }: { path: string; content: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("loadDerivedRoster — the real fixture round-trip", () => {
  it("reads the artifact from the path derive actually writes it to", () => {
    const home = mkdtempSync(join(tmpdir(), "pr5-derived-"));
    fixtureDirs.push(home);
    writeAt({ content: JSON.stringify(ARTIFACT), path: silverIdentitiesPath({ home }) });

    const loaded = loadDerivedRoster({ home, rosterRevision: null });

    expect(loaded.roster.people.length).toBe(1);
  });

  it("returns an empty roster, verdict ABSENT, when derive has never run", () => {
    const home = mkdtempSync(join(tmpdir(), "pr5-derived-none-"));
    fixtureDirs.push(home);

    const loaded = loadDerivedRoster({ home, rosterRevision: null });

    expect(loaded.roster.people).toEqual([]);
    expect(loaded.freshness).toEqual({ kind: "absent", why: "it has never been derived" });
  });

  it("reads an artifact with no freshness stamp beside it as unusable, not as fresh", () => {
    const home = mkdtempSync(join(tmpdir(), "pr5-derived-unstamped-"));
    fixtureDirs.push(home);
    writeAt({ content: JSON.stringify(ARTIFACT), path: silverIdentitiesPath({ home }) });

    expect(loadDerivedRoster({ home, rosterRevision: null }).freshness).toEqual({
      kind: "absent",
      why: "it carries no freshness stamp, so what it was derived from is unknowable",
    });
  });

  it("sees a per-source watermark written AFTER the stamp as a stale roster", () => {
    const home = mkdtempSync(join(tmpdir(), "pr5-derived-stale-"));
    fixtureDirs.push(home);
    writeAt({
      content: JSON.stringify({ ...ARTIFACT, observedAtIso: "2026-08-20T18:47:58.000Z" }),
      path: silverIdentitiesPath({ home }),
    });
    writeFreshnessStamp({
      artefacts: null,
      derivedAtIso: "2026-08-20T18:48:58.000Z",
      home,
      observation: observeSources({ home, rosterRevision: null }),
      observedAtIso: "2026-08-20T18:47:58.000Z",
    });
    writeAt({
      content: JSON.stringify({ cursor: "2026-08-22T10:58:40Z" }),
      path: sourceWatermarkPath({ home, source: "slack" }),
    });

    expect(loadDerivedRoster({ home, rosterRevision: null }).freshness).toEqual({
      changed: [{ reasons: ["resume cursor (none) → 2026-08-22T10:58:40Z"], source: "slack" }],
      derivedAtIso: "2026-08-20T18:48:58.000Z",
      kind: "stale",
    });
  });

  it("is FRESH when the stamp was written from the same state the reader observes", () => {
    const home = mkdtempSync(join(tmpdir(), "pr5-derived-fresh-"));
    fixtureDirs.push(home);
    writeAt({
      content: JSON.stringify({ ...ARTIFACT, observedAtIso: "2026-08-22T10:59:00.000Z" }),
      path: silverIdentitiesPath({ home }),
    });
    writeAt({
      content: JSON.stringify({ cursor: "2026-08-22T10:58:40Z" }),
      path: sourceWatermarkPath({ home, source: "slack" }),
    });
    writeFreshnessStamp({
      artefacts: null,
      derivedAtIso: "2026-08-22T11:00:00.000Z",
      home,
      observation: observeSources({ home, rosterRevision: null }),
      observedAtIso: "2026-08-22T10:59:00.000Z",
    });

    expect(loadDerivedRoster({ home, rosterRevision: null }).freshness).toEqual({ kind: "fresh" });
  });

  it("reads a roster beside a stamp from a DIFFERENT derive as unusable, even when nothing has moved", () => {
    // Two derives at once: the later-finishing one overwrote the roster while the other's stamp still stood.
    const home = mkdtempSync(join(tmpdir(), "pr5-derived-unpaired-"));
    fixtureDirs.push(home);
    writeAt({
      content: JSON.stringify({ ...ARTIFACT, observedAtIso: "2026-08-22T10:58:00.000Z" }),
      path: silverIdentitiesPath({ home }),
    });
    writeFreshnessStamp({
      artefacts: null,
      derivedAtIso: "2026-08-22T11:00:00.000Z",
      home,
      observation: observeSources({ home, rosterRevision: null }),
      observedAtIso: "2026-08-22T10:59:00.000Z",
    });

    const loaded = loadDerivedRoster({ home, rosterRevision: null });

    expect(loaded.freshness).toEqual({
      kind: "absent",
      why:
        "its freshness stamp was written by a different derive than the roster beside it, so what the roster " +
        "was derived from is unknowable",
    });
    expect(loaded.roster.people[0]!.id).toBe("p-ada");
  });

  it("pairs a roster and a stamp that both predate the observation instant, rather than re-deriving", () => {
    const home = mkdtempSync(join(tmpdir(), "pr5-derived-legacy-"));
    fixtureDirs.push(home);
    writeAt({ content: JSON.stringify(ARTIFACT), path: silverIdentitiesPath({ home }) });
    writeAt({
      content: JSON.stringify({
        ...observeSources({ home, rosterRevision: null }),
        derivedAtIso: "2026-08-22T11:00:00.000Z",
        version: 1,
      }),
      path: freshnessStampPath({ home }),
    });

    expect(loadDerivedRoster({ home, rosterRevision: null }).freshness).toEqual({ kind: "fresh" });
  });
});

describe("parseDerivedRosterFile", () => {
  it("reads the writing derive's observation instant beside the roster", () => {
    const file = parseDerivedRosterFile({
      content: JSON.stringify({ ...ARTIFACT, observedAtIso: "2026-08-22T10:59:00.000Z" }),
    });

    expect(file.observedAtIso).toBe("2026-08-22T10:59:00.000Z");
    expect(file.roster.people[0]!.id).toBe("p-ada");
  });

  it("answers null for a file written before the instant existed, and for an empty one", () => {
    expect(parseDerivedRosterFile({ content: JSON.stringify(ARTIFACT) }).observedAtIso).toBe(null);
    expect(parseDerivedRosterFile({ content: JSON.stringify({ ...ARTIFACT, observedAtIso: "" }) }).observedAtIso).toBe(
      null,
    );
    expect(parseDerivedRosterFile({ content: "{not json" }).observedAtIso).toBe(null);
  });
});
