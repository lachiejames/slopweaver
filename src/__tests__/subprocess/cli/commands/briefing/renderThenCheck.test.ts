/**
 * The SHIPPED binary, both verbs, one after the other: `briefing render` writes a page from the committed
 * fixture form and `briefing check` passes it.
 *
 * This is the seam the unit lane cannot reach. The unit tests call `renderBriefing` and `checkBriefing` in
 * the same process, which proves the two functions agree; this proves the two VERBS do — the manifest entry
 * resolves, the form reaches the schema through argv and stdin, the file lands on disk, and the gate a
 * publish step actually runs reads exactly those bytes and finds nothing.
 *
 * The environment is `HOME` and `PATH` alone, so the render runs with no `profile.json` and therefore no
 * private voice rules. That is deliberate: a fixture that only passed against the operator's own machine
 * would prove nothing in CI, which is where this has to keep passing.
 *
 * For the same reason the session it names holds a live `stale-cards` grant, written under its own home: the
 * gate's freshness half re-reads every pull request a card names from GitHub, and a lane that reached the
 * network would be neither hermetic nor repeatable. What that grant buys back is itself worth having under
 * test — the shipped binary honours it, and both verbs then say IN their own report that the leg did not
 * run, rather than passing silently.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { absentAsNumber } from "#lib/absent.js";

import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { grantedEnv } from "../../../../hatchGrantFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const FORM = join(repoRoot, "src/__tests__/fixtures/briefing/fleet-briefing-form.json");

/**
 * One `slopweaver session-start --json` run, as `--your-list` reads it.
 *
 * Held here rather than as a frozen fixture of the owner's real list: the projection's own mapping is pinned in the
 * unit lane, and what this lane proves is that the DOCUMENT reaches the verb through argv and comes out as a
 * section the shipped gate then passes.
 */
const SESSION_START = {
  nowIso: "2026-09-01T04:09:30.684Z",
  ranking: {
    ranked: [
      {
        item: {
          doneWhen: "Land the render verb yourself, and say so on the board.",
          nativeId: "a-run",
          source: "handover",
          whenIso: "2026-08-31T02:26:50.911Z",
          where: "slopweaver handover resume a-run",
          who: "the a-run session",
        },
        score: 12,
        trace: { verdict: "rank" },
        why: "somebody is stopped waiting on you",
      },
      {
        item: {
          doneWhen: "Answer the second row.",
          nativeId: "b-run",
          source: "handover",
          whenIso: "2026-08-30T02:26:50.911Z",
          where: "slopweaver handover resume b-run",
          who: "the b-run session",
        },
        score: 4,
        trace: { verdict: "rank" },
        why: "one reply finishes it",
      },
    ],
  },
};

/**
 * The same run, stamped as if the publish tail had just generated it.
 *
 * `briefing render` refuses a `--your-list` document snapshotted more than ninety minutes before the render
 * (`src/briefing/snapshotAge.ts`), so the constant's frozen instant is stale the moment it is read by a real
 * clock. A test that wants the projection has to hand over a document a real publish would have handed over,
 * and the frozen one is what the refusal case below feeds in instead.
 *
 * @returns the session-start document with its own instant set to now
 */
function justRun(): Record<string, unknown> {
  return { ...SESSION_START, nowIso: new Date().toISOString() };
}

let home: string;
let grantEnv: Readonly<Record<string, string>>;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-briefing-render-"));
  grantEnv = grantedEnv({ hatchIds: ["stale-cards"], home });
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Run the shipped binary with an isolated environment and an optional stdin body.
 *
 * `spawnSync` rather than `execFileSync` because BOTH streams matter here: the page goes to stdout and the
 * gate's own report goes to stderr, and `execFileSync` returns only the first while letting the second
 * escape into the test runner's own output.
 */
function run({ args, stdin }: { args: readonly string[]; stdin: string }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(BIN, args, {
    cwd: home,
    encoding: "utf8",
    env: { ...grantEnv, HOME: home, PATH: process.env["PATH"]!, ...accountSandboxChildEnv() },
    input: stdin,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    status: absentAsNumber({ value: result.status, whenAbsent: -1 }),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("bin/slopweaver briefing render, then check", () => {
  it("renders the fixture form and the shipped gate passes the page", { timeout: 60_000 }, () => {
    const page = join(home, "fleet-briefing.html");

    const rendered = run({
      args: ["briefing", "render", "--form", "-", "--out", page, "--home", home],
      stdin: readFileSync(FORM, "utf8"),
    });
    expect(rendered.status).toBe(0);
    expect(rendered.stderr).toContain(
      "briefing render: no list of yours, 1 react-now card(s) (1 team-facing, 0 yours), 0 artifact(s) " +
        "directing you elsewhere, 1 recent block(s), 2 folded section(s)",
    );

    const checked = run({ args: ["briefing", "check", page, "--home", home], stdin: "" });
    expect(checked.status).toBe(0);
    expect(checked.stdout.trim().split("\n")).toEqual([
      "1 card(s) checked under react-now, no defects",
      "shape: react-now first, the groupings in order, both instants stated",
      "page: 74 words and 0 unfolded block(s) above the fold outside the cards, inside budget",
      "alignment: stated in 20 words above the fold",
      "sections: 7 level(s) outside the cards read, every fleet word glossed where you can see it",
      "autonomy ledger: nothing has been done autonomously, or the page was rendered without --autonomy-ledger",
      "one index: 0 row(s) of yours in 0 words, 0 artifact(s) linked, every anchor lands",
      "corrections: not stamped — a first publish, or a republish that skipped `briefing corrections`",
      "correction block: nothing is waiting on your mark, or the page was rendered without --owner-beliefs",
      "quiz: this sweep asked nothing, or the page was rendered without --knowledge-quiz",
      "bare references: none found",
      "fold residue: none found",
      "blocked on the owner: nothing waiting on them, or the ask-lifecycle log was not read",
      "gone quiet: every standing row is posting on its cadence, or the recipe store was not read",
      "live premises: no card names a pull request, or the freshness leg did not run",
    ]);
  });

  it("refuses a wall before it writes anything, so no page reaches disk", { timeout: 60_000 }, () => {
    const page = join(home, "refused.html");
    const form = JSON.parse(readFileSync(FORM, "utf8")) as { reactNow: { teamFacing: { what: unknown }[] } };
    const wall = Array.from({ length: 61 }, () => "alpha").join(" ");
    form.reactNow.teamFacing[0]!.what = [{ kind: "text", text: `${wall}. And one more sentence.` }];

    const refused = run({
      args: ["briefing", "render", "--form", "-", "--out", page, "--home", home],
      stdin: JSON.stringify(form),
    });

    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("reactNow.teamFacing.0.what: what runs over the cap of 60 words above the fold.");
    expect(run({ args: ["briefing", "check", page, "--home", home], stdin: "" }).stderr).toContain(
      `briefing check: no such file: ${page}`,
    );
  });

  // The owner's list once placed each row against a constant, so the shipped binary could render one in a home
  // with no store. Rows are now placed against the organisation, which lives
  // only in the store this lane has none of; the projection and the stale-list refusal are pinned in the unit lane
  // (`unit/cli/briefingRender.test.ts`) against an injected organisation, and this lane pins the refusal.
  it(
    "refuses the owner's list in a home with no store, naming the organisation it could not read, and writes no page",
    { timeout: 60_000 },
    () => {
      const page = join(home, "one-index.html");
      const document = join(home, "session-start.json");
      writeFileSync(document, JSON.stringify(justRun()), "utf8");
      const form = JSON.parse(readFileSync(FORM, "utf8")) as Record<string, unknown>;

      const refused = run({
        args: [
          "briefing",
          "render",
          "--form",
          "-",
          "--your-list",
          document,
          "--top",
          "1",
          "--out",
          page,
          "--home",
          home,
        ],
        stdin: JSON.stringify(form),
      });

      // A failed read, never the caller's mistake, so it exits 1 rather than as a usage refusal.
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("refused: the organisation could not be read from the store: ");
      expect(refused.stderr).toContain("nothing was rendered.");
      expect(existsSync(page)).toBe(false);
    },
  );

  it(
    "refuses a form that writes `yourList` itself, so the projection stays the only way in",
    { timeout: 60_000 },
    () => {
      const page = join(home, "authored.html");
      const form = JSON.parse(readFileSync(FORM, "utf8")) as Record<string, unknown>;
      form["yourList"] = { notShown: 0, rows: [], source: "hand-written" };

      const refused = run({
        args: ["briefing", "render", "--form", "-", "--out", page, "--home", home],
        stdin: JSON.stringify(form),
      });

      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain("the form writes `yourList` itself.");
    },
  );
});

// The four-process autonomy chain (record, steer, list, render, check) ran here while `autonomy record` wrote a
// home FILE, which a lane with no store could hold. That writer is gone and the chain now needs a real store, so it
// lives opt-in in `autonomyLedgerChain.test.ts` beside this file rather than as a skipped case inside it.
describe("bin/slopweaver briefing render --autonomy-ledger with no store", () => {
  it("REFUSES to render a page from a ledger it cannot read, rather than claiming the fleet did nothing", () => {
    const page = join(home, "never-written.html");
    const rendered = run({
      args: ["briefing", "render", "--form", "-", "--autonomy-ledger", "--out", page, "--home", home],
      stdin: readFileSync(FORM, "utf8"),
    });
    expect(rendered.status).toBe(2);
    expect(rendered.stderr).toContain("the autonomy register could not be read");
    expect(existsSync(page)).toBe(false);
  });
});
