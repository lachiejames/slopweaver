/**
 * The vocabulary half's shell: select the sources, read each through the fail-closed scanner, judge the hits
 * against `.baselines/naming-vocabulary-baseline.json`, and print the half's own refusals. Every input is
 * injected, so `namingDoctrineRun.ts` composes it and a unit test drives it with a synthetic tree.
 *
 * Staleness is judged only over a complete read: an unread file makes every row naming it look stale, and a
 * `--rebaseline` written from a partial scan would shrink the register over code nobody looked at.
 */
import { type Result } from "#lib/result.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { type DevLintInputError } from "./errors.js";
import {
  isGeneratedPath,
  type NamingVocabularyBaseline,
  type NamingVocabularyDebtReduction,
  type NamingVocabularyHit,
  namingVocabularyBaselineOf,
  parseNamingVocabularyBaseline,
  partitionVocabularyAgainstDebt,
  vocabularyHits,
} from "./namingVocabulary.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { isScannablePath, type ScanScope } from "./scanScope.js";

/** The register, repo-relative. */
export const NAMING_VOCABULARY_BASELINE = ".baselines/naming-vocabulary-baseline.json";

/**
 * Every TypeScript source we write, tests excluded (a fixture names the shape it tests). No self-exclusion: this
 * gate's own files declare no retired word, and scanning them keeps it that way.
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  extensions: [".ts", ".tsx"],
  selfFiles: new Set(),
  trees: ["src/", "site/", "desktop/", "eval/", "hooks/"],
};

/**
 * Whether the vocabulary half reads a path: in {@link SCOPE} and not generated. An authored `.d.ts` is read
 * like any other source — the names in it are ours.
 *
 * @param path a repo-relative working-tree path
 * @returns true when the half scans it
 */
export function isVocabularyScanned({ path }: { path: string }): boolean {
  return isScannablePath({ path, scope: SCOPE }) && !isGeneratedPath({ path });
}

/** The half's verdict, before anything is printed. */
export interface NamingVocabularyVerdict {
  readonly fresh: readonly NamingVocabularyHit[];
  /** Empty whenever {@link NamingVocabularyVerdict.unseen} is non-zero. */
  readonly stale: readonly NamingVocabularyDebtReduction[];
  /** Inputs the half could not see: unread sources, an empty selection, an unreadable register. */
  readonly unseen: number;
  readonly scanned: number;
  /** How many declarations the register still holds. */
  readonly debtCount: number;
  /** What a complete scan measured, for `--rebaseline`; absent after an incomplete one. */
  readonly measured: NamingVocabularyBaseline | undefined;
}

/**
 * Judge the working tree's sources against the register, writing only the facts an incomplete read owes.
 *
 * @param listing every working-tree path, repo-relative
 * @param readText reads one path's text, throwing when it cannot
 * @param baselineText the register's text, or why it could not be read
 * @param write the stderr sink
 * @returns the verdict
 */
export function judgeNamingVocabulary({
  listing,
  readText,
  baselineText,
  write,
}: {
  listing: readonly string[];
  readText: (args: { path: string }) => string;
  baselineText: Result<string, DevLintInputError>;
  write: (text: string) => void;
}): NamingVocabularyVerdict {
  const scan = scanTextFiles<NamingVocabularyHit>({
    paths: listing.filter((path) => isVocabularyScanned({ path })),
    readText,
    scan: ({ content, path }) => vocabularyHits({ path, text: content }),
  });
  const complete = reportScanIntegrity({
    label: "naming-doctrine (vocabulary)",
    scanned: scan.scanned,
    unreadable: scan.unreadable,
    write,
  });
  const baseline = baselineText.andThen((text) => parseNamingVocabularyBaseline({ text }));
  let unseen = complete ? 0 : 1;
  let debt: NamingVocabularyBaseline = { identifiers: [] };
  if (baseline.isErr()) {
    // devlint: not-a-refusal -- the register could not be READ, so this half has nothing to judge against
    write(`naming-doctrine: ${baseline.error.message} — vocabulary NOT judged against its register\n`);
    unseen += 1;
  } else {
    debt = baseline.value;
  }
  const partition = partitionVocabularyAgainstDebt({ debt: debt.identifiers, hits: scan.hits });
  return {
    debtCount: debt.identifiers.reduce((sum, row) => sum + row.count, 0),
    fresh: partition.fresh,
    measured: complete ? namingVocabularyBaselineOf({ hits: scan.hits }) : undefined,
    scanned: scan.scanned,
    stale: unseen === 0 ? partition.stale : [],
    unseen,
  };
}

/**
 * Print the half's refusals: each uncovered declaration, then each row that overstates the tree.
 *
 * @param verdict what {@link judgeNamingVocabulary} answered
 * @param write the stderr sink
 */
export function reportNamingVocabulary({
  verdict,
  write,
}: {
  verdict: NamingVocabularyVerdict;
  write: (text: string) => void;
}): void {
  for (const hit of verdict.fresh) {
    write(`  ${hit.path}:${String(hit.line)}: ${hit.kind} \`${hit.name}\` carries a retired word\n`);
  }
  if (verdict.fresh.length > 0) {
    const declaration = lintDeclarationFor({ id: "naming-vocabulary" });
    const detail = `${String(verdict.fresh.length)} declaration(s) name a provider, platform or connector`;
    write(`${lintGateRefusal({ declaration, detail })}\n`);
  }
  for (const row of verdict.stale) {
    write(
      `  ${row.path}: \`${row.name}\` recorded ${String(row.recorded)} time(s) in ${NAMING_VOCABULARY_BASELINE}, ` +
        `found ${String(row.actual)} — shrink the row\n`,
    );
  }
  if (verdict.stale.length > 0) {
    const declaration = lintDeclarationFor({ id: "naming-vocabulary-debt" });
    write(`${lintGateRefusal({ declaration, detail: `${String(verdict.stale.length)} row(s) overstate the tree` })}\n`);
  }
}
