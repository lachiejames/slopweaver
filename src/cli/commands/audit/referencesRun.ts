/**
 * `slopweaver audit references` — the zero-references proof: the repository exported as a zip with no git, and a
 * count of every reference to the installation's organisation still in it, by class.
 *
 * The parse, the dispatch, the page and the exit code. The export and scan are `../../../hygiene/referenceExport.ts`'s;
 * what a reference is, is `../../../hygiene/referenceScan.ts`'s; the page is `../../../hygiene/referencePage.ts`'s.
 *
 * The page is scanned with the same rules before it is published, and a page that would carry a reference is
 * refused: it is the one surface built to be shown to people the zip is shown to.
 */
import { FORBIDDEN_IDENTIFIER_RULES } from "../../../hygiene/forbiddenIdentifiers.js";
import { identifierScanner } from "../../../hygiene/identifierScan.js";
import {
  exportAndScanReferences,
  type ReferenceInputs,
  type ReferenceProof,
  readReferenceInputs,
} from "../../../hygiene/referenceExport.js";
import { renderReferencePage, ZERO_REFERENCES_PAGE_SLUG } from "../../../hygiene/referencePage.js";
import { printableRefusal, scanReferences } from "../../../hygiene/referenceScan.js";
import { runningCheckoutRoot } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import type { PagePublisher } from "../../../pages/publish.js";
import { wrapPageFragment } from "../../../pages/shell.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagTailSpec, flagValueOr, parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { type AuditArgsError, AuditArgsErrors, auditArgsErrorLines } from "./errors.js";
import { runAuditIndirectReferences } from "./indirectRun.js";
import { AUDIT_REFERENCES_USAGE } from "./referencesUsage.js";

/** The flags this verb accepts, exported for the repo-wide help-truth ratchet. */
export const AUDIT_REFERENCES_FLAGS = {
  boolean: ["indirect", "json", "list", "no-page"],
  value: ["home", "map", "ref"],
} as const satisfies FlagTailSpec;

/** Every accepted flag, with the `--` callers type. */
export const AUDIT_REFERENCES_FLAG_NAMES: readonly string[] = [
  ...AUDIT_REFERENCES_FLAGS.value,
  ...AUDIT_REFERENCES_FLAGS.boolean,
].map((name) => `--${name}`);

/** What a valid invocation asks for. */
export interface AuditReferencesOptions {
  readonly ref: string;
  readonly map: string | undefined;
  readonly home: string | undefined;
  /** Scan for indirect candidates (`./indirectRun.ts`) rather than prove the direct count. */
  readonly indirect: boolean;
  readonly list: boolean;
  readonly page: boolean;
  readonly json: boolean;
}

/**
 * Parse the `audit references` tail.
 *
 * @param rest the argv tail after `audit references`
 * @returns the validated request, or the typed refusal — {@link auditArgsErrorLines} prints it
 */
export function parseAuditReferencesArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<AuditReferencesOptions, AuditArgsError> {
  const parsed = parseFlagTail({ rest, spec: AUDIT_REFERENCES_FLAGS });
  if (parsed.isErr()) {
    return err(AuditArgsErrors.flagsRefused({ reasons: parsed.error, usage: AUDIT_REFERENCES_USAGE }));
  }
  const { values, flags } = parsed.value;
  const ref = flagValueOr({ fallback: "main", name: "ref", parsed: parsed.value });
  if (ref.trim().length === 0) {
    return err(AuditArgsErrors.refMissing({ usage: AUDIT_REFERENCES_USAGE }));
  }
  const indirect = flags.has("indirect");
  const directOnly = ["map", "list", "json"].filter((name) => values[name] !== undefined || flags.has(name));
  if (indirect && directOnly.length > 0) {
    return err(AuditArgsErrors.directFlagsConflict({ flags: directOnly, usage: AUDIT_REFERENCES_USAGE }));
  }
  return ok({
    home: values["home"],
    indirect,
    json: flags.has("json"),
    list: flags.has("list"),
    map: values["map"],
    page: !flags.has("no-page"),
    ref,
  });
}

/**
 * Pure: one class's report line.
 *
 * @param row the class's totals
 * @returns the indented line
 */
function classLine({ row }: { row: ReferenceProof["summary"]["classes"][number] }): string {
  return (
    `    ${row.className.padEnd(28)} ${String(row.hits).padStart(6)} places  ${String(row.files).padStart(5)} files ` +
    `(code ${String(row.codeFiles)}, docs ${String(row.docsFiles)})`
  );
}

/**
 * Pure: the human report — the acceptance headline and its classes, the owner's own name beside it, and with
 * `--list` every residue file.
 *
 * @param proof what the run found
 * @param list print every residue file as well
 * @returns the lines to print
 */
export function referenceReportLines({ proof, list }: { proof: ReferenceProof; list: boolean }): readonly string[] {
  const { summary } = proof;
  const { acceptance, ownName } = summary;
  const lines = [
    `audit references: ${proof.ref} at ${proof.sha.slice(0, 12)} exported as a zip with no .git — ` +
      `${String(summary.filesScanned)} files (${String(summary.binaryFiles)} binary), every byte and every path scanned`,
    `  zip: ${proof.zipPath}`,
    acceptance.hits === 0
      ? "  0 references to the organisation: no file and no file name carries one"
      : `  ${String(acceptance.hits)} reference(s) to the organisation in ${String(acceptance.files)} file(s) — ` +
        `code ${String(acceptance.codeFiles)}, docs ${String(acceptance.docsFiles)}`,
    ...summary.classes.filter((row) => row.section === "acceptance").map((row) => classLine({ row })),
    `  the owner's own name, outside the acceptance and retired by the stateless series: ` +
      `${String(ownName.hits)} place(s) in ${String(ownName.files)} file(s)`,
    ...summary.classes.filter((row) => row.section === "own-name").map((row) => classLine({ row })),
  ];
  if (list) {
    for (const file of summary.residue) {
      lines.push(`  ${file.path}\t${file.area}\t${file.classes.join(",")}`);
    }
  }
  return lines;
}

/**
 * Re-render the proof page, refusing a page that would itself carry a reference.
 *
 * @param proof what the run found
 * @param home the Slopweaver home the page is published under
 * @param inputs the reference map and denylist the page is checked against, the tree's own
 * @param now the instant the run is stamped with
 * @param publish writes the page to its folder, its freeze and the store
 * @returns the page's address, or why it was not published
 */
export async function publishProofPage({
  proof,
  home,
  inputs,
  now,
  publish,
}: {
  proof: ReferenceProof;
  home: string;
  inputs: ReferenceInputs;
  now: Date;
  publish: PagePublisher;
}): Promise<Result<string>> {
  const human = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" });
  const fragment = renderReferencePage({
    committedLabel: human.format(new Date(proof.committedIso)),
    proof,
    scannedLabel: human.format(now),
  });
  // The document the shell wraps it in is what is published, so that is what is scanned, shell included.
  const carried = scanReferences({
    content: wrapPageFragment({ fragment }),
    denylist: inputs.denylist,
    map: inputs.map,
    path: ZERO_REFERENCES_PAGE_SLUG,
    scanner: identifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES }),
  });
  if (carried.length > 0) {
    // The class is not named: a map class can itself spell what it matches, and naming it would print that.
    return err([
      `the proof page would itself carry ${String(carried.length)} reference(s), so it was not published — ` +
        "a reference-map class spelled with a name is the usual cause; class names must be generic words",
    ]);
  }
  const published = await publish({ fragment, home, nowIso: now.toISOString(), slug: ZERO_REFERENCES_PAGE_SLUG });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(published.value.url);
}

/**
 * Run `audit references` against injected output sinks.
 *
 * @param rest the argv tail after `audit references`
 * @param writeOut the stdout sink, for the `--json` document and the page address
 * @param writeDiagnostic the stderr sink, for the human report
 * @param publish writes a `--page` page to its folder, its freeze and the store
 * @returns the process exit code
 */
export async function runAuditReferences({
  rest,
  writeOut,
  writeDiagnostic,
  publish,
}: {
  rest: readonly string[];
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
  publish: PagePublisher;
}): Promise<number> {
  const parsed = parseAuditReferencesArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of auditArgsErrorLines({ error: parsed.error })) {
      writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  if (options.indirect) {
    return runAuditIndirectReferences({
      home,
      page: options.page,
      publish,
      ref: options.ref,
      writeDiagnostic,
      writeOut,
    });
  }
  // No --map means the installation's own map under the home, by design rather than as a fallback.
  let mapPath = stateHomePaths({ home }).referenceMap;
  if (options.map !== undefined) {
    mapPath = options.map;
  }
  const inputs = readReferenceInputs({ home, mapPath });
  if (inputs.isErr()) {
    writeDiagnostic(`audit references: ${inputs.error.message}`);
    return EXIT_ERROR;
  }
  // The checkout the operator stands in; a directory that is none is refused by the export's own resolve step.
  const root = runningCheckoutRoot();
  const proof = exportAndScanReferences({ home, inputs: inputs.value, ref: options.ref, root });
  if (proof.isErr()) {
    const scanner = identifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES });
    const shown = printableRefusal({ ...inputs.value, code: proof.error.code, message: proof.error.message, scanner });
    writeDiagnostic(`audit references: ${shown}`);
    return EXIT_ERROR;
  }
  reportProof({ json: options.json, list: options.list, proof: proof.value, writeDiagnostic, writeOut });
  if (
    options.page &&
    !(await publishAndSay({ home, inputs: inputs.value, proof: proof.value, publish, writeDiagnostic }))
  ) {
    return EXIT_ERROR;
  }
  // The owner's own name is reported beside the acceptance and never fails it (`referenceSummary.ts`).
  return proof.value.summary.acceptance.hits === 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * Publish the proof page and print its address, or print why it was not published.
 *
 * @param proof what the run found
 * @param home the Slopweaver home the page is published under
 * @param inputs the reference map and denylist the page is checked against
 * @param writeDiagnostic the stderr sink
 * @param publish writes the page to its folder, its freeze and the store
 * @returns whether the page was published
 */
async function publishAndSay({
  proof,
  home,
  inputs,
  writeDiagnostic,
  publish,
}: {
  proof: ReferenceProof;
  home: string;
  inputs: ReferenceInputs;
  writeDiagnostic: (line: string) => void;
  publish: PagePublisher;
}): Promise<boolean> {
  const page = await publishProofPage({ home, inputs, now: new Date(), proof, publish });
  if (page.isErr()) {
    for (const problem of page.error) {
      writeDiagnostic(`audit references: ${problem}`);
    }
    return false;
  }
  writeDiagnostic(`  page: ${page.value}`);
  return true;
}

/**
 * Print a run's outcome: the `--json` document on stdout, or the human report on stderr.
 *
 * @param proof what the run found
 * @param json print the JSON document instead of the report
 * @param list print every residue file in the report
 * @param writeOut the stdout sink
 * @param writeDiagnostic the stderr sink
 */
function reportProof({
  proof,
  json,
  list,
  writeOut,
  writeDiagnostic,
}: {
  proof: ReferenceProof;
  json: boolean;
  list: boolean;
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
}): void {
  if (json) {
    writeOut(safeJsonStringify({ label: "audit references --json", space: 2, value: proof }));
    return;
  }
  for (const line of referenceReportLines({ list, proof })) {
    writeDiagnostic(line);
  }
}

/** `slopweaver audit references`. */
export const auditReferencesCommand = defineCommand({
  run: (argv) =>
    runAuditReferences({
      publish: productionPublishPage,
      rest: verbTail({ argv, verbs: ["references"] }),
      writeDiagnostic: (line) => {
        logger.warn({ msg: line });
      },
      writeOut: (line) => {
        logger.out({ line });
      },
    }),
});
