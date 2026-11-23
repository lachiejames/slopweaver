/**
 * The throwaway home, board rows and captured seams `sweep board`'s end-to-end tests share
 * (`./boardRun.test.ts`, `./boardRunUncarded.test.ts`).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type SweepBoardDeps } from "../../../cli/commands/sweep/boardRun.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { err, ok } from "../../../lib/result.js";
import { GithubLiveErrors } from "../../../live/github/errors.js";
import type { FetchPrClosure, PrClosure } from "../../../live/github/prClosure.js";

const roots: string[] = [];

/** Remove every home {@link home} minted; each test file calls it from its own `afterEach`. */
export function removeHomes(): void {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
}

/**
 * One board row on disk, in the front-matter shape `scanBoard` parses.
 *
 * @param blockedBy slugs this row waits on, written unquoted
 */
export function writeRow({
  handoverDir,
  slug,
  status,
  blockedBy = [],
}: {
  handoverDir: string;
  slug: string;
  status: string;
  blockedBy?: readonly string[];
}): void {
  // Unquoted: the front-matter reader keeps a quoted inline-list item VERBATIM, quotes included, so a
  // `blockedBy: ["x"]` edge resolves against no slug at all and the row reads unblocked.
  const blocked = blockedBy.join(", ");
  writeFileSync(
    join(handoverDir, `${slug}.md`),
    `---\nslug: ${slug}\nstatus: ${status}\nsummary: "what ${slug} does"\nblockedBy: [${blocked}]\ndoneWhen: []\n---\n\n# ${slug}\n`,
    "utf8",
  );
}

/**
 * One live, never-started ask on disk whose `summary:` is the question — the shape the `PR_ENDED` verdict reads.
 *
 * @param question the ask's question, naming the pull requests under test
 */
export function writeAsk({
  handoverDir,
  slug,
  question,
}: {
  handoverDir: string;
  slug: string;
  question: string;
}): void {
  writeFileSync(
    join(handoverDir, `${slug}.md`),
    `---\nslug: ${slug}\nkind: ask\nsummary: "${question}"\nstatus: ready\naskedIso: 2026-11-04T08:00:00.000Z\n` +
      `blockedBy: []\nartifact: null\ndoneWhen: []\n---\n\n# ${slug}\n`,
    "utf8",
  );
}

/**
 * One registered ask on disk carrying its whole shape, which is what parks a row with no run on the owner's Queue.
 *
 * @param question the ask's question
 */
export function writeQueueAsk({
  handoverDir,
  slug,
  question,
}: {
  handoverDir: string;
  slug: string;
  question: string;
}): void {
  writeFileSync(
    join(handoverDir, `${slug}.md`),
    `---\nslug: ${slug}\nkind: ask\nsummary: "${question}"\nstatus: ready\naskedIso: 2026-11-04T08:00:00.000Z\n` +
      `problem: "which one"\nlean: "the first"\noptions:\n  - option: "first"\n    tradeoff: "quick"\n` +
      `  - option: "second"\n    tradeoff: "thorough"\nblockedBy: []\nartifact: null\ndoneWhen: []\n---\n\n# ${slug}\n`,
    "utf8",
  );
}

/**
 * A throwaway state home with a handovers directory and an empty runs directory beside it.
 *
 * @returns the home's path
 */
export function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sweep-board-"));
  roots.push(root);
  mkdirSync(join(root, "handovers"), { recursive: true });
  mkdirSync(join(root, "runs"), { recursive: true });
  return root;
}

/** No ruling and no hand step — the registers of a fresh install. */
const EMPTY_PAGE_REACH: SweepBoardDeps["pageReach"] = {
  handSteps: () => ok([]),
  ruledIdentities: () => ok(new Set<string>()),
};

/**
 * A closure seam answering from a fixed table, keyed `owner/repo#number` lowercased; any other pull request is a
 * failed read, and every ask is pushed to `asked`.
 *
 * @param closures what GitHub "says" about each pull request
 * @param asked where each read's key is pushed
 * @returns the seam
 */
export function tableFetch({
  closures,
  asked = [],
}: {
  closures: ReadonlyMap<string, PrClosure>;
  asked?: string[];
}): FetchPrClosure {
  return ({ owner, repo, number }) => {
    const key = `${owner}/${repo}#${String(number)}`.toLowerCase();
    asked.push(key);
    const known = closures.get(key);
    if (known === undefined) {
      return Promise.resolve(err(GithubLiveErrors.invalidAddress({ message: `no fixture for ${key}` })));
    }
    return Promise.resolve(ok(known));
  };
}

/** Settle writes that refuse everything — no default test reaches them, and one that does fails visibly. */
const REFUSING_SETTLE: SweepBoardDeps["endedSettle"] = () => ({
  appendLedger: () => err({ message: "no ledger in this fixture" }),
  nowIso: () => "2026-11-08T07:00:00.000Z",
  recordAutonomy: () => Promise.resolve("no autonomy ledger in this fixture"),
  settleRow: () => Promise.resolve(1),
  writeDiagnostic: () => undefined,
});

/** Automatic-act writes that refuse everything — no default test reaches them, and one that does fails visibly. */
const REFUSING_ACTS: SweepBoardDeps["shippedClose"] = () => ({
  appendLedger: () => err({ message: "no ledger in this fixture" }),
  nowIso: () => "2026-11-08T07:00:00.000Z",
  observe: () => ok("unchanged"),
  recordAutonomy: () => Promise.resolve("no autonomy ledger in this fixture"),
  runVerb: () => Promise.resolve(1),
  writeDiagnostic: () => undefined,
});

/**
 * Seams that record what the verb printed and registered, on a fixed clock.
 *
 * @param pageReach the lock-in ledger and hand register readers, empty by default
 * @param registered where each `--queue` registration's argv is pushed
 * @param registerExit what the registrar answers
 * @param closures what the closure seam answers, nothing by default
 * @param endedSettle the `--settle-ended` writes, refusing by default
 * @param shippedClose the `--close-shipped` writes, refusing by default
 * @param cardRetire the `--queue` own-card retirement writes, refusing by default
 * @returns the deps and the two captured output channels
 */
export function capture({
  pageReach = EMPTY_PAGE_REACH,
  registered = [],
  registerExit = EXIT_OK,
  closures = new Map(),
  endedSettle = REFUSING_SETTLE,
  shippedClose = REFUSING_ACTS,
  cardRetire = REFUSING_ACTS,
}: {
  pageReach?: SweepBoardDeps["pageReach"];
  registered?: (readonly string[])[];
  registerExit?: number;
  closures?: ReadonlyMap<string, PrClosure>;
  endedSettle?: SweepBoardDeps["endedSettle"];
  shippedClose?: SweepBoardDeps["shippedClose"];
  cardRetire?: SweepBoardDeps["cardRetire"];
} = {}): { deps: SweepBoardDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      cardRetire,
      endedSettle,
      shippedClose,
      now: () => new Date("2026-11-03T07:00:00.000Z"),
      pageReach,
      prClosure: () => tableFetch({ closures }),
      registerQueueRow: ({ argv }) => {
        registered.push(argv);
        return Promise.resolve(registerExit);
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}
