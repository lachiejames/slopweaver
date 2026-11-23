import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HandDeps } from "../../../../../cli/commands/hand/deps.js";
import { runHandPost } from "../../../../../cli/commands/hand/post.js";
import { runHandRecheck } from "../../../../../cli/commands/hand/recheck.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { RecheckObservation } from "../../../../../hand/recheck.js";
import type { RecheckProbeDeps } from "../../../../../hand/recheckProbes.js";
import { readOpenHandSteps } from "../../../../../hand/store.js";
import { unwrap } from "../../../../../lib/result.js";

const NOW = "2026-10-07T01:00:00.000Z";
const CLERK = "https://dashboard.clerk.com";
const CHANNEL = "C0123456789";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];
let reads: string[] = [];

/** The hand seams, with output recorded and no note ever drawn. */
function deps(): HandDeps {
  return {
    branchesDeclaring: () => [],
    consoleBase: () => "http://localhost:3000",
    lookAt: () => ({ kind: "seen", picture: undefined }),
    now: () => NOW,
    platform: "linux",
    rowPullRequests: () => ({ kind: "not-asked" }),
    run: () => undefined,
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
}

/** Fake reads answering a fixed observation per kind, recording each one asked. */
function probes({ browser, slack }: { browser: RecheckObservation; slack: RecheckObservation }): RecheckProbeDeps {
  return {
    browserSession: ({ origin }) => {
      reads.push(`browser ${origin}`);
      return Promise.resolve(browser);
    },
    slackMember: ({ channel }) => {
      reads.push(`slack ${channel}`);
      return Promise.resolve(slack);
    },
  };
}

/** Post one quiet standalone step blocking on the owner. */
async function post({ id, what, tail }: { id: string; what: string; tail: readonly string[] }): Promise<void> {
  const code = await runHandPost({
    deps: deps(),
    rest: [
      "--home",
      home,
      "--id",
      id,
      "--what",
      what,
      "--unblocks",
      `the run parked on ${id}`,
      "--witness",
      `slopweaver hand done ${id}`,
      "--standalone",
      "--blocks",
      "--quiet",
      ...tail,
    ],
  });
  expect([code, diagnostics]).toEqual([EXIT_OK, []]);
}

/** The ids still open. */
function openIds(): readonly string[] {
  return unwrap(readOpenHandSteps({ home })).steps.map((step) => step.id);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hand-recheck-"));
  out = [];
  diagnostics = [];
  reads = [];
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("hand recheck", () => {
  beforeEach(async () => {
    await post({
      id: "clerk-signin-6oct",
      tail: ["--url", `${CLERK}/apps`],
      what: "Sign in to Clerk in the work Chrome, so the atlas resync can finish",
    });
    await post({
      id: "clerk-signin-7oct",
      tail: ["--url", CLERK],
      what: "Sign in to Clerk again, so the walk can read it",
    });
    await post({
      id: "join-ops",
      tail: ["--recheck", `slack-member:${CHANNEL}`, "--url", "https://slack.com/app_redirect?channel=C0123456789"],
      what: "Join the ops channel, so its incidents reach the corpus",
    });
    await post({
      id: "gcloud-signin",
      tail: ["--url", "https://console.cloud.google.com/"],
      what: "Sign in to Google Cloud, so the deploy can finish",
    });
    out = [];
  });

  it("retires every step whose sign-in already holds with ONE visit, journalled as no hand touching it", async () => {
    const code = await runHandRecheck({
      deps: deps(),
      probes: probes({
        browser: { kind: "met", observed: `clerk opened ${CLERK} signed in, no sign-in page` },
        slack: { kind: "unmet", observed: `the owner is not yet a member of ${CHANNEL}` },
      }),
      rest: ["--home", home, "--by-session", "supervisor"],
    });

    expect(code).toBe(EXIT_OK);
    expect(reads).toEqual([`browser ${CLERK}`, `slack ${CHANNEL}`]);
    expect(openIds()).toEqual(["join-ops", "gcloud-signin"]);
    expect(out).toEqual([
      `hand recheck: retired clerk-signin-6oct — already met: clerk opened ${CLERK} signed in, no sign-in page`,
      `hand recheck: retired clerk-signin-7oct — already met: clerk opened ${CLERK} signed in, no sign-in page`,
      `hand recheck: still needed join-ops — the owner is not yet a member of ${CHANNEL}`,
      "hand recheck: 2 retired, 1 still needed, 0 unread, 1 name no precondition the fleet reads",
    ]);
    const register = readFileSync(join(home, "hand-steps", "steps.jsonl"), "utf8");
    expect(register).toContain(
      `"did":"retired by recheck — already met: clerk opened ${CLERK} signed in, no sign-in page at ${NOW}, no hand touched it"`,
    );
    expect(register).toContain('"bySession":"supervisor"');
  });

  it("keeps the steps of a read that THREW, and still settles the rest of the pass", async () => {
    const code = await runHandRecheck({
      deps: deps(),
      probes: {
        browserSession: () => Promise.reject(new Error("relay socket closed")),
        slackMember: () => Promise.resolve({ kind: "met", observed: `the owner is a member of ${CHANNEL}` }),
      },
      rest: ["--home", home],
    });

    expect(code).toBe(EXIT_OK);
    expect(openIds()).toEqual(["clerk-signin-6oct", "clerk-signin-7oct", "gcloud-signin"]);
    expect(out[1]).toBe(
      `hand recheck: unread clerk-signin-6oct — browser-session:${CLERK} threw: relay socket closed; it stays open and the next pass reads again`,
    );
  });

  it("keeps a step whose read could not be made, and says it reads again next pass", async () => {
    const code = await runHandRecheck({
      deps: deps(),
      probes: probes({
        browser: { kind: "unread", why: "could not open https://dashboard.clerk.com: ETIMEDOUT" },
        slack: { kind: "met", observed: `the owner is a member of ${CHANNEL}` },
      }),
      rest: ["--home", home, "--json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(openIds()).toEqual(["clerk-signin-6oct", "clerk-signin-7oct", "gcloud-signin"]);
    expect(JSON.parse(out[0]!)).toEqual({
      alreadySettled: [],
      dryRun: false,
      retired: [{ because: `the owner is a member of ${CHANNEL}`, id: "join-ops" }],
      unchecked: 1,
      unmet: [],
      unread: [
        { because: "could not open https://dashboard.clerk.com: ETIMEDOUT", id: "clerk-signin-6oct" },
        { because: "could not open https://dashboard.clerk.com: ETIMEDOUT", id: "clerk-signin-7oct" },
      ],
    });
  });

  it("writes nothing on --dry-run, naming what it would retire", async () => {
    const code = await runHandRecheck({
      deps: deps(),
      probes: probes({
        browser: { kind: "met", observed: "clerk opened it signed in" },
        slack: { kind: "met", observed: "the owner is a member" },
      }),
      rest: ["--home", home, "--dry-run"],
    });

    expect(code).toBe(EXIT_OK);
    expect(openIds()).toEqual(["clerk-signin-6oct", "clerk-signin-7oct", "join-ops", "gcloud-signin"]);
    expect(out[0]).toBe("hand recheck: would retire clerk-signin-6oct — already met: clerk opened it signed in");
  });
});

describe("hand recheck — the quiet and refused cases", () => {
  it("exits 3 and reads nothing when no open step names a precondition", async () => {
    await post({
      id: "gcloud-signin",
      tail: ["--url", "https://console.cloud.google.com/"],
      what: "Sign in to Google Cloud, so the deploy can finish",
    });
    out = [];

    const code = await runHandRecheck({
      deps: deps(),
      probes: probes({ browser: { kind: "met", observed: "x" }, slack: { kind: "met", observed: "x" } }),
      rest: ["--home", home],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(reads).toEqual([]);
    expect(out).toEqual(["hand recheck: 0 retired, 0 still needed, 0 unread, 1 name no precondition the fleet reads"]);
  });

  it("refuses an unknown flag as usage", async () => {
    const code = await runHandRecheck({
      deps: deps(),
      probes: probes({ browser: { kind: "met", observed: "x" }, slack: { kind: "met", observed: "x" } }),
      rest: ["--home", home, "--force"],
    });
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("hand post --recheck", () => {
  it("refuses a browser origin no atlas reads, before anything is written", async () => {
    const code = await runHandPost({
      deps: deps(),
      rest: [
        "--home",
        home,
        "--id",
        "gcloud-signin",
        "--what",
        "Sign in to Google Cloud, so the deploy can finish",
        "--unblocks",
        "the deploy",
        "--witness",
        "slopweaver hand done gcloud-signin",
        "--standalone",
        "--blocks",
        "--quiet",
        "--url",
        "https://console.cloud.google.com/",
        "--recheck",
        "browser-session:https://console.cloud.google.com",
      ],
    });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("whose sign-in no atlas reads");
    expect(openIds()).toEqual([]);
  });
});
