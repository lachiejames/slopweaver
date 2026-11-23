/**
 * The identity roster over the WHOLE production seam: the shipped `bin/slopweaver` spawned against a real, freshly
 * migrated store, one database per case copied from a template migrated once (`../proofDatabase.ts`). The storeless subprocess suites prove the other half —
 * that an outage refuses and never falls back to a retired `identity.json`
 * (`../cli/commands/slack/asMeBumpGate.fixture.test.ts`) — so this file proves what only a real store can: the row is
 * written by the real curation verb, a retired file is imported once and is inert afterwards, and the send and the
 * review request read people off the row.
 *
 * REQUIRED in CI (the subprocess job names `STORE_PROOF_ADMIN_URL`), opt-in locally; the command is in
 * `../proofDatabase.ts`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { STORE_URL_ENV } from "../../../store/config.js";
import { openProofTemplate, type ProofDatabase, type ProofTemplate, proofAdminUrl } from "../proofDatabase.js";

const ADMIN_URL = proofAdminUrl();

/** The shipped entrypoint, run exactly as an operator runs it. */
const BIN = fileURLToPath(new URL("../../../../bin/slopweaver", import.meta.url));

/** One synthetic person carrying a Slack identity. */
const JONAH = {
  handle: "jonah-example",
  id: "person-jonah",
  identities: [{ nativeId: "U0JONAH", source: "slack" }],
  name: "Jonah Example",
};

/** The same person, renamed — what an edit to a retired file after its import would say. */
const JONAH_RENAMED = { ...JONAH, name: "Renamed After Import" };

describe.skipIf(ADMIN_URL === undefined)("the identity roster through the shipped CLI, over a real store", () => {
  // Built in the hooks, never at collection: `skipIf` still runs this body.
  let template: ProofTemplate;
  let database: ProofDatabase;
  let root: string;
  let home: string;

  beforeAll(async () => {
    template = await openProofTemplate({ adminUrl: ADMIN_URL!, prefix: "identity_roster_proof" });
  }, 120_000);

  afterAll(async () => {
    await template.drop();
  });

  beforeEach(async () => {
    database = await template.open();
    root = mkdtempSync(join(tmpdir(), "sw-roster-proof-"));
    home = join(root, ".slopweaver");
    mkdirSync(home, { recursive: true });
  }, 60_000);

  afterEach(async () => {
    rmSync(root, { force: true, recursive: true });
    await database.drop();
  });

  /** Run the shipped binary against this case's store, with no other inherited environment. */
  function run({ args, stdin = "" }: { args: readonly string[]; stdin?: string }): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const result = spawnSync(BIN, args, {
      cwd: root,
      encoding: "utf8",
      env: {
        HOME: root,
        PATH: process.env["PATH"]!,
        SLACK_USER_TOKEN: "xoxp-test",
        [STORE_URL_ENV]: database.storeUrl,
      },
      input: stdin,
      timeout: 60_000,
    });
    return { status: result.status, stderr: result.stderr, stdout: result.stdout };
  }

  /** `identity roster show --json`, parsed to the fields a case asserts on, its stderr beside them. */
  function show(): { names: readonly string[]; revision: number | null; stderr: string } {
    const shown = run({ args: ["identity", "roster", "show", "--json", "--home", home] });
    expect(shown.status).toBe(0);
    const document = JSON.parse(shown.stdout) as { records: readonly { name: string }[]; revision: number | null };
    return { names: document.records.map((record) => record.name), revision: document.revision, stderr: shown.stderr };
  }

  it("writes the row with `roster replace`, pinned to no revision, and reads it back with `roster show`", () => {
    const file = join(root, "roster.json");
    writeFileSync(file, JSON.stringify([JONAH]));

    const replaced = run({
      args: ["identity", "roster", "replace", "--file", file, "--expect-revision", "none", "--home", home],
    });

    expect([replaced.status, replaced.stderr]).toEqual([0, "identity roster: wrote revision 1\n"]);
    expect(show()).toEqual({ names: ["Jonah Example"], revision: 1, stderr: "" });
  }, 120_000);

  it("refuses a second replace pinned to no revision once the row exists, and leaves the row as it was", () => {
    const file = join(root, "roster.json");
    writeFileSync(file, JSON.stringify([JONAH]));
    expect(
      run({ args: ["identity", "roster", "replace", "--file", file, "--expect-revision", "none", "--home", home] })
        .status,
    ).toBe(0);
    writeFileSync(file, JSON.stringify([JONAH_RENAMED]));

    const stale = run({
      args: ["identity", "roster", "replace", "--file", file, "--expect-revision", "none", "--home", home],
    });

    expect(stale.status).not.toBe(0);
    expect(show()).toEqual({ names: ["Jonah Example"], revision: 1, stderr: "" });
  }, 120_000);

  it("imports a retired identity.json once, and an edit to the file afterwards changes nothing", () => {
    writeFileSync(join(home, "identity.json"), JSON.stringify([JONAH]));
    const imported = show();
    expect([imported.names, imported.revision]).toEqual([["Jonah Example"], 1]);

    writeFileSync(join(home, "identity.json"), JSON.stringify([JONAH_RENAMED]));

    const after = show();
    expect([after.names, after.revision]).toEqual([["Jonah Example"], 1]);
    // The file is named as inert beside the row, so an operator sees it is no longer what anything reads.
    expect(after.stderr).toContain(
      "is retired and read by nothing: the store's row (revision 1) is the identity roster",
    );
  }, 120_000);

  // The witness is the line only a RESOLVED mention reaches: the live departed-tag read
  // (`src/outbound/slack/departedTags.ts`) runs once the mention check passes, and the fake token then fails it.
  // `asMeBumpGate.fixture.test.ts` asserts this line ABSENT on a bare home, so the two cases split on the store alone.
  it("resolves a send's <@U…> off the row the curation verb wrote", () => {
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        sources: [],
      }),
    );
    const file = join(root, "roster.json");
    writeFileSync(file, JSON.stringify([JONAH]));
    expect(
      run({ args: ["identity", "roster", "replace", "--file", file, "--expect-revision", "none", "--home", home] })
        .status,
    ).toBe(0);

    const sent = run({
      args: ["slack", "post", "--as", "me", "--channel", "C1", "--shape", "top-level", "--body", "-", "--dry-run"],
      stdin: "just bumping this <@U0JONAH> — any update?\n",
    });

    expect(sent.stderr).not.toContain("this install keeps its identity roster in the store");
    expect(sent.stderr).toContain("could not read <@U0JONAH> off Slack's live roster");
    expect(sent.stdout).toBe("");
  }, 120_000);

  it("reaches the review request's real roster check over a store with no row, and names no token", () => {
    const requested = run({
      args: [
        "github",
        "pr",
        "request-review",
        "--repo",
        "o/r",
        "--number",
        "1",
        "--reviewer",
        "nobody-the-empty-roster-has-ever-seen",
        "--dry-run",
        "--home",
        home,
      ],
    });

    expect(requested.status).not.toBe(0);
    expect(requested.stderr).toContain("no exact match");
    expect(requested.stderr).not.toContain("this install keeps its identity roster in the store");
    expect(requested.stderr).not.toContain("no GitHub token configured");
  }, 120_000);
});
