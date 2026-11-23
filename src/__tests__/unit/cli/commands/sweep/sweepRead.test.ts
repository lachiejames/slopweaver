/**
 * The board read `sweep apply` and `sweep board` share, over a real handovers directory in a throwaway home.
 * The `command:` probe case uses a row with no `repo:`, which `probeStates` skips before it looks at
 * `runCommands`. So it pins how an unevaluated probe is REPORTED, not that commands stay off — a row with a repo
 * would need a real git repository to reach that branch.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sweepCandidates } from "../../../../../cli/commands/sweep/sweepRead.js";
import { type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { FetchPrClosure, PrClosure } from "../../../../../live/github/prClosure.js";
import type { SweepCandidate } from "../../../../../sweep/classify.js";
import { type SweepError, SweepErrors } from "../../../../../sweep/errors.js";
import { tableFetch, writeAsk } from "../../../sweep/boardRunFixture.js";

import { closed, merged, open } from "./sweepReadFixture.js";

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/** A throwaway state home with a handovers directory and an empty runs directory beside it. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sweep-read-"));
  roots.push(root);
  mkdirSync(join(root, "handovers"), { recursive: true });
  mkdirSync(join(root, "runs"), { recursive: true });
  return root;
}

/** One board row on disk, in the front-matter shape `scanBoard` parses. */
function writeRow({
  handoverDir,
  slug,
  status,
  blockedBy = [],
  doneWhen = "doneWhen: []",
}: {
  handoverDir: string;
  slug: string;
  status: string;
  blockedBy?: readonly string[];
  doneWhen?: string;
}): void {
  // Unquoted: the front-matter reader keeps a quoted inline-list item verbatim, quotes included.
  writeFileSync(
    join(handoverDir, `${slug}.md`),
    `---\nslug: ${slug}\nstatus: ${status}\nsummary: "what ${slug} does"\nblockedBy: [${blockedBy.join(", ")}]\n${doneWhen}\n---\n\n# ${slug}\n`,
    "utf8",
  );
}

/** The read with no GitHub seam, and the diagnostics it printed. */
async function read({
  dir,
  root,
  fetch = undefined,
  diagnostics = [],
}: {
  dir: string | undefined;
  root: string;
  fetch?: FetchPrClosure | undefined;
  diagnostics?: string[];
}): Promise<Result<readonly SweepCandidate[], SweepError>> {
  return sweepCandidates({
    dir,
    fetch,
    home: root,
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
  });
}

describe("sweepCandidates", () => {
  it("answers no candidates when the named handovers directory does not exist", async () => {
    const root = home();

    const result = await read({ dir: join(root, "no-such-dir"), root });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([]);
  });

  it("reads the home's own handovers directory when no dir is named, a probe-less row being UNWITNESSED", async () => {
    const root = home();
    writeRow({ handoverDir: join(root, "handovers"), slug: "no-probe-row", status: "ready" });

    const result = await read({ dir: undefined, root });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([
      {
        act: "none",
        path: join(root, "handovers", "no-probe-row.md"),
        slug: "no-probe-row",
        verdict: "UNWITNESSED",
        witness: "declares no doneWhen probe, so nothing here can check it — needs a witness or a detective",
      },
    ]);
  });

  it("reports a live row blocked on a rejected one as ORPHANED, and leaves the closed rejected row out", async () => {
    const root = home();
    const handoverDir = join(root, "handovers");
    writeRow({ handoverDir, slug: "a-dead-leaf", status: "rejected" });
    writeRow({ blockedBy: ["a-dead-leaf"], handoverDir, slug: "can-never-run", status: "ready" });

    const result = await read({ dir: handoverDir, root });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([
      {
        act: "settle",
        path: join(handoverDir, "can-never-run.md"),
        slug: "can-never-run",
        verdict: "ORPHANED",
        witness: "blockedBy reaches a-dead-leaf (rejected) via can-never-run -> a-dead-leaf — it can never run",
      },
    ]);
  });

  it("keeps a repo-less row whose only probe is a command, reporting that probe as declared but not evaluated", async () => {
    const root = home();
    const handoverDir = join(root, "handovers");
    writeRow({
      doneWhen: "doneWhen:\n  - command: touch ran-the-probe",
      handoverDir,
      slug: "command-probe-row",
      status: "ready",
    });

    const result = await read({ dir: handoverDir, root });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([
      {
        act: "none",
        path: join(handoverDir, "command-probe-row.md"),
        slug: "command-probe-row",
        verdict: "KEEP",
        witness: "declares 1 probe(s) that this sweep did not evaluate — re-run with --probe and a longer --deadline",
      },
    ]);
  });

  it("fails as ROW_FILE, naming the path, when the handovers path is a file rather than a directory", async () => {
    const root = home();
    const notADir = join(root, "handovers.md");
    writeFileSync(notADir, "not a directory", "utf8");

    const result = await read({ dir: notADir, root });

    expect(result.isErr()).toBe(true);
    const error = unwrapErr(result);
    expect(error.code).toBe("ROW_FILE");
    expect(error.message).toBe(
      `the board row at ${notADir} could not be handled — ENOTDIR: not a directory, scandir '${notADir}'`,
    );
    expect(error).toEqual(
      SweepErrors.rowFile({ cause: `ENOTDIR: not a directory, scandir '${notADir}'`, path: notADir }),
    );
  });
});

describe("sweepCandidates over GitHub's record", () => {
  const QUESTION =
    "Close draft https://github.com/acme/app/pull/2 as superseded by https://github.com/acme/app/pull/3?";
  const askHome = (): { root: string; handoverDir: string } => {
    const root = home();
    const handoverDir = join(root, "handovers");
    writeAsk({ handoverDir, question: QUESTION, slug: "close-draft-2" });
    return { handoverDir, root };
  };
  const table = (...entries: readonly (readonly [string, PrClosure])[]): FetchPrClosure =>
    tableFetch({ closures: new Map(entries) });

  it("settles an ask as PR_ENDED, answered, once every pull request its question names has ended", async () => {
    const { handoverDir, root } = askHome();

    const result = await read({
      dir: handoverDir,
      fetch: table(["acme/app#2", closed({ number: 2 })], ["acme/app#3", merged({ number: 3 })]),
      root,
    });

    expect(unwrap(result)).toEqual([
      {
        act: "settle",
        path: join(handoverDir, "close-draft-2.md"),
        question: "Close draft https://github.com/acme/app/pull/2 as superseded by https://github.com/acme/app/pull/3?",
        slug: "close-draft-2",
        verdict: "PR_ENDED",
        witness:
          "every pull request its question names has ended: " +
          "https://github.com/acme/app/pull/2 closed unmerged at 2026-11-07T02:00:00Z; " +
          "https://github.com/acme/app/pull/3 merged at abc3 (2026-11-03T01:00:00Z)",
      },
    ]);
  });

  it("keeps the ask while one pull request it names is still open", async () => {
    const { handoverDir, root } = askHome();

    const result = await read({
      dir: handoverDir,
      fetch: table(["acme/app#2", open({ number: 2 })], ["acme/app#3", merged({ number: 3 })]),
      root,
    });

    expect(unwrap(result).map((candidate) => candidate.verdict)).toEqual(["UNWITNESSED"]);
  });

  it("never reads an unread pull request as ended, and prints the failed read", async () => {
    const { handoverDir, root } = askHome();
    const diagnostics: string[] = [];

    const result = await read({
      diagnostics,
      dir: handoverDir,
      fetch: table(["acme/app#2", closed({ number: 2 })]),
      root,
    });

    expect(unwrap(result).map((candidate) => candidate.verdict)).toEqual(["UNWITNESSED"]);
    expect(diagnostics).toEqual([
      "sweep: could not read acme/app#3: no fixture for acme/app#3 — its row keeps the verdict the board alone gives it",
    ]);
  });

  it.each([
    [
      "a host in capitals",
      "Close https://github.com/acme/app/pull/2 as superseded by https://GITHUB.COM/acme/app/pull/3?",
    ],
    ["a bare number", "Close https://github.com/acme/app/pull/2 as superseded by #3?"],
    ["a qualified number", "Close https://github.com/acme/app/pull/2 and PR #3?"],
    ["a pull request number", "Close https://github.com/acme/app/pull/2 or pull request #3?"],
    [
      "another repository's pull request under a read number",
      "Close https://github.com/acme/app/pull/2 as superseded by https://GITHUB.COM/acme/other/pull/2?",
    ],
    // The grammar refuses each of these before any reference is weighed: it admits only `#N` and a link.
    ["a spelled-out reference", "Close https://github.com/acme/app/pull/2 once PR 3 lands?"],
    ["an emphasised reference", "Close https://github.com/acme/app/pull/2 after acme/app _PR 3_ merges?"],
    ["a joined reference", "Close https://github.com/acme/app/pull/2 after pull-request-3 merges?"],
    ["a widely spaced reference", "Close https://github.com/acme/app/pull/2 after pull  request 3 closes?"],
  ])(
    "keeps the ask when its question names a pull request the link matcher does not read — %s",
    async (_, question) => {
      const root = home();
      const handoverDir = join(root, "handovers");
      writeAsk({ handoverDir, question, slug: "close-draft-2" });

      const result = await read({
        dir: handoverDir,
        fetch: table(["acme/app#2", closed({ number: 2 })], ["acme/app#3", open({ number: 3 })]),
        root,
      });

      expect(unwrap(result).map((candidate) => candidate.verdict)).toEqual(["UNWITNESSED"]);
    },
  );

  it("settles an ask whose bare numbers each repeat a pull request it links", async () => {
    const root = home();
    const handoverDir = join(root, "handovers");
    writeAsk({
      handoverDir,
      question:
        "Close #2 (https://github.com/acme/app/pull/2) as superseded by #3 (https://github.com/acme/app/pull/3)?",
      slug: "close-draft-2",
    });

    const result = await read({
      dir: handoverDir,
      fetch: table(["acme/app#2", closed({ number: 2 })], ["acme/app#3", merged({ number: 3 })]),
      root,
    });

    expect(unwrap(result).map((candidate) => candidate.verdict)).toEqual(["PR_ENDED"]);
  });

  it("reads no pull request at all when the caller passes no seam", async () => {
    const { handoverDir, root } = askHome();

    const result = await read({ dir: handoverDir, root });

    expect(unwrap(result).map((candidate) => candidate.verdict)).toEqual(["UNWITNESSED"]);
  });
});
