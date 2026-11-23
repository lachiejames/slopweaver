/**
 * The gate that stops the credential REGISTER drifting from the code and the doc it describes.
 *
 * ## The three claims it settles, and the one it cannot
 *
 * `src/secrets/registry.ts` is prose about credentials until something checks it. Three of its claims are
 * mechanically falsifiable, and this gate is the thing that falsifies them:
 *
 *  1. **A `live` row's `reader` really reads it.** The named module must exist and must contain the
 *     credential's name as a literal. A reader that is deleted, renamed or repointed fails here rather than
 *     leaving the register confidently describing a resolution that no longer happens.
 *  2. **A `retired` row really has no reader.** Nothing in `src/` may name it. This is the check that would
 *     have caught `gmail-client-id` and `gmail-client-secret` the day their last reader went — instead they
 *     sat on disk while `skills/calendar/reference/connecting.md` told every reader they were still read as
 *     a fallback.
 *  3. **`docs/security/credentials.md`'s tokens table matches the register, cell for cell.** Measured, that
 *     table named 12 of the 24 files then standing in the store, and its rows had been hand-edited per
 *     connector since the first one landed.
 *
 * The claim it CANNOT settle is `mintScope`: how a credential was minted is a fact about somebody else's
 * console, and no check on this machine can read it. That is why `"unverified"` is a value in the register
 * rather than an omission — see `src/secrets/credentials/spec.ts`'s header.
 *
 * ## Why the store itself is checked LOCALLY and never in CI
 *
 * The fourth check — "a file in the store is not in the register" — is a property of
 * `$SLOPWEAVER_HOME/secrets`, which exists on the owner's machine and on no runner. So it runs when the
 * directory is there and is silently skipped when it is not, on exactly the same terms as the private
 * hygiene denylist (AGENTS.md, the Toolchain section). It reads names and file types; it never opens a
 * secret.
 *
 * A gate that ran only in CI would be the wrong shape here anyway: an off-allowlist file gets there by a
 * hand-placement, or by `secrets set` run from another checkout whose register carries a row this one does
 * not, on the machine the store lives on — so the machine is where it has to be caught.
 *
 * Pure scanners + an effectful {@link runSecretsRegistry} edge, matching the other gates in this directory.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { slopweaverHome } from "../config.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { CREDENTIALS, type CredentialSpec } from "../secrets/registry.js";
import { stateHomePaths } from "../stateHome.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import { REGISTRY_PATH, unlandedBranchesDeclaring } from "./secretsRegistryGit.js";

/** One drift the gate found, as a line a reader can act on. */
export interface RegistryHit {
  /** Which of the gate's checks fired — printed so a failure names its own criterion. */
  readonly check: "reader-missing" | "reader-silent" | "retired-has-reader" | "doc-drift" | "store-unregistered";
  readonly message: string;
}

/** The files that name a credential in order to DESCRIBE it, and so never count as reading one. */
const SELF_PATHS: ReadonlySet<string> = new Set([
  REGISTRY_PATH,
  "src/secrets/status.ts",
  "src/devLint/secretsRegistry.ts",
]);

/** The register's category directory: every file in it declares rows, so none of them READS a credential. */
const REGISTER_CATEGORY_DIR = "src/secrets/credentials/";

/**
 * Whether a path counts as a READER for the purposes of the retired check. The register itself (its
 * composition root and every category file under `src/secrets/credentials/`), this gate, the status verb
 * that renders it, and every test are excluded: each names a credential in order to describe it rather than
 * to resolve it, so counting them would make `retired` impossible to declare.
 *
 * @param path a repo-relative path
 * @returns true when naming a credential in this file means something resolves it
 */
export function isReaderPath({ path }: { path: string }): boolean {
  if (SELF_PATHS.has(path) || path.startsWith(REGISTER_CATEGORY_DIR) || path.includes("__tests__/")) {
    return false;
  }
  return path.startsWith("src/") && path.endsWith(".ts");
}

/**
 * The reader claims, checked in both directions: a live row's declared reader must exist and must name the
 * credential, and a retired row's credential must be named by nothing at all.
 *
 * @param specs the register
 * @param sources every reader-eligible file, as a path-to-text map
 * @returns one hit per broken reader claim, in register order
 */
export function scanReaderClaims({
  specs,
  sources,
}: {
  specs: readonly CredentialSpec[];
  sources: ReadonlyMap<string, string>;
}): readonly RegistryHit[] {
  return specs.flatMap((spec): readonly RegistryHit[] => {
    const namers = [...sources.entries()].flatMap(([path, text]) => (text.includes(spec.name) ? [path] : []));
    if (spec.reader === null) {
      return namers.map((path) => ({
        check: "retired-has-reader" as const,
        message: `${spec.name} is declared retired but ${path} names it — give the row a reader and lifecycle "live", or stop reading it`,
      }));
    }
    if (!sources.has(spec.reader)) {
      return [
        {
          check: "reader-missing",
          message: `${spec.name} declares reader ${spec.reader}, which is not a source file`,
        },
      ];
    }
    if (!namers.includes(spec.reader)) {
      return [
        {
          check: "reader-silent",
          message: `${spec.name} declares reader ${spec.reader}, which does not name it — the reader moved, or the row is stale`,
        },
      ];
    }
    return [];
  });
}

/** The marker that opens the generated tokens table in `docs/security/credentials.md`. */
export const TABLE_START = "<!-- secrets-table:start -->";
/** The marker that closes the generated tokens table in `docs/security/credentials.md`. */
export const TABLE_END = "<!-- secrets-table:end -->";

/**
 * The table `docs/security/credentials.md` must carry, rendered from the register. Emitted unpadded: the doc is
 * Prettier-formatted, which repads every cell, so the comparison below parses cells rather than matching
 * text — but a failure prints THIS, which Prettier will format into exactly what the doc needs.
 *
 * @param specs the register
 * @returns the markdown table lines, header and separator included
 */
export function renderDocTable({ specs }: { specs: readonly CredentialSpec[] }): readonly string[] {
  return [
    "| secret | platform | used for |",
    "| --- | --- | --- |",
    ...specs.map((spec) => `| \`${spec.name}\` | ${spec.platform} | ${spec.usedFor} |`),
  ];
}

/**
 * One markdown table row split into trimmed cells, with the leading and trailing empties dropped, and the
 * SEPARATOR row's dashes collapsed. Prettier pads a separator cell out to its column's width, so comparing
 * the raw cells would report drift on formatting the formatter itself chose.
 */
function cellsOf({ line }: { line: string }): readonly string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim())
    .map((cell) => (/^-{3,}$/.test(cell) ? "---" : cell));
}

/**
 * One side of a drifted tokens-table row, as the drift message prints it. The doc's table and the register's
 * can differ in LENGTH, so past the end of the shorter one that side has no row at that index, printed as the
 * JSON `null` it has always read as.
 */
function renderedTableRow({ row }: { row: readonly string[] | undefined }): string {
  if (row === undefined) {
    return "null";
  }
  return JSON.stringify(row);
}

/**
 * The fenced table in `docs/security/credentials.md`, checked against the register cell for cell.
 *
 * Compares PARSED cells rather than raw lines, because Prettier repads a markdown table on every format and
 * a byte comparison would fail on whitespace the formatter itself chose.
 *
 * @param specs the register
 * @param doc the whole text of `docs/security/credentials.md`
 * @returns one hit per drifted, missing or surplus row
 */
export function scanDocTable({
  specs,
  doc,
}: {
  specs: readonly CredentialSpec[];
  doc: string;
}): readonly RegistryHit[] {
  const start = doc.indexOf(TABLE_START);
  const end = doc.indexOf(TABLE_END);
  if (start < 0 || end < start) {
    return [
      {
        check: "doc-drift",
        message: `docs/security/credentials.md carries no ${TABLE_START} … ${TABLE_END} fence — the tokens table is not generated from the register`,
      },
    ];
  }
  const actual = doc
    .slice(start + TABLE_START.length, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map((line) => cellsOf({ line }));
  const expected = renderDocTable({ specs }).map((line) => cellsOf({ line }));
  const longest = Math.max(actual.length, expected.length);
  return Array.from({ length: longest }, (_unused, index) => index).flatMap((index) => {
    const want = expected[index];
    const got = actual[index];
    if (want !== undefined && got !== undefined && want.join(" | ") === got.join(" | ")) {
      return [];
    }
    return [
      {
        check: "doc-drift" as const,
        message: `tokens-table row ${String(index + 1)} drifted — want ${renderedTableRow({ row: want })}, got ${renderedTableRow({ row: got })}`,
      },
    ];
  });
}

/**
 * Every file standing in THIS machine's store that the register does not declare. An absent `secrets/`
 * directory is not a finding — it is what every CI runner and every fresh checkout looks like.
 *
 * The store is shared by every checkout on the machine, while the register is the one in THIS checkout. So a
 * file written by `secrets set` from a branch that legitimately carries its row reads as undeclared from
 * every other checkout — measured, when a branch's `store-url` refused every push on the machine
 * and told each bystander to add a row for a credential it knew nothing about, or delete a peer's file.
 * `declaredOn` names the unlanded branches that carry the row, so the refusal says whose file it is. The
 * exit code does not change: whether such a file should pass is the owner's call, not this gate's.
 *
 * @param dir the store directory to read
 * @param specs the register
 * @param declaredOn the unlanded branches whose register declares a name, none when nothing does
 * @returns one hit per undeclared file, or none when the directory is absent
 */
export function scanStore({
  dir,
  specs,
  declaredOn,
}: {
  dir: string;
  specs: readonly CredentialSpec[];
  declaredOn: (input: { name: string }) => readonly string[];
}): readonly RegistryHit[] {
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const declared = new Set(specs.map((spec) => spec.name));
  return names
    .filter((name) => !declared.has(name))
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .toSorted()
    .map((name) => ({
      check: "store-unregistered" as const,
      message: storeHitMessage({ branches: declaredOn({ name }), name }),
    }));
}

/**
 * The line a stray store file prints: whose file it is when an unlanded branch declares it, else the remedy.
 *
 * @param name the undeclared file
 * @param branches the unlanded branches whose register carries its row
 * @returns the hit's message
 */
function storeHitMessage({ name, branches }: { name: string; branches: readonly string[] }): string {
  if (branches.length === 0) {
    return `${name} stands in the store and is absent from the register — secrets set would REFUSE to rewrite it, and nothing can say what it reaches. Add its row to its category file under src/secrets/credentials/, or delete the file`;
  }
  return `${name} stands in the store and is absent from THIS checkout's register, but is declared on ${branches.join(", ")} — the store is shared by every checkout on this machine, so this is that branch's credential landing with its reader, not your change. Do not add its row here or delete the file; ask that branch's session to land it, or to remove the file until it does`;
}

/**
 * Run every check and report. The store check is skipped silently when this machine has no store.
 *
 * @returns 0 when the register, the readers, the doc and the store all agree, else 1
 */
export function runSecretsRegistry(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("secrets-registry: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const sources = new Map<string, string>();
  const scan = scanTextFiles<never>({
    paths: listing.filter((path) => isReaderPath({ path })),
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => {
      sources.set(path, content);
      return [];
    },
  });
  const complete = reportScanIntegrity({
    label: "secrets-registry",
    scanned: scan.scanned,
    unreadable: scan.unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  let doc: string;
  try {
    doc = readFileSync(join(root, "docs/security/credentials.md"), "utf8");
  } catch {
    // devlint: not-a-refusal -- an input the gate needs is unreadable, so this reports the fact rather than refusing on policy
    process.stderr.write("secrets-registry: docs/security/credentials.md is not readable\n");
    return 1;
  }
  const hits = [
    ...scanReaderClaims({ sources, specs: CREDENTIALS }),
    ...scanDocTable({ doc, specs: CREDENTIALS }),
    ...scanStore({
      declaredOn: ({ name }) => unlandedBranchesDeclaring({ name, root }),
      dir: stateHomePaths({ home: slopweaverHome() }).secrets,
      specs: CREDENTIALS,
    }),
  ];
  for (const hit of hits) {
    process.stderr.write(`  [${hit.check}] ${hit.message}\n`);
  }
  return reportSecretsRegistry({ complete, hits, scanned: scan.scanned });
}

/**
 * Print the verdict: a clean line, or the drifted table to paste followed by the four-line refusal.
 *
 * Split from {@link runSecretsRegistry} so that function stays under the body cap. The table is the
 * CORRECTION rather than a summary, which is why it survives beside the refusal instead of being folded
 * into it — no other gate's fix is a block of bytes the operator copies.
 *
 * @param hits every register/doc disagreement
 * @param complete whether the scan covered what it claims
 * @param scanned how many sources were read, for the clean line
 * @returns 0 when the register, readers, doc and store agree, else 1
 */
function reportSecretsRegistry({
  hits,
  complete,
  scanned,
}: {
  hits: readonly RegistryHit[];
  complete: boolean;
  scanned: number;
}): number {
  const outcome = gateOutcome({ refused: hits.length, unseen: complete ? 0 : 1 });
  if (outcome === "clean") {
    // devlint: not-a-refusal -- the clean line, which stdout carries and no refusal shape applies to
    process.stdout.write(
      `secrets-registry: clean (${String(CREDENTIALS.length)} declared, ${String(scanned)} source(s) scanned)\n`,
    );
    return 0;
  }
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- `reportScanIntegrity` has already named the sources that went unread; the
    // register agrees with everything the gate DID see, so there is no policy verdict to give over it
    return 1;
  }
  if (hits.some((hit) => hit.check === "doc-drift")) {
    // devlint: not-a-refusal -- a correction body: the header of the table the operator pastes
    process.stderr.write("\nThe tokens table docs/security/credentials.md must carry, between its fences:\n\n");
    for (const line of renderDocTable({ specs: CREDENTIALS })) {
      // devlint: not-a-refusal -- a correction body: the table rows themselves
      process.stderr.write(`${line}\n`);
    }
    // devlint: not-a-refusal -- a correction body: how to apply the table printed above it
    process.stderr.write("\n(run `yarn format` after pasting — Prettier repads the columns)\n");
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "secrets-registry" }),
      detail: `${String(hits.length)} register/doc disagreement(s)`,
    })}\n`,
  );
  return 1;
}
