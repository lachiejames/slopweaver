/**
 * The coverage guarantee — proof that no side-effect seam escapes the door. It scans the source for
 * direct side-effecting primitives (fs writes/deletes, `spawn`/`execFileSync`) and checks the verb
 * registry, then classes every seam:
 *   - sanctioned seams (local-state writers under $SLOPWEAVER_HOME, read-only git/gh callers, the door's
 *     own ledger + hook) are ACKNOWLEDGED — the product working normally;
 *   - any OTHER direct seam is `open` — a potential un-routed bypass — and FAILS the check;
 *   - a verb marked `external-write` that is not `doorRouted`, or a verb with no `effect` at all, FAILS too.
 *
 * ## What this gate does and does NOT claim
 *
 * It proves an INVENTORY: every direct seam it could read is either sanctioned or routed through the door.
 * It does not prove the door protects anything. `DEFAULT_GATES` is still empty, and what each path composes
 * on top of it is the list in `door.ts`'s own `DEFAULT_GATES` comment — every Slack lane that authors words
 * now carries the voice-profile gate, `linear issue create/update` still carries nothing. Whether that policy
 * is sufficient is a product decision this gate deliberately does not assess.
 *
 * One property IS proved elsewhere and is worth naming here so a reader does not look for it in this file:
 * a request declaring `meta.requiresApproval` with no approval gate in its list is refused by `admitDoor`
 * itself (`src/admit/approval.ts`). That is a runtime rule inside the decision, not an inventory check, and
 * it is why this gate has nothing to say about approval.
 *
 * The previous version of this comment said "PR2 has no external-write verbs (slopweaver is read-only)".
 * That has been false since the Slack and Linear write verbs landed, and a gate whose own header misdescribes
 * the system is the defect class this module exists to catch.
 *
 * A PARTIAL scan cannot support a completeness claim, so any unreadable path makes the report not-ok rather
 * than shrinking the denominator in silence. Pure `analyzeCoverage`; effectful reader.
 *
 * The allowlist itself lives in `sanctionedSeams.ts` — one row per sanctioned file, carrying its own reason.
 * Adding a seam is an edit THERE; changing how a seam is found is an edit here.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VerbManifestEntry } from "../cli/manifest.js";
import { NOUN_GROUPS } from "../cli/nounGroups.js";
import type { NounGroups } from "../cli/router.js";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { readTextAhead } from "../lib/readAhead.js";
import { scanTextFiles } from "../lib/textFileScan.js";
import { SANCTIONED_SEAMS, type SeamClass } from "./sanctionedSeams.js";

/** Direct side-effecting primitives the scan looks for (as a call — `name(`), so imports don't match. */
const SEAM_PATTERNS: readonly { readonly seam: string; readonly re: RegExp }[] = [
  { re: /\bwriteFileSync\s*\(/, seam: "writeFileSync" },
  { re: /\bappendFileSync\s*\(/, seam: "appendFileSync" },
  { re: /\bmkdirSync\s*\(/, seam: "mkdirSync" },
  { re: /\brmSync\s*\(/, seam: "rmSync" },
  { re: /\bunlinkSync\s*\(/, seam: "unlinkSync" },
  { re: /\brenameSync\s*\(/, seam: "renameSync" },
  { re: /\bspawn(?:Sync)?\s*\(/, seam: "spawn" },
  { re: /\bexecFile(?:Sync)?\s*\(/, seam: "execFile" },
  { re: /\bexecSync\s*\(/, seam: "exec" },
];

/** One direct seam found in the source. */
interface SeamHit {
  readonly file: string;
  readonly line: number;
  readonly seam: string;
  readonly seamClass: SeamClass;
}

/** A verb the registry could not account for: an external-write that isn't routed through the door. (Every
 * verb declaring an `effect` is now enforced at the type level by CommandMeta, so "missing effect" can't occur.) */
interface VerbGap {
  readonly noun: string;
  readonly verb: string;
  readonly reason: "external-write-not-routed";
}

/** The whole picture: every seam (classed), the failing seams + verb gaps, and the verdict. */
export interface CoverageReport {
  readonly seams: readonly SeamHit[];
  readonly open: readonly SeamHit[];
  readonly verbGaps: readonly VerbGap[];
  /**
   * Paths the walker could not read. Non-empty means the scan was PARTIAL, so no completeness claim can be
   * made from it — this is part of `ok` rather than a warning, because a percentage computed over an unknown
   * denominator is the defect this gate exists to catch.
   */
  readonly unreadable: readonly string[];
  readonly ok: boolean;
}

/** A source file to scan. */
export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** Class a file's seams: its sanctioned class, or `open` when the file isn't on the allowlist. */
function classifyFile({ path }: { path: string }): SeamClass {
  const sanctioned = SANCTIONED_SEAMS[path];
  if (sanctioned === undefined) {
    return "open";
  }
  return sanctioned;
}

/**
 * Classify one verb registry entry as a gap or not. Pure — the default-verb alias (`verb === ""`) is
 * skipped; an entry whose effect is an unrouted external write is the one gap.
 *
 * @returns the {@link VerbGap}, or `undefined` when the entry is fine
 */
function verbGapFor({
  noun,
  verb,
  entry,
}: {
  noun: string;
  verb: string;
  entry: VerbManifestEntry | undefined;
}): VerbGap | undefined {
  if (verb === "") {
    return undefined; // the default-verb alias points at a named verb; it's counted there.
  }
  if (entry === undefined) {
    return undefined;
  }
  const { effect, doorRouted } = entry.meta;
  if (effect === "external-write" && doorRouted !== true) {
    return { noun, reason: "external-write-not-routed", verb };
  }
  return undefined;
}

/** Every verb's registry entry that fails to account for a side effect (missing effect / unrouted write). */
function verbGaps({ groups }: { groups: NounGroups }): readonly VerbGap[] {
  const gaps: VerbGap[] = [];
  for (const [noun, verbs] of Object.entries(groups)) {
    for (const verb of Object.keys(verbs)) {
      const gap = verbGapFor({ entry: verbs[verb], noun, verb });
      if (gap !== undefined) {
        gaps.push(gap);
      }
    }
  }
  return gaps;
}

/** What {@link analyzeCoverage} reports as unread when it was handed no source file at all. */
export const EMPTY_SCOPE = "<no source file in src/, eval/ or hooks/ was selected, so nothing was scanned>";

/**
 * Analyse coverage over a set of source files + the verb registry. Pure. `ok` is true only when every
 * direct seam is sanctioned AND every verb accounts for its effect.
 *
 * @param files the source files to scan (non-test)
 * @param groups the verb registry
 * @param unreadable files the scan could not read, carried through so the report can refuse rather than
 *   claim clean coverage over a file it never saw
 * @returns the coverage report
 */
export function analyzeCoverage({
  files,
  groups,
  unreadable = [],
}: {
  files: readonly SourceFile[];
  groups: NounGroups;
  unreadable?: readonly string[];
}): CoverageReport {
  const seams: SeamHit[] = [];
  for (const file of files) {
    // A file naming no seam anywhere has none on any line: skip its split. Most of the tree names none, and the
    // per-line pass over every file was most of the analysis.
    if (!SEAM_PATTERNS.some(({ re }) => re.test(file.content))) {
      continue;
    }
    const seamClass = classifyFile({ path: file.path });
    file.content.split("\n").forEach((line, index) => {
      for (const { seam, re } of SEAM_PATTERNS) {
        if (re.test(line)) {
          seams.push({ file: file.path, line: index + 1, seam, seamClass });
        }
      }
    });
  }
  const open = seams.filter((s) => s.seamClass === "open");
  const gaps = verbGaps({ groups });
  // Fail closed: an EMPTY file set read nothing, and "100% of 0 seams" would otherwise print OK.
  const unseen = files.length === 0 && unreadable.length === 0 ? [EMPTY_SCOPE] : unreadable;
  return {
    ok: open.length === 0 && gaps.length === 0 && unseen.length === 0,
    open,
    seams,
    unreadable: unseen,
    verbGaps: gaps,
  };
}

/** The repo root, anchored on this module's location. */
function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * Read the real source tree (src/ + eval/ + hooks/) and analyse coverage against the live registry.
 * Effectful edge over {@link analyzeCoverage}. The files are read concurrently ahead of the scan, because the
 * scan over them is synchronous and one blocking read at a time was most of its cost (`src/lib/readAhead.ts`).
 *
 * @returns the coverage report for this repo
 */
export async function coverageReport(): Promise<CoverageReport> {
  const root = repoRoot();
  // Enumerate from GIT, not from the directory tree. A directory walk can only attempt files it can see, so
  // a tracked file deleted from the working tree is never attempted and never recorded as unreadable — the
  // scan simply gets smaller and still reports complete. Measured: delete one tracked source and the walker
  // printed `100% of 81 direct seams accounted for` and exited 0. Every other gate in the repo already
  // enumerates with `git ls-files`; this one was the outlier.
  let tracked: readonly string[];
  try {
    tracked = workingTreeFilesOf({ root });
  } catch {
    return analyzeCoverage({ files: [], groups: NOUN_GROUPS, unreadable: ["<git ls-files failed>"] });
  }
  const inScope = tracked.filter(
    (path) =>
      (path.startsWith("src/") || path.startsWith("eval/") || path.startsWith("hooks/")) &&
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts"),
  );
  const readText = await readTextAhead({ paths: inScope, root });
  const { hits, unreadable } = scanTextFiles<SourceFile>({
    paths: inScope,
    readText,
    scan: ({ content, path }) => [{ content, path }],
  });
  return analyzeCoverage({
    files: hits,
    groups: NOUN_GROUPS,
    unreadable: unreadable.map((u) => `${u.path} (${u.reason})`),
  });
}
