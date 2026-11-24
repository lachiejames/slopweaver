/**
 * `profile voice measure` over the whole production seam: the shipped `bin/slopweaver` spawned against a fixture home
 * whose bronze holds the owner's sent Slack. Two halves:
 *
 * - **Storeless** (always runs): a home with nothing to measure exits 3 and writes nothing; a dry run prints the
 *   cohorts it measured and opens no store; a write with no store selected FAILS rather than reporting success.
 * - **Real store** (`../proofDatabase.ts`, REQUIRED in CI, opt-in locally): the measurement lands in the register
 *   `profile voice` reads back, and the context cache the send door reads carries it with no session start between;
 *   a cache that cannot be written rolls every cohort back; with no owner row nothing is written and it exits 3.
 *
 * Every spawn gets an environment built from nothing, so an operator's own `SLOPWEAVER_STORE_URL` never reaches it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { stateHomePaths } from "../../../stateHome.js";
import { STORE_URL_ENV } from "../../../store/config.js";
import { statement } from "../../../store/profile/core.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { openProofTemplate, type ProofDatabase, type ProofTemplate, proofAdminUrl } from "../proofDatabase.js";

const ADMIN_URL = proofAdminUrl();

/** The shipped entrypoint, run exactly as an operator runs it. */
const BIN = fileURLToPath(new URL("../../../../bin/slopweaver", import.meta.url));

/** The owner's Slack user id in this fixture. */
const OWNER = "U0SYNOWNER1";

/** One serialised Slack bronze row of the owner's, typed by hand unless `raw` says otherwise. */
function row({
  id,
  text,
  channel = "C0SYNCHAN01",
  raw = {},
}: {
  id: string;
  text: string;
  channel?: string;
  raw?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    author: OWNER,
    container: `slack/${channel}`,
    kind: "message",
    raw: { text, user: OWNER, ...raw },
    refs: [],
    source: "slack",
    sourceId: `${channel}:${id}`,
    text,
    tsIso: "2026-11-01T00:00:00.000Z",
    url: `https://acme.slack.com/archives/${channel}/p${id}`,
  });
}

/** A fixture home: a profile naming the owner, and their Slack bronze unless `bronze` is false. */
function fixtureHome({ root, bronze }: { root: string; bronze: boolean }): string {
  const home = join(root, ".slopweaver");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "",
      gitNamespace: "",
      id: "me",
      schemaVersion: 1,
      slackBot: { ownerUserId: OWNER, selfUserIds: [] },
      sources: [],
    }),
  );
  if (bronze) {
    const dir = join(home, "corpus", "bronze", "slack");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "window.jsonl"),
      `${[
        row({ id: "1", text: "one two three" }),
        row({ id: "2", text: "one two three four five" }),
        row({ channel: "D0SYNDMCH01", id: "3", text: "four words right here" }),
        row({ id: "4", raw: { bot_id: "B0SYNAPP001" }, text: "the fleet wrote this one under the owner's name" }),
      ].join("\n")}\n`,
    );
  }
  return home;
}

/** Run the shipped binary with an environment built from nothing but what the case names. */
function run({ args, root, storeUrl }: { args: readonly string[]; root: string; storeUrl?: string }): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(BIN, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: root,
      PATH: process.env["PATH"]!,
      ...(storeUrl === undefined ? {} : { [STORE_URL_ENV]: storeUrl }),
    },
    timeout: 60_000,
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe("profile voice measure through the shipped CLI, with no store", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sw-voice-measure-"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("exits 3 and writes nothing when the home holds no Slack corpus", () => {
    const home = fixtureHome({ bronze: false, root });
    const ran = run({ args: ["profile", "voice", "measure", "--home", home], root });
    expect(ran.status).toBe(3);
    expect(ran.stdout).toBe(
      "profile voice measure: nothing measured; no cohorts written — this home holds no Slack corpus yet — a Slack refresh writes it\n",
    );
  }, 120_000);

  it("prints what a dry run measured, leaving out what an app posted, and opens no store", () => {
    const home = fixtureHome({ bronze: true, root });
    const ran = run({ args: ["profile", "voice", "measure", "--dry-run", "--json", "--home", home], root });
    expect(ran.status).toBe(0);
    const document = JSON.parse(ran.stdout) as {
      kind: string;
      measurement: {
        cohorts: readonly { surface: string; cohort: string; sampleCount: number; medianWords: number }[];
        counts: { excludedAppBotId: number };
      };
    };
    expect(document.kind).toBe("dry-run");
    expect(
      document.measurement.cohorts.map((cohort) => [
        cohort.surface,
        cohort.cohort,
        cohort.sampleCount,
        cohort.medianWords,
      ]),
    ).toEqual([
      ["slack", "all-sent", 3, 4],
      ["slack-dm", "aggregate", 1, 4],
    ]);
    expect(document.measurement.counts.excludedAppBotId).toBe(1);
  }, 120_000);

  it("FAILS a write when no store is selected, rather than reporting a measurement it never kept", () => {
    const home = fixtureHome({ bronze: true, root });
    const ran = run({ args: ["profile", "voice", "measure", "--home", home], root });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("the voice register could not be written");
  }, 120_000);
});

describe.skipIf(ADMIN_URL === undefined)("profile voice measure through the shipped CLI, over a real store", () => {
  // Built in the hooks, never at collection: `skipIf` still runs this body.
  let template: ProofTemplate;
  let database: ProofDatabase;
  let root: string;

  beforeAll(async () => {
    template = await openProofTemplate({ adminUrl: ADMIN_URL!, prefix: "voice_measure_proof" });
  }, 120_000);

  afterAll(async () => {
    await template.drop();
  });

  beforeEach(async () => {
    database = await template.open();
    root = mkdtempSync(join(tmpdir(), "sw-voice-measure-store-"));
  }, 60_000);

  afterEach(async () => {
    rmSync(root, { force: true, recursive: true });
    await database.drop();
  });

  /** Write the owner row through the shipped `profile set`. */
  function seedOwner(): void {
    const owner = join(root, "owner.json");
    writeFileSync(
      owner,
      JSON.stringify({
        displayName: "Ada",
        selfDescription: {
          alwaysLoaded: [statement({ observedAt: "2026-11-01T00:00:00.000Z", source: "s", text: "one thing" })],
          facts: [],
          schemaVersion: 1,
          waysOfWorking: [],
        },
      }),
    );
    expect(run({ args: ["profile", "set", "--file", owner], root, storeUrl: database.storeUrl }).status).toBe(0);
  }

  /** The register `profile voice --json` reads back, as surface/cohort/median triples. */
  function registerRead(): readonly (string | number)[][] {
    const read = run({ args: ["profile", "voice", "--json"], root, storeUrl: database.storeUrl });
    const register = JSON.parse(read.stdout) as {
      cohorts: readonly { surface: string; cohort: string; medianWords: number }[];
    };
    return register.cohorts.map((cohort) => [cohort.surface, cohort.cohort, cohort.medianWords]);
  }

  it("rolls every cohort back when the cache the send door reads cannot be written", () => {
    const home = fixtureHome({ bronze: true, root });
    seedOwner();
    // A directory where the cache file belongs, so the cache write fails after the upserts ran.
    mkdirSync(join(stateHomePaths({ home }).profileContextJson, "occupied"), { recursive: true });

    const measured = run({ args: ["profile", "voice", "measure", "--home", home], root, storeUrl: database.storeUrl });
    expect(measured.status).toBe(1);
    expect(measured.stderr).toContain("so no cohort was written");
    expect(registerRead()).toEqual([]);
  }, 180_000);

  it("exits 3 and writes nothing when no owner row exists for the register to hang off", () => {
    const home = fixtureHome({ bronze: true, root });

    const measured = run({ args: ["profile", "voice", "measure", "--home", home], root, storeUrl: database.storeUrl });
    expect([measured.status, measured.stdout.split("\n")[0]]).toEqual([
      3,
      "profile voice measure: nothing measured; no cohorts written — no owner row has been written yet — `slopweaver profile set --file <owner.json>` seeds it",
    ]);
    expect(registerRead()).toEqual([]);
    expect(existsSync(stateHomePaths({ home }).profileContextJson)).toBe(false);
  }, 180_000);

  it("writes the register `profile voice` reads, and refreshes the cache the send door reads", () => {
    const home = fixtureHome({ bronze: true, root });
    seedOwner();

    const measured = run({ args: ["profile", "voice", "measure", "--home", home], root, storeUrl: database.storeUrl });
    expect([measured.status, measured.stdout.split("\n")[0]]).toEqual([
      0,
      "profile voice measure: 2 cohort(s) written from 1 Slack file(s); context cache refreshed",
    ]);

    expect(registerRead()).toEqual([
      ["slack", "all-sent", 4],
      ["slack-dm", "aggregate", 4],
    ]);

    const cache = JSON.parse(readFileSync(stateHomePaths({ home }).profileContextJson, "utf8")) as {
      voiceRegister: readonly { surface: string; sampleCount: number }[];
    };
    expect(cache.voiceRegister.map((cohort) => [cohort.surface, cohort.sampleCount])).toEqual([
      ["slack", 3],
      ["slack-dm", 1],
    ]);
  }, 180_000);
});
