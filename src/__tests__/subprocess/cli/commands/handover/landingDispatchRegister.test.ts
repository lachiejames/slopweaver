/**
 * The argv `github landing --register` composes, run through the SHIPPED `handover register`.
 *
 * This lane exists because the defect it holds down was invisible to a unit test that was already there and
 * already exact. `unit/cli/commands/github/landingRegister.test.ts` asserts the composed array element for
 * element — and it asserted it correctly while every one of those invocations exited 2: its injected
 * `registerRow` returns a number and parses nothing, so a producer and its consumer could disagree forever
 * without a single assertion reddening. MEASURED: the ask-shape
 * gate refused every row the landing register would have written, so the board never got one.
 *
 * So the witness here is COMPATIBILITY, and it is falsifiable in both directions: the same production
 * builder supplies the argv, the real binary consumes it, and the third case strips `--dispatch` back out
 * and asserts the refusal returns. A test that only ran the happy path would pass against a `--dispatch`
 * that had quietly stopped being the thing the gate reads.
 *
 * `SLOPWEAVER_CLI_DIR` is set deliberately: `bin/slopweaver` otherwise resolves its checkout from an ambient
 * `PLUGIN_ROOT`, and a proof run from a worktree would silently exercise the main checkout instead. The
 * environment is an allowlist so no inherited `SLOPWEAVER_ALLOW_UNSHAPED_ASK` can make the refusal case
 * green.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { bumpRegisterArgv, bumpRegistrationAsk } from "../../../../../cli/commands/github/bumpDriveCore.js";
import { bumpAskUnrootable } from "../../../../../cli/commands/github/bumpDriveRun.js";
import { registrationArgv } from "../../../../../cli/commands/github/landingRegister.js";
import { dependencyBotActors } from "../../../../../organisation/dependencyBots.js";
import { registrationSlug } from "../../../../../review/boardAtHead.js";
import { FIRST_ASK_BRIEF } from "../../../../../review/landingDispatchAsk.js";
import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { landingRowFake } from "../../../../landingRowFake.js";
import { ACME_ORGANISATION } from "../../../../organisationFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with the directory the board lives in. */
function throwawayHome(): string {
  const home = mkdtempSync(join(tmpdir(), "landing-dispatch-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"));
  return home;
}

/** The row every case here registers — a real dispatch verdict with a real `why`. */
function row(): ReturnType<typeof landingRowFake> {
  return landingRowFake({
    action: "spawn-ci",
    dispatch: { kind: "act", verdict: "rebase-and-fix", why: "required check(s) failing: build" },
    title: "add the widget",
  });
}

function run({ args, extraEnv = {} }: { args: readonly string[]; extraEnv?: Readonly<Record<string, string>> }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_CLI_DIR: repoRoot,
      TMPDIR: process.env["TMPDIR"]!,
      ...extraEnv,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  // A null status means the child was SIGNALLED rather than exited, and every assertion below is about an
  // exit code — folding that into a sentinel would let a killed binary read as an ordinary refusal.
  if (result.status === null) {
    throw new Error(`bin/slopweaver was signalled rather than exiting: ${String(result.signal)}`);
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/**
 * The verb arguments the production builder yields — its argv without the leading `node slopweaver`, which
 * is what `bin/slopweaver` is handed directly.
 */
function verbArgs({ home }: { home: string }): readonly string[] {
  return registrationArgv({
    organisation: ACME_ORGANISATION,
    askedIso: "2026-09-19T12:00:00.000Z",
    checkout: undefined,
    home,
    row: row(),
  }).slice(2);
}

describe("the argv `github landing --register` composes", () => {
  it("is ACCEPTED by the shipped `handover register`, and writes the row it names", () => {
    const home = throwawayHome();
    const registered = run({ args: verbArgs({ home }) });
    expect(registered.status).toBe(0);

    const slug = registrationSlug({ row: row() });
    expect(readdirSync(join(home, "handovers"))).toEqual([`${slug}.md`]);
    const text = readFileSync(join(home, "handovers", `${slug}.md`), "utf8");
    expect(text).toContain("kind: ask\n");
    expect(text).toContain("status: ready\n");
    expect(text).toContain("branch: feature/one\n");
    expect(text).toContain("askedIso: 2026-09-19T12:00:00.000Z\n");
    expect(text).toContain("## Work to dispatch\n");
    // The two properties that separate a dispatch row from the two rows it must not become: no finding
    // provenance (which would have a team-facing door hold the very work rule 10 says to do), and no
    // invented shape (which would put a decision on the board the owner never had to take).
    expect(text).not.toContain("origin: finding");
    expect(text).not.toContain("problem:");
    expect(text).not.toContain("lean:");
  });

  it("puts that row on the board the shipped `handover list` reads, with no defect reported", () => {
    const home = throwawayHome();
    run({ args: verbArgs({ home }) });

    const listed = run({ args: ["handover", "list", "--home", home, "--json"] });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain(registrationSlug({ row: row() }));
    expect(listed.stdout).toContain("acme/widgets#16378 needs rebase-and-fix");

    const lint = run({ args: ["handover", "lint", "--home", home] });
    expect(lint.status).toBe(0);
  });

  it("is REFUSED with --dispatch taken back out, which is the defect this lane holds down", () => {
    const home = throwawayHome();
    const without = verbArgs({ home }).filter((arg) => arg !== "--dispatch");

    const refused = run({ args: without });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("the ask carries no problem, no options with their trade-offs and no lean");
    expect(refused.stderr).toContain("NOTHING was recorded");
    expect(readdirSync(join(home, "handovers"))).toEqual([]);
  });

  it("refuses a second registration at the same head rather than writing a duplicate row", () => {
    const home = throwawayHome();
    run({ args: verbArgs({ home }) });
    const path = join(home, "handovers", `${registrationSlug({ row: row() })}.md`);
    const first = readFileSync(path, "utf8");

    const again = run({ args: verbArgs({ home }) });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("already exists");
    expect(readFileSync(path, "utf8")).toBe(first);
  });

  // A review's counterexample, reproduced against the real binary before the fix: a `--branch` carrying a
  // whole ask shape wrote it into the front-matter as REAL KEYS, and `handover list` then read the row back
  // as a decision the owner had to take. The shape gate never saw it, because no shape FLAG was passed.
  it("refuses a --branch carrying a whole ask shape, rather than writing it in as front-matter keys", () => {
    const home = throwawayHome();
    const injected = verbArgs({ home }).map((arg) => {
      if (arg === "feature/one") {
        return 'feature/one\nproblem: "which base should we use"\nlean: "main"\noptions:\n  - option: "a"\n    tradeoff: "b"';
      }
      return arg;
    });

    const refused = run({ args: injected });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("--branch carries a newline");
    expect(readdirSync(join(home, "handovers"))).toEqual([]);
  });

  // The same review's SECOND counterexample, and the one no flag check can reach: `--observed-by` is
  // optional, so `observedBy` falls back to the session id in the environment. Reproduced against this
  // binary before the fix — exit 0, and a row carrying all three shape fields with no shape flag passed.
  // The witness is `handover list --json`, whose `problem` is what the console's queue card draws.
  it("cannot be made to carry a shape by a session id, which reaches the writer from the environment", () => {
    const home = throwawayHome();
    const registered = run({
      args: [
        "handover",
        "register",
        "--ask",
        "check the widget",
        "--finding",
        "--evidence",
        "acme/widgets#1",
        "--slug",
        "injected-session",
        "--home",
        home,
      ],
      extraEnv: {
        CLAUDE_CODE_SESSION_ID:
          'session-test\nproblem: "which base should we use"\nlean: "main"\noptions:\n  - option: "a"\n    tradeoff: "b"',
      },
    });
    expect(registered.status).toBe(0);

    const text = readFileSync(join(home, "handovers", "injected-session.md"), "utf8");
    // Falsifiable in both directions: the injected text IS in the file, as one quoted scalar.
    expect(text).toContain('observedBy: "session-test\\nproblem:');
    expect(text.split("\n").filter((line) => line.startsWith("problem:"))).toEqual([]);

    const listed = run({ args: ["handover", "list", "--all", "--json", "--home", home] });
    expect(listed.status).toBe(0);
    expect(listed.stdout).not.toContain("which base should we use");
  });

  it("refuses --dispatch beside --finding BEFORE anything is written", () => {
    const home = throwawayHome();
    const contradictory = [...verbArgs({ home }), "--finding", "--evidence", "acme/widgets#16378"];

    const refused = run({ args: contradictory });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("--dispatch and --finding declare different rows");
    expect(existsSync(join(home, "handovers", `${registrationSlug({ row: row() })}.md`))).toBe(false);
  });
});

/**
 * The two verdicts that keep nothing of the owner's stale, each carrying its whole production-shaped brief — the
 * longest `why`s the dispatch layer authors, and the two whose "never send" / "never close" must reach the
 * seat intact.
 */
const STALE_WORK_ROWS = [
  [
    "draft-first-review-ask",
    landingRowFake({
      action: "blocked-on",
      dispatch: {
        kind: "act",
        verdict: "draft-first-review-ask",
        why:
          "GitHub still holds a code-owner request out to @acme/eng, and the Slack corpus reaches far enough to say " +
          `nobody has been asked at all — ${FIRST_ASK_BRIEF}`,
      },
      title: "add the widget",
    }),
  ],
  [
    "finish-or-card-close",
    landingRowFake({
      action: "draft",
      dispatch: {
        kind: "act",
        verdict: "finish-or-card-close",
        why:
          "it is a draft and no board row states its branch — read the linked Linear ticket's current state, look " +
          "for a merged pull request that supersedes it, and read the branch at 1111111; if the work is still " +
          "wanted, finish it unasked: clear CodeRabbit, make the required checks green, then undraft it; if the " +
          "evidence says it is dead, record a shaped card proposing the close with `handover ask --action` and " +
          "never close it yourself — its age is never evidence either way",
      },
      title: "add the widget",
    }),
  ],
] as const;

describe("the argv for the two acts that keep nothing of the owner's stale", () => {
  it.each(STALE_WORK_ROWS)(
    "registers %s as a dispatch row the shipped binary accepts, with no owner-decision shape",
    (verdict, staleRow) => {
      const home = throwawayHome();
      const args = registrationArgv({
        organisation: ACME_ORGANISATION,
        askedIso: "2026-09-26T03:00:00.000Z",
        checkout: undefined,
        home,
        row: staleRow,
      });
      const registered = run({ args: args.slice(2) });
      expect(registered.status).toBe(0);

      const slug = registrationSlug({ row: staleRow });
      expect(readdirSync(join(home, "handovers"))).toEqual([`${slug}.md`]);
      const text = readFileSync(join(home, "handovers", `${slug}.md`), "utf8");
      expect(text).toContain("kind: ask\n");
      expect(text).toContain("status: ready\n");
      expect(text).toContain("## Work to dispatch\n");
      expect(text).toContain(`acme/widgets#16378 needs ${verdict}`);
      expect(text).not.toContain("problem:");
      expect(text).not.toContain("lean:");
    },
  );

  it.each(STALE_WORK_ROWS)("refuses %s with --dispatch taken back out", (_verdict, staleRow) => {
    const home = throwawayHome();
    const args = registrationArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-26T03:00:00.000Z",
      checkout: undefined,
      home,
      row: staleRow,
    });
    const refused = run({ args: args.slice(2).filter((arg) => arg !== "--dispatch") });
    expect(refused.status).toBe(2);
    expect(readdirSync(join(home, "handovers"))).toEqual([]);
  });
});

/**
 * The SECOND producer of the same argv shape — `github bump-drive`'s seat — which the first fix never reached.
 * MEASURED: the `bump-drive-acme-admin` recipe's seat rows were refused by the shape gate at every
 * firing, while its unit test pinned the argv exactly and without `--dispatch`.
 */
describe("the argv `github bump-drive` composes for a seat", () => {
  const bumpRow = landingRowFake({ number: 9875, title: "chore(deps): update dependency widget to v2" });
  const plan = { act: "seat", row: bumpRow, signal: "bot-author", why: "a session is needed for ci-green" } as const;

  function bumpArgs({ home }: { home: string }): readonly string[] {
    return bumpRegisterArgv({
      organisation: ACME_ORGANISATION,
      askedIso: "2026-09-30T14:30:00.000Z",
      bots: dependencyBotActors({ dependencyBots: ACME_ORGANISATION.dependencyBots }),
      checkout: undefined,
      home,
      plan,
      slug: registrationSlug({ row: bumpRow }),
      withheld: false,
    }).slice(2);
  }

  it("is ACCEPTED by the shipped `handover register`, as a dispatch row with no owner-decision shape", () => {
    const home = throwawayHome();
    const registered = run({ args: bumpArgs({ home }) });
    expect(registered.status).toBe(0);

    const slug = registrationSlug({ row: bumpRow });
    expect(readdirSync(join(home, "handovers"))).toEqual([`${slug}.md`]);
    const text = readFileSync(join(home, "handovers", `${slug}.md`), "utf8");
    expect(text).toContain("kind: ask\n");
    expect(text).toContain("status: ready\n");
    expect(text).toContain("## Work to dispatch\n");
    expect(text).toContain("acme/widgets#9875 is a dependency bump that needs a session");
    expect(text).not.toContain("origin: finding");
    expect(text).not.toContain("problem:");
    expect(text).not.toContain("lean:");
  });

  it("is REFUSED with --dispatch taken back out, which is what every scheduled firing hit", () => {
    const home = throwawayHome();
    const refused = run({ args: bumpArgs({ home }).filter((arg) => arg !== "--dispatch") });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("the ask carries no problem, no options with their trade-offs and no lean");
    expect(readdirSync(join(home, "handovers"))).toEqual([]);
  });

  // A renovate title naming a directory the state home carries (the real one has
  // `datadog/`) is refused by the unrooted-path gate, dispatch or not — and so is the `owner/repo#n` the ask
  // opens with, when the owner is one. The production seam decides over the FULL ask; the binary is the
  // witness in both directions.
  describe("an ask naming a state-home directory", () => {
    const slashRow = landingRowFake({ number: 9901, title: "chore(deps): update datadog/agent docker tag to v7.60.0" });
    const slashPlan = { ...plan, row: slashRow };

    function slashArgs({ home, withheld }: { home: string; withheld: boolean }): readonly string[] {
      return bumpRegisterArgv({
        organisation: ACME_ORGANISATION,
        askedIso: "2026-09-30T14:30:00.000Z",
        bots: dependencyBotActors({ dependencyBots: ACME_ORGANISATION.dependencyBots }),
        checkout: undefined,
        home,
        plan: slashPlan,
        slug: registrationSlug({ row: slashRow }),
        withheld,
      }).slice(2);
    }

    function homeWith({ dir }: { dir: string }): string {
      const home = throwawayHome();
      mkdirSync(join(home, dir));
      return home;
    }

    /** The ask the seat asks the seam about: name and title both carried. */
    function fullAsk(): string {
      return bumpRegistrationAsk({
        bots: dependencyBotActors({ dependencyBots: ACME_ORGANISATION.dependencyBots }),
        plan: slashPlan,
        withheld: false,
      });
    }

    it.each([
      ["the title", "datadog", "datadog/agent"],
      ["the owner", "acme", "acme/widgets#9901"],
    ])("withholds when %s names one, and the URL-led ask is accepted", (_what, dir, token) => {
      const home = homeWith({ dir });
      const withheld = bumpAskUnrootable({ ask: fullAsk(), checkout: undefined, home });
      expect(withheld).toBe(true);

      const refused = run({ args: slashArgs({ home, withheld: false }) });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain(token);
      expect(readdirSync(join(home, "handovers"))).toEqual([]);

      const registered = run({ args: slashArgs({ home, withheld }) });
      expect(registered.status).toBe(0);
      const text = readFileSync(join(home, "handovers", `${registrationSlug({ row: slashRow })}.md`), "utf8");
      expect(text).toContain("https://github.com/acme/widgets/pull/16378 is a dependency bump that needs a session");
    });

    it("keeps the name and title when the state home carries no such directory", () => {
      const home = throwawayHome();
      expect(bumpAskUnrootable({ ask: fullAsk(), checkout: undefined, home })).toBe(false);
    });
  });
});
