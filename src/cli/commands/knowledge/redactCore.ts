/**
 * Flag specs, usage text, parses and renderers for `knowledge redaction-scan` and `knowledge redact`. Pure: no
 * I/O, no clock. Apart from the verb module for the reason `./core.ts` gives — the help-truth ratchet reads a
 * flag list without importing a command.
 *
 * Every line here is a COUNT, never a value: a report that quoted what matched would be a second way to find the
 * names the redaction exists to remove.
 */
import { join } from "node:path";

import { IDENTIFIER_KINDS } from "../../../hygiene/identifierScan.js";
import { KNOWLEDGE_REFERENCE_FIELDS } from "../../../knowledge/redactionFields.js";
import type { KnowledgeReferenceScan } from "../../../knowledge/redactionScan.js";
import type { StoredRedactionOutcome } from "../../../knowledge/redactionStore.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { flagNames } from "./flagSpecs.js";

const SCAN_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["home"],
};

const REDACT_FLAGS: FlagSpec = {
  boolean: ["apply", "json"],
  string: ["home"],
};

/** `--`-prefixed redaction-scan flags, for the help-truth ratchet. */
export const KNOWLEDGE_REDACTION_SCAN_FLAG_NAMES: readonly string[] = flagNames({ spec: SCAN_FLAGS });

/** `--`-prefixed redact flags, for the help-truth ratchet. */
export const KNOWLEDGE_REDACT_FLAG_NAMES: readonly string[] = flagNames({ spec: REDACT_FLAGS });

/**
 * Parse `knowledge redaction-scan`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeRedactionScanArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: SCAN_FLAGS });
}

/**
 * Parse `knowledge redact`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeRedactArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: REDACT_FLAGS });
}

/** What `knowledge redaction-scan --help` prints. */
export const REDACTION_SCAN_USAGE =
  "usage: slopweaver knowledge redaction-scan [--home <dir>] [--json]\n" +
  "\n" +
  "Count the stored recordings and recalls that still carry a forbidden identifier — the committed hashed\n" +
  "rules the hygiene gate runs over the repository, run over the register instead. Prints counts by kind\n" +
  "and by column, never a value, an excerpt or a row id. Exits 0 at zero and 1 otherwise, so\n" +
  "`redaction-scan || alert` fires.";

/** What `knowledge redact --help` prints. */
export const REDACT_USAGE =
  "usage: slopweaver knowledge redact [--apply] [--home <dir>] [--json]\n" +
  "\n" +
  "Redact the stored register in place: the install's replacement map\n" +
  "($SLOPWEAVER_HOME/hygiene-replacements.tsv, never committed) rewrites first, then every span the committed\n" +
  "hashed rules still find is masked. A claim whose text changed moves to the id its new text derives, and\n" +
  "every `supersedes` and recall naming it moves too. A dry run unless --apply.\n" +
  "\n" +
  "  --apply    perform it, in one transaction holding both tables locked. Every pre-rewrite row is written\n" +
  "             first to $SLOPWEAVER_HOME/knowledge/redaction/ (0600); nothing is deleted, and a store that\n" +
  "             does not re-scan to zero rolls the whole rewrite back";

/**
 * Where one redaction's pre-rewrite rows are kept: a fresh file per run, so two runs never share one.
 *
 * @param archiveDir the home's knowledge redaction directory
 * @param now the instant the run started
 * @param nonce a fresh unique suffix
 * @returns the archive's register path; its recalls sit beside it
 */
export function knowledgeRedactionArchivePath({
  archiveDir,
  now,
  nonce,
}: {
  archiveDir: string;
  now: Date;
  nonce: string;
}): string {
  const instant = now.toISOString().replaceAll(":", "-");
  return join(archiveDir, `pre-redaction-${instant}-${nonce}.jsonl`);
}

/**
 * A scan, as counts only — the headline, then every kind and column that is not zero.
 *
 * @param verb the verb prefix every line carries
 * @param scan the counts
 * @returns the lines to print
 */
export function scanLines({ verb, scan }: { verb: string; scan: KnowledgeReferenceScan }): readonly string[] {
  const headline =
    `${verb}: ${String(scan.rowsWithReferences)} row(s) carry a forbidden identifier, of ` +
    `${String(scan.memoriesScanned)} recording(s) and ${String(scan.recallsScanned)} recall(s) scanned`;
  return [
    headline,
    ...IDENTIFIER_KINDS.filter((kind) => scan.byKind[kind] > 0).map(
      (kind) => `  kind ${kind}: ${String(scan.byKind[kind])} row(s)`,
    ),
    ...KNOWLEDGE_REFERENCE_FIELDS.filter((field) => scan.byField[field] > 0).map(
      (field) => `  column ${field}: ${String(scan.byField[field])} row(s)`,
    ),
  ];
}

/**
 * An applied or planned redaction, as counts.
 *
 * @param outcome what the rewrite did, or would do
 * @param applied whether it was performed
 * @returns the lines to print
 */
export function redactLines({
  outcome,
  applied,
}: {
  outcome: Omit<StoredRedactionOutcome, "after" | "archive"> & { archive: string | undefined };
  applied: boolean;
}): readonly string[] {
  const verb = applied ? "rewrote" : "would rewrite";
  const lines = [
    `knowledge redact: ${verb} ${String(outcome.changedMemories)} recording(s) and ` +
      `${String(outcome.changedRecalls)} recall(s), moving ${String(outcome.movedClaims)} claim id(s), ` +
      `${String(outcome.merges)} merge(s) into an existing claim`,
  ];
  if (outcome.archive !== undefined) {
    lines.push(`knowledge redact: the pre-rewrite rows are kept at ${outcome.archive}`);
  }
  return lines;
}
