/**
 * `github landing`'s production edges, over a state home this test owns.
 *
 * The split that created `landingDeps.ts` moved a whole effectful shell out of the verb, and the risk a split
 * like that carries is a DROPPED edge — the bag still typechecks against its interface while one seam quietly
 * answers nothing. These cases call the factory and exercise the three seams a test can reach without a
 * credential: the clock, the organisation read, and the board read over an empty home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AutonomyStoreErrors } from "../../../../../autonomy/storeErrors.js";
import { readBoardBranches } from "../../../../../cli/commands/github/landingBoardRead.js";
import { productionGithubLandingDeps } from "../../../../../cli/commands/github/landingDeps.js";
import type { PressLedgerRow } from "../../../../../cli/commands/github/landingPressRow.js";
import { boardJoin, plannedRegistrations } from "../../../../../cli/commands/github/landingRegister.js";
import { pressLedgerActs } from "../../../../../cli/commands/github/pressLedgerCheck.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { liveBoardHold } from "../../../../../review/landingBoard.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  memoryAutonomyLedgerPort,
  memoryAutonomyStore,
  seedAutonomyRecords,
  unavailableAutonomyLedgerPort,
} from "../../../../autonomyLedgerFixture.js";
import { landingRowFake } from "../../../../landingRowFake.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const minted: string[] = [];

/** A state home with nothing in it, so a read over it has to answer empty rather than throw. */
function emptyHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "landing-deps-"));
  minted.push(dir);
  return dir;
}

/** What the store's checked entrance says over a home that selects no database. */
const NO_STORE_SELECTED =
  "refusing to reach the store: no database is selected. " +
  "A tool that picks its own database is a tool that can run against the wrong one, so nothing here defaults " +
  "one. Select it once with `slopweaver secrets set store-url` (remembered under $SLOPWEAVER_HOME/secrets at " +
  "0600, which is what every later process — a bot turn included — reads), or export SLOPWEAVER_STORE_URL " +
  "for one run.";

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("productionGithubLandingDeps", () => {
  it("answers a real clock", () => {
    expect(Number.isNaN(productionGithubLandingDeps().now().getTime())).toBe(false);
  });

  it("refuses the organisation read over a home that selects no store, so no repository list is guessed", async () => {
    const refusal = unwrapErr(await productionGithubLandingDeps().readOrganisation({ home: emptyHome() }));
    expect(refusal.code).toBe("ORG_QUERY_FAILED");
    expect(refusal.message).toBe(`the organisation could not be read from the store: ${NO_STORE_SELECTED}`);
  });

  it("reads an empty board over a home with none, and refuses the press register and readings ledger over a home that selects no store", async () => {
    const deps = productionGithubLandingDeps();
    const dir = emptyHome();

    expect(deps.boardBranches({ home: dir }).size).toBe(0);
    expect(unwrapErr(await deps.presses({ home: dir })).code).toBe("PRESS_STORE_UNAVAILABLE");
    expect(unwrapErr(await deps.reads({ home: dir })).code).toBe("READ_STORE_UNAVAILABLE");
  });

  it("keys the board read by the BRANCH a row declares, carrying that row's slug, status and repository", () => {
    const dir = emptyHome();
    const board = join(dir, "handovers");
    mkdirSync(board, { recursive: true });
    writeFileSync(
      join(board, "a-row.md"),
      "---\nslug: a-row\nstatus: ready\nrepo: Acme/Widgets.git\nbranch: renovate/zod-4.x\n---\n",
    );
    writeFileSync(join(board, "no-branch.md"), "---\nslug: no-branch\nstatus: ready\n---\n");

    const branches = readBoardBranches({ home: dir });

    expect([...branches.keys()]).toEqual(["renovate/zod-4.x"]);
    expect(branches.get("renovate/zod-4.x")).toEqual([
      { kind: "row", repoSlug: "acme/widgets", run: "never-started", slug: "a-row", status: "ready" },
    ]);
  });

  // A settled ask keeps `status: ready` in its own file on purpose, so the line alone listed ten settled rows
  // as dispatchable work that `cmux spawn` then refused.
  it("reads a settled ask's DERIVED status, not the `status: ready` line its own file keeps", () => {
    const dir = emptyHome();
    const board = join(dir, "handovers");
    mkdirSync(board, { recursive: true });
    writeFileSync(
      join(board, "land-acme-widgets-1-1111111.md"),
      "---\nslug: land-acme-widgets-1-1111111\nkind: ask\nstatus: ready\nbranch: feature/one\n" +
        "settlement: answered\nsettlementWitness: https://github.com/acme/widgets/pull/1\n---\n",
    );

    expect(readBoardBranches({ home: dir }).get("feature/one")).toEqual([
      {
        kind: "row",
        run: "never-started",
        settlementWitness: "https://github.com/acme/widgets/pull/1",
        slug: "land-acme-widgets-1-1111111",
        status: "done",
      },
    ]);
  });

  // The whole read composed: a landing row was settled `answered` with a witness naming a head
  // and its file still read `status: ready`, and `--register` skipped its pull request
  // as "already holds this branch and is ready" for three passes while `cmux spawn` refused the row as
  // settled. The file on disk, the production board read, the join and the plan, with nothing injected between.
  describe("a settled ask on disk and the landing row for the same pull request", () => {
    const settledHome = (): string => {
      const dir = emptyHome();
      mkdirSync(join(dir, "handovers"), { recursive: true });
      writeFileSync(
        join(dir, "handovers", "land-acme-widgets-16378-4d43359-cr.md"),
        "---\nslug: land-acme-widgets-16378-4d43359-cr\nkind: ask\nstatus: ready\nrepo: acme/widgets\n" +
          "branch: feature/one\nsettlement: answered\n" +
          "settlementWitness: acme/widgets#16378 @ 1928e87ca4: threads answered and resolved\n---\n",
      );
      return dir;
    };
    const planned = ({ home, headOid }: { home: string; headOid: string }): string | undefined => {
      const joined = boardJoin({ deps: productionGithubLandingDeps(), home });
      const row = landingRowFake({
        dispatch: { kind: "act", verdict: "rebase-and-fix", why: "required check(s) failing: build" },
        headOid,
      });
      return plannedRegistrations({ dispatchable: [{ ...row, boardRow: joined(row) }] })[0]!.skip;
    };

    it("registers the pull request's own row once its head has moved past the settled one", () => {
      expect(planned({ headOid: "5".repeat(40), home: settledHome() })).toBeUndefined();
    });

    it("holds it at the head the settlement's witness names, because that head's ending is on the board", () => {
      expect(planned({ headOid: `1928e87ca4${"0".repeat(30)}`, home: settledHome() })).toBe(
        "land-acme-widgets-16378-4d43359-cr already ended at this head and is done",
      );
    });
  });

  it("reads a row whose journal records it CLOSED as done", () => {
    const dir = emptyHome();
    mkdirSync(join(dir, "handovers"), { recursive: true });
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "handovers", "a-row.md"), "---\nslug: a-row\nstatus: ready\nbranch: feature/one\n---\n");
    writeFileSync(
      join(dir, "runs", "a-row.jsonl"),
      `${JSON.stringify({ atIso: "2026-09-23T19:00:00.000Z", kind: "closed", residue: [], summary: "shipped" })}\n`,
    );

    expect(readBoardBranches({ home: dir }).get("feature/one")).toEqual([
      { kind: "row", run: "never-started", slug: "a-row", status: "done" },
    ]);
  });

  // An ask row declares no `branch:`, but its seat ran `handover start`, which records the branch
  // its pull request rides. 9 of 18 drafts the read called orphaned were held by runs parked on CI this way.
  it("keys an ask row with no `branch:` by the branch its run journal recorded at `handover start`", () => {
    const dir = emptyHome();
    mkdirSync(join(dir, "handovers"), { recursive: true });
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "handovers", "an-ask.md"), "---\nslug: an-ask\nkind: ask\nstatus: ready\n---\n");
    writeFileSync(
      join(dir, "runs", "an-ask.jsonl"),
      `${JSON.stringify({ atIso: "2026-11-03T17:00:00.000Z", branch: "an-ask", docHash: "abc", kind: "started" })}\n`,
    );

    const branches = readBoardBranches({ home: dir });

    expect([...branches.keys()]).toEqual(["an-ask"]);
    expect(branches.get("an-ask")).toEqual([{ kind: "row", run: "active", slug: "an-ask", status: "ready" }]);
  });

  // A review offered this as a counterexample; it is the chosen direction. A newer kind an older build cannot
  // decode is the common unreadable line in one shared home, and dropping the key would re-orphan that run.
  it("keeps a decoded `started` branch beside an undecodable line, reading the run as unreadable", () => {
    const dir = emptyHome();
    mkdirSync(join(dir, "handovers"), { recursive: true });
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "handovers", "an-ask.md"), "---\nslug: an-ask\nkind: ask\nstatus: ready\n---\n");
    writeFileSync(
      join(dir, "runs", "an-ask.jsonl"),
      `${JSON.stringify({ atIso: "2026-11-03T17:00:00.000Z", branch: "an-ask", docHash: "abc", kind: "started" })}\n{\n`,
    );

    expect(readBoardBranches({ home: dir }).get("an-ask")).toEqual([
      { kind: "row", run: "unreadable", slug: "an-ask", status: "ready" },
    ]);
  });

  it("never keys a row by its slug alone: an ask with no `branch:` and no run is absent", () => {
    const dir = emptyHome();
    mkdirSync(join(dir, "handovers"), { recursive: true });
    writeFileSync(join(dir, "handovers", "an-ask.md"), "---\nslug: an-ask\nkind: ask\nstatus: ready\n---\n");

    expect(readBoardBranches({ home: dir }).size).toBe(0);
  });

  it("keys a row under BOTH its declared branch and a different one its run recorded, once each", () => {
    const dir = emptyHome();
    mkdirSync(join(dir, "handovers"), { recursive: true });
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "handovers", "a-row.md"), "---\nslug: a-row\nstatus: ready\nbranch: feature/one\n---\n");
    writeFileSync(
      join(dir, "runs", "a-row.jsonl"),
      `${JSON.stringify({ atIso: "2026-11-03T17:00:00.000Z", branch: "feature/two", docHash: "abc", kind: "started" })}\n`,
    );

    const branches = readBoardBranches({ home: dir });

    // Recorded first: `statedBranches`' order, so the key the run is working is the one a reader meets first.
    expect([...branches.keys()]).toEqual(["feature/two", "feature/one"]);
    expect(branches.get("feature/one")).toEqual([{ kind: "row", run: "active", slug: "a-row", status: "ready" }]);
    expect(branches.get("feature/two")).toEqual(branches.get("feature/one"));
  });

  it("keys a re-started run by its CURRENT cycle's branch, never an earlier cycle's", () => {
    const dir = emptyHome();
    mkdirSync(join(dir, "handovers"), { recursive: true });
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "handovers", "an-ask.md"), "---\nslug: an-ask\nkind: ask\nstatus: ready\n---\n");
    writeFileSync(
      join(dir, "runs", "an-ask.jsonl"),
      `${JSON.stringify({ atIso: "2026-11-03T16:00:00.000Z", branch: "old", docHash: "abc", kind: "started" })}\n` +
        `${JSON.stringify({ atIso: "2026-11-03T16:30:00.000Z", kind: "closed", residue: [], summary: "first" })}\n` +
        `${JSON.stringify({ atIso: "2026-11-03T17:00:00.000Z", branch: "new", docHash: "abc", kind: "started" })}\n`,
    );

    expect([...readBoardBranches({ home: dir }).keys()]).toEqual(["new"]);
  });

  it("keeps a CLOSED run keyed by its recorded branch, as done, so it holds nothing but its ending", () => {
    const dir = emptyHome();
    mkdirSync(join(dir, "handovers"), { recursive: true });
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "handovers", "an-ask.md"), "---\nslug: an-ask\nkind: ask\nstatus: ready\n---\n");
    writeFileSync(
      join(dir, "runs", "an-ask.jsonl"),
      `${JSON.stringify({ atIso: "2026-11-03T16:00:00.000Z", branch: "an-ask", docHash: "abc", kind: "started" })}\n` +
        `${JSON.stringify({ atIso: "2026-11-03T16:30:00.000Z", kind: "closed", residue: [], summary: "shipped" })}\n`,
    );

    const row = readBoardBranches({ home: dir }).get("an-ask")![0]!;

    expect(row).toEqual({ kind: "row", run: "closed", slug: "an-ask", status: "done" });
    expect(liveBoardHold({ boardRow: row })).toBeUndefined();
  });

  it("keeps EVERY row declaring one branch, rather than whichever the scan read last", () => {
    const dir = emptyHome();
    const board = join(dir, "handovers");
    mkdirSync(board, { recursive: true });
    writeFileSync(join(board, "a-one.md"), "---\nslug: a-one\nstatus: ready\nbranch: feature/one\n---\n");
    writeFileSync(join(board, "a-two.md"), "---\nslug: a-two\nstatus: in-progress\nbranch: feature/one\n---\n");

    expect(readBoardBranches({ home: dir }).get("feature/one")).toEqual([
      { kind: "row", run: "never-started", slug: "a-one", status: "ready" },
      { kind: "row", run: "never-started", slug: "a-two", status: "in-progress" },
    ]);
  });

  // A `repo:` path that was a linked worktree read as ANOTHER repository beside the
  // declared main checkout, so this repository's own settled row fell out of the join. Seven rows on the live
  // board carried a worktree or fleet path.
  it(
    "resolves a repo path through its checkout's origin, a linked worktree included, and leaves the unprovable unresolved",
    () => {
      const dir = emptyHome();
      const main = join(dir, "main");
      mkdirSync(main);
      gitInTemp({ args: ["init", "--quiet"], cwd: main });
      gitInTemp({ args: ["remote", "add", "origin", "git@github.com:acme/widgets.git"], cwd: main });
      gitInTemp({
        args: ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--quiet", "--allow-empty", "-m", "seed"],
        cwd: main,
      });
      const worktree = join(dir, "wt");
      gitInTemp({ args: ["worktree", "add", "--quiet", worktree], cwd: main });
      const board = join(dir, "handovers");
      mkdirSync(board, { recursive: true });
      const rowWith = ({ slug, repo }: { slug: string; repo: string }): void => {
        writeFileSync(
          join(board, `${slug}.md`),
          `---\nslug: ${slug}\nstatus: ready\nrepo: ${repo}\nbranch: feat/x\n---\n`,
        );
      };
      rowWith({ repo: worktree, slug: "a-worktree" });
      rowWith({ repo: "https://github.com/acme/widgets", slug: "b-url" });
      rowWith({ repo: join(dir, "gone"), slug: "c-gone" });
      rowWith({ repo: "null", slug: "d-null" });
      rowWith({ repo: "~/dev/widgets", slug: "e-home" });
      rowWith({ repo: "ssh://git@ssh.github.com:443/acme/widgets.git", slug: "f-port" });
      rowWith({ repo: "https://github.com/acme/widgets/pull/16378", slug: "g-pr-url" });
      rowWith({ repo: "acme/widgets.GIT", slug: "h-upper-git" });

      const rows = readBoardBranches({ home: dir }).get("feat/x")!;

      expect(rows).toEqual([
        { kind: "row", repoSlug: "acme/widgets", run: "never-started", slug: "a-worktree", status: "ready" },
        { kind: "row", repoSlug: "acme/widgets", run: "never-started", slug: "b-url", status: "ready" },
        { kind: "row", run: "never-started", slug: "c-gone", status: "ready" },
        { kind: "row", run: "never-started", slug: "d-null", status: "ready" },
        { kind: "row", run: "never-started", slug: "e-home", status: "ready" },
        { kind: "row", run: "never-started", slug: "f-port", status: "ready" },
        { kind: "row", run: "never-started", slug: "g-pr-url", status: "ready" },
        { kind: "row", repoSlug: "acme/widgets", run: "never-started", slug: "h-upper-git", status: "ready" },
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

/** One press row as the landing writes it, under a given id. */
const pressRow = ({ actionId }: { actionId: string }): PressLedgerRow => ({
  actionId,
  bySession: "workspace:137",
  doneIso: "2026-09-28T05:11:09.856Z",
  kind: "press-merge-when-ready",
  subject: "https://github.com/acme/widgets/pull/16378",
  why: "every one of the six landing tests passed and nothing needing the owner's judgment was on it at press time",
  witness: "slopweaver github landing --press -> enqueued acme/widgets#16378 at head 1111111",
});

// The six filesystem preflight cases (an unwritable or unsearchable `ledgers/`, a plain file where a directory goes,
// a dangling link, a read-only register) went with the preflight: a press no longer writes a home file, so there is
// no place on disk left to check before it.
describe("the autonomy-ledger edges the press checks BEFORE it presses", () => {
  /** The refusal the store-backed port answers over a home that selects no store. */
  const NO_STORE_REFUSAL = AutonomyStoreErrors.storeUnavailable({ doing: "be opened", reason: NO_STORE_SELECTED });

  it("answers an empty ledger over a store that holds no row yet", async () => {
    expect(unwrap(await pressLedgerActs({ autonomy: memoryAutonomyLedgerPort(), home: emptyHome() }))).toEqual([]);
  });

  it("answers the acts it holds and leaves the owner's steers out", async () => {
    const autonomy = memoryAutonomyLedgerPort();
    await seedAutonomyRecords({
      port: autonomy,
      records: [
        pressRow({ actionId: "enqueue-acme.widgets-1-a" }),
        {
          actionId: "enqueue-acme.widgets-1-a",
          bySession: "supervisor",
          steer: "yes, keep pressing those",
          steeredIso: "2026-09-28T06:00:00.000Z",
        },
      ],
    });
    const acts = unwrap(await pressLedgerActs({ autonomy, home: emptyHome() }));
    expect(acts.map((act) => act.actionId)).toEqual(["enqueue-acme.widgets-1-a"]);
  });

  it("refuses with the store's own outage, so a press never runs while its row could not be written", async () => {
    expect(unwrapErr(await pressLedgerActs({ autonomy: unavailableAutonomyLedgerPort(), home: emptyHome() }))).toBe(
      AUTONOMY_FIXTURE_OUTAGE.message,
    );
  });

  it("refuses while a register still standing in the home has not been imported, rather than reading empty", async () => {
    const store = memoryAutonomyStore();
    store.source = { kind: "present" };
    expect(unwrapErr(await pressLedgerActs({ autonomy: memoryAutonomyLedgerPort({ store }), home: emptyHome() }))).toBe(
      AutonomyStoreErrors.notImported({ sourcePath: "/fixture-home/ledgers/autonomy.jsonl" }).message,
    );
  });

  // The acts guard against a second press, so a row nobody could read may be exactly the row that stops one.
  it("refuses a ledger with a row it could not read, naming the row, rather than pressing past it", async () => {
    const store = memoryAutonomyStore();
    const autonomy = memoryAutonomyLedgerPort({ store });
    await seedAutonomyRecords({ port: autonomy, records: [pressRow({ actionId: "enqueue-acme.widgets-1-a" })] });
    store.rows.push({
      actionId: "enqueue-acme.widgets-2-b",
      entryKind: "action",
      importKey: "line:2",
      occurredAt: new Date("2026-09-28T05:12:00.000Z"),
      record: { actionId: "enqueue-acme.widgets-2-b", note: "half a row" },
    });
    expect(unwrapErr(await pressLedgerActs({ autonomy, home: emptyHome() }))).toContain(
      "autonomy_event line:2 holds a record that is not an act, a steer or a class steer (",
    );
  });

  it("refuses the production read over a home that selects no store, naming the store", async () => {
    expect(unwrapErr(await productionGithubLandingDeps().ledgerActs({ home: emptyHome() }))).toBe(
      NO_STORE_REFUSAL.message,
    );
  });

  it("says why a row could not be written rather than throwing, since the press already happened", async () => {
    expect(
      await productionGithubLandingDeps().recordAutonomy({
        home: emptyHome(),
        row: pressRow({ actionId: "enqueue-acme.widgets-1-a" }),
      }),
    ).toBe(NO_STORE_REFUSAL.message);
  });
});
