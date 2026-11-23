import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDeriveWithDeps } from "../../../../../cli/commands/derive/run.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { bronzeFile, silverIdentitiesPath, silverPeoplePath } from "../../../../../corpus/corpusPaths.js";
import { writeMemberRows } from "../../../../../corpus/members/store.js";
import type { MemberBronzeRow } from "../../../../../corpus/members/types.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { unwrap } from "../../../../../lib/result.js";
import type { IdentityRecord } from "../../../../../silver/identity.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../../../identityRosterFixture.js";
import { admittingSlotGuard, refusingSlotGuard } from "../../../../loadSlotFixture.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

const window = { since: "2026-01-01", until: "2026-02-01" };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const BRONZE: readonly CorpusRecord[] = [
  {
    author: "ada",
    container: "acme/web",
    kind: "pr",
    refs: [],
    source: "github",
    sourceId: "acme/web#1",
    text: "a github pr",
    tsIso: "2026-01-10T00:00:00Z",
    url: "https://example.test/1",
  },
  {
    author: "U1",
    container: "slack/c",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "s1",
    text: "a slack message",
    tsIso: "2026-01-11T00:00:00Z",
    url: "https://example.test/2",
  },
];

/** A temp home seeded with a two-source bronze corpus; the roster lives in the store, not here. */
function seedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-derive-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus", "bronze", "github"), { recursive: true });
  mkdirSync(join(home, "corpus", "bronze", "slack"), { recursive: true });
  writeFileSync(bronzeFile({ home, source: "github", window }), JSON.stringify(BRONZE[0]), "utf8");
  writeFileSync(bronzeFile({ home, source: "slack", window }), JSON.stringify(BRONZE[1]), "utf8");
  return home;
}

const ROSTER: readonly IdentityRecord[] = [
  {
    handle: "ada",
    id: "person:ada",
    identities: [
      { nativeId: "ada", source: "github" },
      { nativeId: "U1", source: "slack" },
    ],
    name: "Ada Lovelace",
  },
];

/** The store every home here reads, already holding {@link ROSTER} at revision 1. */
const identityRoster = memoryIdentityRosterPort({ records: ROSTER });

describe("runDeriveWithDeps — the machine's load slot", () => {
  it("REFUSES with the error exit and writes no silver when the machine's load slots are full", async () => {
    const home = seedHome();
    const code = await runDeriveWithDeps({
      argv: ["x", "y", "derive", "--home", home],
      identityRoster,
      guard: refusingSlotGuard({ pid: 4242 }),
      sink: () => {},
    });
    expect(code).toBe(EXIT_ERROR);
    expect(existsSync(silverIdentitiesPath({ home }))).toBe(false);
  });
});

describe("runDeriveWithDeps — identity resolution", () => {
  it("reads the off-repo roster and writes the merged person to silver/index/identities.json", async () => {
    const home = seedHome();
    const code = await runDeriveWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "derive", "--home", home],
      identityRoster,
      sink: () => {},
    });
    expect(code).toBe(EXIT_OK);
    const written = parseOwnJson<{ people: { id: string; confidence: string; identities: { source: string }[] }[] }>({
      text: readFileSync(silverIdentitiesPath({ home }), "utf8"),
    });
    expect(written.people).toHaveLength(1);
    expect(written.people[0]!.id).toBe("person:ada");
    expect(written.people[0]!.confidence).toBe("override");
    expect(written.people[0]!.identities.map((i) => i.source).toSorted()).toEqual(["github", "slack"]);
  });

  it("emits non-blocking progress lines for the resolution pass through the injected sink", async () => {
    const home = seedHome();
    const lines: string[] = [];
    await runDeriveWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "derive", "--home", home],
      identityRoster,
      sink: (line) => lines.push(line),
    });
    const parsed = lines.map((l) => parseOwnJson<{ type: string; phase: string; verb: string }>({ text: l }));
    expect(parsed.every((p) => p.type === "slopweaver.progress" && p.verb === "derive")).toBe(true);
    expect(parsed.some((p) => p.phase === "resolve-identities")).toBe(true);
  });

  it("streams the ordered derive stages (unthrottled) through the injected sink", async () => {
    const home = seedHome();
    const lines: string[] = [];
    await runDeriveWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "derive", "--home", home],
      identityRoster,
      sink: (line) => lines.push(line),
    });
    const phases = lines.map((l) => parseOwnJson<{ phase: string }>({ text: l }).phase);
    // Each stage is a distinct watchable step — the crawl-free synthesis lane runs unthrottled.
    expect(phases).toContain("read-corpus");
    expect(phases).toContain("build-directory");
    expect(phases).toContain("build-graphs");
    expect(phases).toContain("write-silver");
  });

  it("refuses, writing no silver, when the retired file it would import holds a malformed entry", async () => {
    const home = seedHome();
    writeFileSync(
      stateHomePaths({ home }).identityJson,
      JSON.stringify([{ id: "person:ada", identities: [{ nativeId: "ada", source: "github" }] }, { notAnId: true }]),
      "utf8",
    );
    const code = await runDeriveWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "derive", "--home", home],
      identityRoster: memoryIdentityRosterPort(),
      sink: () => {},
    });
    expect(code).toBe(EXIT_ERROR);
    expect(existsSync(silverIdentitiesPath({ home }))).toBe(false);
  });

  it("refuses, writing no silver, when the store cannot answer — never derives against no roster", async () => {
    const home = seedHome();
    const code = await runDeriveWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "derive", "--home", home],
      identityRoster: unavailableIdentityRosterPort(),
      sink: () => {},
    });
    expect(code).toBe(EXIT_ERROR);
    expect(existsSync(silverIdentitiesPath({ home }))).toBe(false);
  });

  it("writes nothing on --dry-run", async () => {
    const home = seedHome();
    const code = await runDeriveWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "derive", "--home", home, "--dry-run"],
      identityRoster,
      sink: () => {},
    });
    expect(code).toBe(EXIT_OK);
    expect(existsSync(silverIdentitiesPath({ home }))).toBe(false);
  });
});

/** A trusted member row for a source/id (a real personal email — the resolver's join key). */
function memberRow({
  source,
  nativeId,
  email,
}: {
  source: MemberBronzeRow["source"];
  nativeId: string;
  email: string;
}): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-07-20T00:00:00.000Z",
    identity: { email, emailNormalised: email.toLowerCase(), emailTrust: "trusted", name: nativeId, nativeId, source },
    profile: { active: true, bot: false },
    provenance: [`${source}.users`],
    raw: { id: nativeId },
    source,
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

describe("runDeriveWithDeps — member hydration feed (PR4.1)", () => {
  it("reads member bronze, auto-links the team by email with NO roster, and writes people.json", async () => {
    const home = seedHome();
    unwrap(
      writeMemberRows({
        home,
        rows: [memberRow({ email: "ada@example.com", nativeId: "U1", source: "slack" })],
        source: "slack",
      }),
    );
    unwrap(
      writeMemberRows({
        home,
        rows: [memberRow({ email: "ada@example.com", nativeId: "ada", source: "github" })],
        source: "github",
      }),
    );

    const code = await runDeriveWithDeps({
      guard: admittingSlotGuard,
      argv: ["x", "y", "derive", "--home", home],
      identityRoster: memoryIdentityRosterPort(),
      sink: () => {},
    });
    expect(code).toBe(EXIT_OK);

    const people = parseOwnJson<{
      people: { confidence: string; emails: { value: string }[]; identities: { source: string }[] }[];
    }>({ text: readFileSync(silverPeoplePath({ home }), "utf8") }).people;
    expect(people).toHaveLength(1);
    expect(people[0]!.confidence).toBe("email");
    expect(people[0]!.identities.map((i) => i.source).toSorted()).toEqual(["github", "slack"]);
    expect(people[0]!.emails).toEqual([{ sources: ["github", "slack"], trust: "trusted", value: "ada@example.com" }]);
  });
});
