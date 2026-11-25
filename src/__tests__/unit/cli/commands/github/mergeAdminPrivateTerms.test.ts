/**
 * `github merge --admin`'s private-terms step: where it sits in the order, which base it sweeps against, and which
 * verdict an acknowledgement reaches. Every edge is a plain fake over the shared admin-merge harness — no mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { performAdminMerge } from "../../../../../cli/commands/github/mergeAdminRun.js";
import type { AdminMergeRequest, GithubAdminMergeDeps } from "../../../../../cli/commands/github/mergeAdminTypes.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { hatchFor } from "../../../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../../../hatch/render.js";
import type { ChangeSetPrivateTermsVerdict } from "../../../../../hygiene/changeSetPrivateTerms.js";
import { parsePrivateTerms, WITHHELD_REFUSAL_LINE } from "../../../../../hygiene/privateTerms.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  type AdminMergeHarness,
  adminMergeHarness,
  adminMergeRequest,
  HEAD_SHA,
} from "../../../../mergeAdminRunFixture.js";

/** A just-fetched base tip distinct from every other sha the harness answers with. */
const MOVED_BASE_SHA = "e".repeat(40);

/** The synthetic private value: the hold below carries it in every field the landing renders. */
const SYNTHETIC_VALUE = "acmefixtureword";

/**
 * A hold whose loaded terms match {@link SYNTHETIC_VALUE}, carrying it in a reason and a hit's locus — fields the pure
 * core would never fill with it — so a CLI layer that printed a line around the permit's filter would leak it here.
 */
const HOLD: ChangeSetPrivateTermsVerdict = {
  hits: [
    { className: "owner-name", line: 3, locus: "src/feature.ts" },
    { className: "owner-name", line: 7, locus: `src/${SYNTHETIC_VALUE}.ts` },
  ],
  kind: "hold",
  reasons: [`a reason naming ${SYNTHETIC_VALUE}`],
  terms: unwrap(
    parsePrivateTerms({ text: `class\tflags\tpattern\tsource\nowner-name\ti\t${SYNTHETIC_VALUE}\tsynthetic\n` }),
  ),
};

/** Every printed line carrying the synthetic value, in any case. */
function leaked({ lines }: { lines: readonly string[] }): readonly string[] {
  return lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE));
}

/** The verdict on a machine with no terms file. */
const UNCHECKED: ChangeSetPrivateTermsVerdict = {
  detail: "the private terms file is not present at /h/hygiene/private-terms.tsv",
  kind: "unchecked",
  terms: [],
};

/** The last five lines an unwaived {@link UNCHECKED} prints: its own line, then the hatch row's refusal. */
const UNCHECKED_TAIL = [
  `private terms: NOT CHECKED — ${UNCHECKED.detail}`,
  ...hatchRefusalLines({ detail: UNCHECKED.detail, hatch: hatchFor({ id: "private-terms-unchecked" }) }),
];

/** The last five lines {@link HOLD} prints: the reason and the second hit withheld, since each carries the value. */
const HOLD_TAIL = [
  "private terms: HOLD — this landing is refused",
  WITHHELD_REFUSAL_LINE,
  "  src/feature.ts:3: [private-term] owner-name",
  WITHHELD_REFUSAL_LINE,
  "private terms have no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all do not reach " +
    "this hold. Reword each line named above (or repair the terms file), push, and land again; if a term is not " +
    "private, ask the chair to narrow that terms row.",
];

let home: string;
let door: MemoryDoorLedger;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-admin-terms-"));
  door = memoryDoorLedger();
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every merge argument, overridable per case, in this case's own state home. */
function request(over: Partial<AdminMergeRequest> = {}): AdminMergeRequest {
  return adminMergeRequest({ home, over });
}

/** The injected edges over this case's own door ledger, defaulting every one to the happy path. */
function harness(over: Partial<GithubAdminMergeDeps> = {}): AdminMergeHarness {
  return adminMergeHarness({ door, over });
}

/** An acknowledgement naming exactly these subjects, with no blanket flag. */
function acknowledging({ subjects }: { subjects: readonly string[] }): AdminMergeRequest["acknowledgement"] {
  return { acknowledge: subjects, acknowledgeAll: false, reason: undefined };
}

describe("performAdminMerge — the private terms over the merged change set", () => {
  it("sweeps a moved base at the tip it just fetched, against the pinned head", async () => {
    const swept: Record<string, unknown>[] = [];
    const h = harness({
      measureBaseFreshness: ({ baseBranch }) =>
        ok({
          baseBranch,
          baseSha: MOVED_BASE_SHA,
          behindBy: 3,
          headSha: HEAD_SHA,
          kind: "base-moved",
          remote: "origin",
          reverted: [],
        }),
      sweepPrivateTerms: (args) => {
        swept.push({ ...args });
        return { accepted: 0, binaryFiles: 0, kind: "clean", terms: [], textFiles: 2 };
      },
    });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({ acknowledgement: acknowledging({ subjects: ["base-moved"] }) }),
    });
    expect(code).toBe(EXIT_OK);
    expect(swept).toEqual([
      { base: { kind: "fetched", sha: MOVED_BASE_SHA }, headSha: HEAD_SHA, home, repoRoot: request().repoRoot },
    ]);
    expect(h.lines).toContain(
      "private terms: applied to the 2 changed text file(s) this landing would merge (0 binary skipped, 0 accepted line(s) set aside) — none stands",
    );
  });

  it("refuses a hold even under --acknowledge-all, before any credential, and merges nothing", async () => {
    const h = harness({ sweepPrivateTerms: () => HOLD });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({ acknowledgement: { acknowledge: [], acknowledgeAll: true, reason: "everything" } }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    // The override replaces the harness's recording default, so the sweep itself is not in `order`; the hit line is.
    expect(h.order).toEqual(["localSha", "measureBaseFreshness"]);
    expect(h.lines.slice(-5)).toEqual(HOLD_TAIL);
    expect(leaked({ lines: h.lines })).toEqual([]);
  });

  it("refuses a hold on a dry run too, so a lap's pre-check stops before its first lane", async () => {
    const h = harness({ sweepPrivateTerms: () => HOLD });
    const code = await performAdminMerge({ deps: h.deps, request: request({ execution: "dry-run" }) });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.slice(-5)).toEqual(HOLD_TAIL);
    expect(leaked({ lines: h.lines })).toEqual([]);
  });

  it("refuses an unchecked change set unless private-terms-unchecked is named", async () => {
    const h = harness({ sweepPrivateTerms: () => UNCHECKED });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.slice(-5)).toEqual(UNCHECKED_TAIL);
    expect(h.lines.slice(-2, -1)).toEqual([
      'To override use the designated escape hatch slopweaver github <enqueue|merge> --acknowledge private-terms-unchecked --reason "<why>" (merge with --admin).',
    ]);
  });

  it("refuses an unchecked change set under --acknowledge-all with a reason, which never names it", async () => {
    const h = harness({ sweepPrivateTerms: () => UNCHECKED });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({ acknowledgement: { acknowledge: [], acknowledgeAll: true, reason: "everything" } }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
    expect(h.lines.slice(-5)).toEqual(UNCHECKED_TAIL);
    expect(door.records()).toEqual([]);
  });

  it("refuses an unchecked change set named without a reason, since the waiver is recorded", async () => {
    const h = harness({ sweepPrivateTerms: () => UNCHECKED });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({ acknowledgement: acknowledging({ subjects: ["private-terms-unchecked"] }) }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.merges).toEqual([]);
  });

  it("lands an unchecked change set named with a reason, and the door ledger records the waiver", async () => {
    const h = harness({ sweepPrivateTerms: () => UNCHECKED });
    const code = await performAdminMerge({
      deps: h.deps,
      request: request({
        acknowledgement: { acknowledge: ["private-terms-unchecked"], acknowledgeAll: false, reason: "a fork" },
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(h.merges).toHaveLength(1);
    expect(h.lines).toContain("ACKNOWLEDGED: private-terms-unchecked by name — reason: a fork");
    expect((door.records().at(-1)! as { acknowledgements?: unknown }).acknowledgements).toEqual([
      { reason: "a fork", subject: "private-terms-unchecked" },
    ]);
  });

  it("still hands the sweep an unfetched base, so the terms load even with nothing to read", async () => {
    const bases: unknown[] = [];
    const h = harness({
      measureBaseFreshness: () => ok({ kind: "skipped", why: "no checkout" }),
      sweepPrivateTerms: ({ base }) => {
        bases.push(base);
        return UNCHECKED;
      },
    });
    const code = await performAdminMerge({ deps: h.deps, request: request() });
    expect(code).toBe(EXIT_ERROR);
    expect(bases).toEqual([
      {
        detail: "the base was not fetched (no checkout), so no merged change set exists to read",
        kind: "unfetched",
      },
    ]);
  });
});
