import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { ChatgptArchiveDeps } from "../../../../corpus/chatgpt/archive.js";
import { ChatgptExportErrors } from "../../../../corpus/chatgpt/errors.js";
import { importChatgptExport } from "../../../../corpus/chatgpt/exportStore.js";
import { writeLiveSnapshot } from "../../../../corpus/chatgpt/liveSnapshotWrite.js";
import { err, unwrap } from "../../../../lib/result.js";
import { buildResyncPolicies } from "../../../../live/resync/policy.js";
import {
  atlasResyncInputs,
  corpusResyncInputs,
  type DeclaredOwner,
  orgFromDeclaredOwners,
  readResyncRoster,
  tickResyncRecipeIds,
} from "../../../../live/resync/roster.js";
import { resyncTargetLabel } from "../../../../live/resync/target.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { chatId, FUTURE, syntheticExportAt } from "../../../chatgptFixture.js";
import { UNPROTECTED } from "../../../noProtection.js";
import { gitInTemp } from "../../../tempGitRepo.js";

const CHATGPT_FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

/** Archive edges that are never reached: the fixture is a directory, not a zip. */
const NO_ZIP: ChatgptArchiveDeps = {
  extractZipMember: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
  listZip: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
};

const owner = ({ name }: { readonly name: string }): DeclaredOwner => ({ kind: "owner", owner: name });

describe("orgFromDeclaredOwners", () => {
  it("names the one organisation every declared checkout shares", () => {
    const read = orgFromDeclaredOwners({ owners: [owner({ name: "acme" }), owner({ name: "acme" })] });
    expect(read.org).toBe("acme");
    expect(read.problems).toEqual([]);
  });

  it("keeps the first spelling when owners differ only by case", () => {
    const read = orgFromDeclaredOwners({ owners: [owner({ name: "Acme" }), owner({ name: "acme" })] });
    expect(read.org).toBe("Acme");
    expect(read.problems).toEqual([]);
  });

  it("REFUSES rather than crawling one of two organisations, naming both", () => {
    const read = orgFromDeclaredOwners({ owners: [owner({ name: "acme" }), owner({ name: "other-org" })] });
    expect(read.org).toBe(null);
    expect(read.problems.length).toBe(1);
    expect(read.problems[0]!).toContain("acme");
    expect(read.problems[0]!).toContain("other-org");
    expect(read.problems[0]!).toContain("silently skip the rest");
  });

  it("names the remedy when nothing is declared at all", () => {
    const read = orgFromDeclaredOwners({ owners: [] });
    expect(read.org).toBe(null);
    expect(read.problems.length).toBe(1);
    expect(read.problems[0]!).toContain("mainCheckouts");
  });

  it("reports an unreadable checkout by path and still names the organisation the others share", () => {
    const read = orgFromDeclaredOwners({
      owners: [{ kind: "unreadable", path: "/tmp/nope", why: "no `origin` git remote found" }, owner({ name: "acme" })],
    });
    expect(read.org).toBe("acme");
    expect(read.problems.length).toBe(1);
    expect(read.problems[0]!).toContain("/tmp/nope");
    expect(read.problems[0]!).toContain("origin");
  });

  it("names no organisation when every declared checkout is unreadable", () => {
    const read = orgFromDeclaredOwners({
      owners: [{ kind: "unreadable", path: "/tmp/a", why: "broken" }],
    });
    expect(read.org).toBe(null);
    expect(read.problems.length).toBe(2);
    expect(read.problems[0]!).toContain("/tmp/a");
    expect(read.problems[1]!).toContain("mainCheckouts");
  });
});

describe("the atlas cadence table this build applies", () => {
  // The pin for the cadence page (`$SLOPWEAVER_HOME/pages/scheduled-asks-cadence/index.html`): a descriptor
  // changing its window or its acquisition moves a row here, where the diff shows it.
  it("derives each atlas's cadence from its declared window", async () => {
    const roster = buildResyncPolicies({ atlases: await atlasResyncInputs(), corpus: [] });
    const byCadence = ({ cadence }: { readonly cadence: string }): readonly string[] =>
      roster.policies
        .filter((policy) => policy.cadence === cadence)
        .map((policy) => resyncTargetLabel({ target: policy.target }));
    expect(roster.problems).toEqual([]);
    expect(byCadence({ cadence: "0 */4 * * *" })).toEqual(["atlas vanta"]);
    expect(byCadence({ cadence: "0 0 * * 0" })).toEqual([
      "atlas airtable",
      "atlas braze",
      "atlas canva",
      "atlas figma",
      "atlas gemini-ai-studio",
      "atlas hex",
      "atlas inngest",
      "atlas jam",
      "atlas knock",
      "atlas microsoft365",
      "atlas nightfall",
      "atlas nx-cloud",
      "atlas prisma-data-platform",
      "atlas twilio",
    ]);
  });

  // Xero is retired from the schedule, its code kept and its refresh run by hand.
  it("schedules no atlas whose descriptor declares it unscheduled", async () => {
    const roster = buildResyncPolicies({ atlases: await atlasResyncInputs(), corpus: [] });
    const labels = roster.policies.map((policy) => resyncTargetLabel({ target: policy.target }));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain("atlas aether");
    expect(labels).not.toContain("atlas xero");
  });

  // Compile-only means every filled surface is compiled AND there is at least one: an atlas with no filled
  // surface (a browser walk, or nothing yet) would read as compile-only by vacuous truth.
  it("runs exactly the compile-only atlases in the tick, with no seat", async () => {
    expect(await tickResyncRecipeIds()).toEqual([
      "resync-atlas-airtable",
      "resync-atlas-braze",
      "resync-atlas-canva",
      "resync-atlas-figma",
      "resync-atlas-gemini-ai-studio",
      "resync-atlas-microsoft365",
      "resync-atlas-nightfall",
      "resync-atlas-prisma-data-platform",
    ]);
  });
});

const dirs: string[] = [];

describe("corpusResyncInputs", () => {
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  // ONE real checkout, because this is the wiring test: that the profile read, the git read and the pure
  // decision above are actually joined up. Every branch of the decision itself is asserted without git.
  it("joins the declared profile to the org subject, and leaves credential-addressed sources naming nothing", () => {
    const home = mkdtempSync(join(tmpdir(), "roster-"));
    dirs.push(home);
    const checkout = mkdtempSync(join(tmpdir(), "co-"));
    dirs.push(checkout);
    gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
    gitInTemp({ args: ["remote", "add", "origin", "git@github.com:octo-self/slopweaver.git"], cwd: checkout });
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        mainCheckouts: [{ path: checkout }],
        schemaVersion: 1,
        sources: [],
      }),
      "utf8",
    );

    const read = corpusResyncInputs({ home });
    expect(read.problems).toEqual([]);
    expect(read.inputs.find((input) => input.source === "github")!.subject).toEqual({
      kind: "org",
      org: "octo-self",
    });
    expect(read.inputs.find((input) => input.source === "slack")!.subject).toEqual({ kind: "none" });
    expect(read.inputs.filter((input) => input.subject.kind === "org").map((input) => input.source)).toEqual([
      "github",
    ]);
  });

  it("omits github, keeping every other source, when the profile declares no checkout", () => {
    const home = mkdtempSync(join(tmpdir(), "roster-"));
    dirs.push(home);
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        mainCheckouts: [],
        schemaVersion: 1,
        sources: [],
      }),
      "utf8",
    );

    const read = corpusResyncInputs({ home });
    expect(read.inputs.filter((input) => input.source === "github")).toEqual([]);
    expect(read.inputs.find((input) => input.source === "slack")!.subject).toEqual({ kind: "none" });
    expect(read.problems.length).toBe(1);
    expect(read.problems[0]!).toContain("mainCheckouts");
  });

  it("seats no chatgpt row, and reports no problem, on a home that has never taken an export in", () => {
    const home = mkdtempSync(join(tmpdir(), "roster-"));
    dirs.push(home);
    const read = corpusResyncInputs({ home });
    expect(read.inputs.filter((input) => input.source === "chatgpt")).toEqual([]);
    expect(read.problems.filter((problem) => problem.includes("chatgpt"))).toEqual([]);
  });

  it("seats the chatgpt row on its export once one is held, needing no profile", () => {
    const home = mkdtempSync(join(tmpdir(), "roster-"));
    dirs.push(home);
    const imported = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: CHATGPT_FIXTURE,
        nowIso: "2026-10-17T01:00:00.000Z",
        root: stateHomePaths({ home }).corpus.chatgptExports,
      }),
    );
    expect(imported.fresh).toBe(true);
    const read = corpusResyncInputs({ home });
    expect(read.inputs.filter((input) => input.subject.kind === "export").map((input) => input.source)).toEqual([
      "chatgpt",
    ]);
  });

  it("seats the chatgpt row on live-sync once the live copy holds a chat, an export beside it included", () => {
    const home = mkdtempSync(join(tmpdir(), "roster-"));
    dirs.push(home);
    unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: CHATGPT_FIXTURE,
        nowIso: "2026-10-17T01:00:00.000Z",
        root: stateHomePaths({ home }).corpus.chatgptExports,
      }),
    );
    unwrap(
      writeLiveSnapshot({
        ...UNPROTECTED,
        bodyUpdatedIso: null,
        conversationId: chatId({ name: "conv-y" }),
        elementText: "{}",
        fetchedAtIso: "2026-11-18T00:00:00.000Z",
        listedUpdatedIso: "2026-11-17T00:00:00.000Z",
        root: stateHomePaths({ home }).corpus.chatgptLive,
      }),
    );
    const read = corpusResyncInputs({ home });
    expect(read.inputs.filter((input) => input.source === "chatgpt").map((input) => input.subject)).toEqual([
      { kind: "live" },
    ]);
    const policy = buildResyncPolicies({
      atlases: [],
      corpus: read.inputs.filter((input) => input.source === "chatgpt"),
    }).policies[0]!;
    expect(policy.steps).toEqual([{ argv: ["chatgpt", "live-sync"] }]);
  });

  it("keeps the chatgpt row on live-sync, and reports the damage, once the live copy will not read", () => {
    const home = mkdtempSync(join(tmpdir(), "roster-"));
    dirs.push(home);
    const root = stateHomePaths({ home }).corpus.chatgptLive;
    const id = chatId({ name: "conv-y" });
    unwrap(
      writeLiveSnapshot({
        ...UNPROTECTED,
        bodyUpdatedIso: null,
        conversationId: id,
        elementText: "{}",
        fetchedAtIso: "2026-11-18T00:00:00.000Z",
        listedUpdatedIso: "2026-11-17T00:00:00.000Z",
        root,
      }),
    );
    writeFileSync(join(root, "snapshots", id, "manifest.json"), "{");
    const read = corpusResyncInputs({ home });
    expect(read.inputs.filter((input) => input.source === "chatgpt").map((input) => input.subject)).toEqual([
      { kind: "live" },
    ]);
    expect(read.problems.filter((problem) => problem.startsWith("chatgpt live copy: ")).length).toBe(1);
  });

  it("keeps the chatgpt policy, and reports the damage, once its sole held export will not read", async () => {
    // Damage must never retire the daily run that reports it: a roster that dropped the row would let the
    // registration pass delete it as obsolete.
    const home = mkdtempSync(join(tmpdir(), "roster-"));
    dirs.push(home);
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    const { stored } = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: NO_ZIP,
        from: CHATGPT_FIXTURE,
        nowIso: "2026-10-17T01:00:00.000Z",
        root,
      }),
    );
    writeFileSync(join(stored.directory, "manifest.json"), "{");
    const roster = await readResyncRoster({ home });
    expect(
      roster.policies
        .map((policy) => resyncTargetLabel({ target: policy.target }))
        .filter((label) => label.includes("chatgpt")),
    ).toEqual(["corpus chatgpt"]);
    const damage = roster.problems.filter((problem) => problem.startsWith("chatgpt held export: "));
    expect(damage.length).toBe(1);
    expect(damage[0]!).toContain(`${stored.directory}: no readable manifest.json`);
  });
});
