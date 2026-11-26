/**
 * The naming-doctrine gate's effectful shell: read the CLI nouns, the skill directories, the sidebar table and
 * every TypeScript source, judge the first three with the pure criterion in `./namingDoctrine.ts` as a plain
 * rule — every divergence it finds fails — and the sources with the vocabulary half (`./namingVocabularyRun.ts`)
 * against `.baselines/naming-vocabulary-baseline.json`.
 *
 * Three endings, decided by `gateOutcome`: a divergence, a vocabulary finding the register does not hold, or a
 * register row that no longer fires, is a REFUSAL; an input the gate could not see (no nouns, no skills, a
 * sidebar table it could not extract, an unread source or register) is INCOMPLETE, a fact rather than four
 * lines claiming a rule caught something; anything else is clean. The vocabulary half judges its staleness
 * only over its own complete read, because an unseen input makes every row naming it look stale.
 *
 * `--rebaseline` writes the vocabulary register from a complete scan and judges nothing; a rise it writes is
 * then refused by the landing verbs until a bump record and its witness declare it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRootOf, workingTreeFilesOf } from "#lib/gitRepo.js";
import { err, ok, type Result } from "#lib/result.js";
import { MANIFEST_MODULES } from "../cli/manifests/index.js";
import { type DevLintInputError, DevLintInputErrors } from "./errors.js";
import {
  type CommandSurfaceName,
  commandSurfaceDivergences,
  describeDivergence,
  divergenceIdentity,
  type NamingDivergence,
  type SidebarNameDeclaration,
  sidebarDivergences,
} from "./namingDoctrine.js";
import { extractSidebarEntries, SIDEBAR_SOURCE } from "./namingDoctrineSidebar.js";
import { judgeNamingVocabulary, NAMING_VOCABULARY_BASELINE, reportNamingVocabulary } from "./namingVocabularyRun.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/** Where the nouns are declared, for reporting. */
const NOUN_SOURCE = "src/cli/manifests/index.ts";

/** A skill's own file: `skills/<name>/SKILL.md`, the name being its directory. */
const SKILL_FILE = /^skills\/([^/]+)\/SKILL\.md$/u;

/**
 * Every skill directory under `skills/` as a command-surface name.
 *
 * @param listing the working tree's files, repo-relative
 * @returns one name per `SKILL.md`, in listing order
 */
export function skillNamesOf({ listing }: { listing: readonly string[] }): readonly CommandSurfaceName[] {
  return listing.flatMap((path): readonly CommandSurfaceName[] => {
    const match = SKILL_FILE.exec(path);
    if (match === null) {
      return [];
    }
    return [{ name: match[1]!, path, surface: "skill" }];
  });
}

/** Everything the gate reads and writes, injected so a test can drive the whole composition. */
export interface NamingDoctrineInputs {
  readonly nouns: readonly CommandSurfaceName[];
  /** Every working-tree path, repo-relative. */
  readonly listing: readonly string[];
  /** Reads one repo-relative path's text, throwing when it cannot. */
  readonly readText: (args: { path: string }) => string;
  /** Writes the vocabulary register's text. */
  readonly writeBaseline: (args: { text: string }) => void;
  readonly rebaseline: boolean;
  readonly out: (text: string) => void;
  readonly write: (text: string) => void;
}

/** The sidebar rows, or `undefined` once the reason they could not be read has been written. */
function readSidebar({
  readText,
  write,
}: Pick<NamingDoctrineInputs, "readText" | "write">): readonly SidebarNameDeclaration[] | undefined {
  let content: string;
  try {
    content = readText({ path: SIDEBAR_SOURCE });
  } catch (error) {
    // devlint: not-a-refusal -- the sidebar file could not be READ, so this half has no subject to judge
    write(`naming-doctrine: ${SIDEBAR_SOURCE} unreadable (${String(error)}) — NOT checked\n`);
    return undefined;
  }
  const rows = extractSidebarEntries({ content, path: SIDEBAR_SOURCE });
  if (rows.isErr()) {
    // devlint: not-a-refusal -- the sidebar table could not be EXTRACTED, which is a fact, not a finding
    write(`naming-doctrine: ${rows.error} — NOT checked\n`);
    return undefined;
  }
  return rows.value;
}

/** Write the divergence half's refusal when it found anything. */
function refuseDivergences({
  divergences,
  write,
}: {
  divergences: readonly NamingDivergence[];
  write: (text: string) => void;
}): void {
  for (const divergence of divergences) {
    write(`  ${describeDivergence({ divergence })}\n    identity: ${divergenceIdentity({ divergence })}\n`);
  }
  if (divergences.length > 0) {
    const declaration = lintDeclarationFor({ id: "naming-doctrine" });
    write(`${lintGateRefusal({ declaration, detail: `${String(divergences.length)} concept(s) named two ways` })}\n`);
  }
}

/** The register's text, or why it could not be read. */
function readRegister({ readText }: Pick<NamingDoctrineInputs, "readText">): Result<string, DevLintInputError> {
  try {
    return ok(readText({ path: NAMING_VOCABULARY_BASELINE }));
  } catch {
    return err(DevLintInputErrors.baselineUnreadable({ kind: "debt list", path: NAMING_VOCABULARY_BASELINE }));
  }
}

/**
 * Judge every input and print the verdict; under `rebaseline`, write the vocabulary register instead.
 *
 * @param inputs what the gate reads and where it writes
 * @returns 0 clean or rebaselined; 1 a fresh finding, a stale row, or an unseen input
 */
export function judgeNamingDoctrine({ inputs }: { inputs: NamingDoctrineInputs }): number {
  const { listing, nouns, readText, write } = inputs;
  const vocabulary = judgeNamingVocabulary({ baselineText: readRegister({ readText }), listing, readText, write });
  if (inputs.rebaseline) {
    if (vocabulary.measured === undefined) {
      // devlint: not-a-refusal -- a register written from a partial scan would record code nobody read
      write("naming-doctrine: --rebaseline refused to write over an incomplete scan\n");
      return 1;
    }
    inputs.writeBaseline({ text: `${JSON.stringify(vocabulary.measured, null, 2)}\n` });
    inputs.out(
      `naming-doctrine: ${NAMING_VOCABULARY_BASELINE} set to ${String(vocabulary.measured.identifiers.length)} row(s)\n`,
    );
    return 0;
  }
  const skills = skillNamesOf({ listing });
  const sidebar = readSidebar({ readText, write });
  let unseen = 0;
  let sidebarRows: readonly SidebarNameDeclaration[] = [];
  if (sidebar === undefined) {
    unseen += 1;
  } else {
    sidebarRows = sidebar;
  }
  for (const [label, count] of [
    ["CLI nouns", nouns.length],
    ["skills", skills.length],
  ] as const) {
    if (count === 0) {
      // devlint: not-a-refusal -- an input read EMPTY, so this half has no subject to judge
      write(`naming-doctrine: read ZERO ${label} — a broken source, not a clean surface\n`);
      unseen += 1;
    }
  }
  const divergences = [
    ...commandSurfaceDivergences({ names: [...nouns, ...skills] }),
    ...sidebarDivergences({ entries: sidebarRows }),
  ];
  const refused = divergences.length + vocabulary.fresh.length + vocabulary.stale.length;
  const outcome = gateOutcome({ refused, unseen: unseen + vocabulary.unseen });
  if (outcome === "refused") {
    refuseDivergences({ divergences, write });
    reportNamingVocabulary({ verdict: vocabulary, write });
    return 1;
  }
  if (outcome === "incomplete") {
    return 1;
  }
  inputs.out(
    `naming-doctrine: clean (${String(nouns.length)} nouns, ${String(skills.length)} skills, ` +
      `${String(sidebarRows.length)} sidebar rows, ${String(vocabulary.scanned)} sources; ` +
      `${String(vocabulary.debtCount)} retired-word declaration(s) recorded in debt)\n`,
  );
  return 0;
}

/**
 * IO edge: read the real tree and judge it; `--rebaseline` on the command line rewrites the vocabulary register.
 *
 * @returns 0 clean or rebaselined; 1 a fresh finding, a stale row, an unseen input, or not a git checkout
 */
export function runNamingDoctrine(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ, so the gate has no subject to judge
    process.stderr.write("naming-doctrine: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const nouns = MANIFEST_MODULES.map((module): CommandSurfaceName => ({
    name: module.noun,
    path: NOUN_SOURCE,
    surface: "noun",
  }));
  return judgeNamingDoctrine({
    inputs: {
      listing,
      nouns,
      out: (text) => {
        process.stdout.write(text);
      },
      readText: ({ path }) => readFileSync(join(root, path), "utf8"),
      rebaseline: process.argv.includes("--rebaseline"),
      write: (text) => {
        process.stderr.write(text);
      },
      writeBaseline: ({ text }) => {
        writeFileSync(join(root, NAMING_VOCABULARY_BASELINE), text);
      },
    },
  });
}
