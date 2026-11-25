/**
 * The effectful shell of the `heap-ceiling-ratchet` gate: read the tree's ceilings and pins, read the base
 * commit's, judge, print. The criterion, the rulings and the residue are `./heapCeilingRatchet.ts`'s header.
 *
 * The HEAD side is the WORKING TREE, as `coverage-ratchet` and `test-enshittification` read it: in CI that
 * is the merge commit; locally it is what is about to be committed. The BASE side is `git show` at
 * `SLOPWEAVER_COVERAGE_BASE_SHA`, through `./gitAtCommit.ts`. No base, or a base commit this checkout cannot
 * read, is `incomplete`, never a pass — a run with no base, or a shallow clone missing it, would otherwise skip
 * the half that matters. Only a brand-new ref's all-zeroes base, confirmed against HEAD, skips it, and says so.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { gitShow, gitSucceeds, resolveFloorBase } from "./gitAtCommit.js";
import { type HeapRaise, judgeAgainstBase, judgeHeadPins, PINS_PATH, readHeapPins } from "./heapCeilingRatchet.js";
import {
  CEILING_MANIFESTS,
  CEILING_SOURCE_PATHS,
  type CeilingSourceTexts,
  treeCeilings,
} from "./heapCeilingSubjects.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/** One side's source texts, or why one of them could not be read. */
type SourceTexts =
  { readonly kind: "texts"; readonly texts: CeilingSourceTexts } | { readonly kind: "unread"; readonly why: string };

/**
 * Read every source file through one reader.
 *
 * @param read returns a repo-relative path's text, or `undefined` when it cannot be read
 * @param side names the side, for the message
 * @returns the texts, or which file could not be read
 */
function readSources({ read, side }: { read: (path: string) => string | undefined; side: string }): SourceTexts {
  const gateGroups = read(CEILING_SOURCE_PATHS.gateGroups);
  const heapBudget = read(CEILING_SOURCE_PATHS.heapBudget);
  const manifests = new Map<string, string>();
  for (const manifest of CEILING_MANIFESTS) {
    const text = read(manifest);
    if (text !== undefined) {
      manifests.set(manifest, text);
    }
  }
  if (gateGroups === undefined || heapBudget === undefined || manifests.size !== CEILING_MANIFESTS.length) {
    const paths = [...Object.values(CEILING_SOURCE_PATHS), ...CEILING_MANIFESTS].join(", ");
    return { kind: "unread", why: `cannot read the ${side}'s ${paths}` };
  }
  return { kind: "texts", texts: { gateGroups, heapBudget, manifests } };
}

/**
 * Read one repo-relative working-tree file.
 *
 * @param root the repository root
 * @param path the file, repo-relative
 * @returns its text, or `undefined` when it cannot be read
 */
function readWorkingFile({ root, path }: { root: string; path: string }): string | undefined {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The base half's verdict: its findings, a base that could not be read (none supplied included), or a
 * brand-new ref with no previous commit to judge against.
 */
type BaseHalf =
  | { readonly kind: "judged"; readonly findings: readonly string[]; readonly sha: string }
  | { readonly kind: "skipped"; readonly why: string }
  | { readonly kind: "unread"; readonly why: string };

/**
 * Judge the head against the base commit CI names, when it names one.
 *
 * @param root the repository root
 * @param env carries the base SHA CI chose, or nothing
 * @param head the head's ceilings and raise records
 * @returns the base half's verdict
 */
function baseHalf({
  root,
  env,
  head,
}: {
  root: string;
  env: NodeJS.ProcessEnv;
  head: {
    readonly ceilings: ReadonlyMap<string, number>;
    readonly raises: readonly HeapRaise[];
    readonly uncapped: ReadonlySet<string>;
  };
}): BaseHalf {
  const floor = resolveFloorBase({ env, root });
  if (floor.kind === "absent") {
    return { kind: "skipped", why: floor.reason };
  }
  if (floor.kind === "invalid") {
    return { kind: "unread", why: floor.reason };
  }
  const { sha } = floor;
  if (!gitSucceeds({ args: ["cat-file", "-e", `${sha}^{commit}`], root })) {
    return { kind: "unread", why: `the base commit ${sha} is not in this checkout — fetch it` };
  }
  const sources = readSources({ read: (path) => gitShow({ root, spec: `${sha}:${path}` }), side: `base ${sha}` });
  if (sources.kind === "unread") {
    return sources;
  }
  const ceilings = treeCeilings({ texts: sources.texts });
  if (ceilings.kind === "unread") {
    return { kind: "unread", why: `at the base: ${ceilings.why}` };
  }
  const pinsAtBase = gitSucceeds({ args: ["cat-file", "-e", `${sha}:${PINS_PATH}`], root });
  let raises: readonly HeapRaise[] = [];
  if (pinsAtBase) {
    const pins = readHeapPins({ text: gitShow({ root, spec: `${sha}:${PINS_PATH}` })! });
    if (pins.kind === "unread") {
      return { kind: "unread", why: `at the base: ${pins.why}` };
    }
    raises = pins.pins.raises;
  }
  return { findings: judgeAgainstBase({ base: { ceilings: ceilings.ceilings, raises }, head }), kind: "judged", sha };
}

/**
 * Fail when a heap ceiling disagrees with its pin, or rises against the base commit without a witnessed
 * raise record.
 *
 * @param root the repository to judge — the checkout itself from the entry, a temporary repository in a test
 * @param env carries `SLOPWEAVER_COVERAGE_BASE_SHA`, or nothing
 * @param writeOut receives the clean line
 * @param writeErr receives every finding, refusal and incomplete line
 * @returns 0 when clean, else 1
 */
export function runHeapCeilingRatchet({
  root,
  env,
  writeOut,
  writeErr,
}: {
  root: string;
  env: NodeJS.ProcessEnv;
  writeOut: ({ text }: { text: string }) => void;
  writeErr: ({ text }: { text: string }) => void;
}): number {
  const sources = readSources({ read: (path) => readWorkingFile({ path, root }), side: "working tree" });
  const ceilings = sources.kind === "texts" ? treeCeilings({ texts: sources.texts }) : sources;
  const pinsText = readWorkingFile({ path: PINS_PATH, root });
  const pins = pinsText === undefined ? undefined : readHeapPins({ text: pinsText });
  if (ceilings.kind === "unread") {
    // devlint: not-a-refusal -- a ceiling source this gate could not read, so no rule caught anything
    writeErr({ text: `heap-ceiling-ratchet: incomplete — ${ceilings.why}\n` });
    return 1;
  }
  if (pins === undefined || pins.kind === "unread") {
    const why = pins === undefined ? `cannot read ${PINS_PATH}` : pins.why;
    // devlint: not-a-refusal -- the pins file could not be read, so nothing was compared against it
    writeErr({ text: `heap-ceiling-ratchet: incomplete — ${why}\n` });
    return 1;
  }
  const headFindings = judgeHeadPins({ ceilings: ceilings.ceilings, pinned: pins.pins.ceilingsMiB });
  const head = { ceilings: ceilings.ceilings, raises: pins.pins.raises, uncapped: ceilings.uncapped };
  const base = baseHalf({ env, head, root });
  if (base.kind === "unread") {
    // The head half needed no base, so what it found is printed before the base half's fact rather than lost.
    headFindings.forEach((line) => {
      writeErr({ text: `  ${line}\n` });
    });
    // devlint: not-a-refusal -- the base commit could not be read, so the half that catches a raise never ran
    writeErr({ text: `heap-ceiling-ratchet: incomplete — ${base.why}\n` });
    return 1;
  }
  const findings = base.kind === "judged" ? [...headFindings, ...base.findings] : headFindings;
  if (gateOutcome({ refused: findings.length, unseen: 0 }) === "clean") {
    const scope =
      base.kind === "judged" ? `no unwitnessed raise against ${base.sha}` : `base half not run: ${base.why}`;
    const count = String(ceilings.ceilings.size);
    writeOut({ text: `heap-ceiling-ratchet: clean (${count} ceiling(s) match ${PINS_PATH}; ${scope})\n` });
    return 0;
  }
  for (const line of findings) {
    writeErr({ text: `  ${line}\n` });
  }
  writeErr({
    text: `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "heap-ceiling-ratchet" }),
      detail: `${String(findings.length)} heap ceiling finding(s)`,
    })}\n`,
  });
  return 1;
}
