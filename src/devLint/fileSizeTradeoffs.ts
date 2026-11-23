/**
 * The file-size TRADEOFF register — the one way a hand-maintained file may stay over its cap — and the findings
 * `file-size-ratchet` raises from the markers `./fileSizeMeasure.ts` reads.
 *
 * Oversized files are always split unless splitting carries a massive tradeoff. So a split is the default and an exemption is the exception the
 * owner signs: the inline exemption marker exempts NOTHING on its own. It takes effect only when
 * {@link TRADEOFF_FILE} holds a row for the same path naming the tradeoff that makes the split worse and the
 * anchor of their yes. The register is written by hand and never by `--rebaseline`, because it records authority
 * rather than measurement; and it is a ratchet baseline (`./baselineRegistry.ts`), so a new row is a loosening
 * against main that needs a bump manifest and its witness, exactly as a raised floor row does.
 *
 * Three findings come out of one scan of every measured file, under the cap or not, so a marker cannot sit
 * waiting for a file to grow into it:
 *
 * - **unrecorded** — a file declares the exemption marker and the register holds no row for it. The file is
 *   measured as an ordinary one, so an over-cap one ALSO earns the size regression. A TEST file's marker is
 *   always unrecorded, row or not: a test file is never exempt (`fileSizeOf`), so its row can never take effect.
 * - **stale** — a row whose file is gone or no longer declares the marker. Debt, refused through the same id as
 *   a floor row that stopped firing.
 * - **retired** — a file still declares the register marker. A register is split by category like any other
 *   file (the same ruling), so the marker raises and exempts nothing and is refused
 *   by name; measured silently, an under-cap one would pass and an over-cap one would earn a size failure that
 *   never says the mechanism is gone.
 *
 * Pure but for {@link printTradeoffFindings}, the stderr edge the gate calls; the gate's own edge reads the file.
 */
import { z } from "zod";
import { err, ok, type Result } from "../lib/result.js";
import { decodeDebtList } from "./decodeDebtList.js";
import { type DevLintInputError, DevLintInputErrors } from "./errors.js";
import { type FileSize } from "./fileSizeMeasure.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { isTestFilePath } from "./scanScope.js";

/** The committed register of signed tradeoffs, repo-relative. Hand-written; `--rebaseline` never touches it. */
export const TRADEOFF_FILE = ".baselines/file-size-tradeoffs.json";

/** How the register names itself in an input failure. */
const LABEL = "file-size tradeoffs";

/** The committed register: one signed exception per row. Empty is its expected state: no case was named. */
export interface FileSizeTradeoffs {
  readonly tradeoffs: readonly { readonly path: string; readonly tradeoff: string; readonly ownerApproval: string }[];
}

const tradeoffsSchema = z.object({
  tradeoffs: z.array(
    z.object({
      ownerApproval: z.string().trim().min(1),
      path: z.string().trim().min(1),
      tradeoff: z.string().trim().min(1),
    }),
  ),
});

/**
 * Decode the committed tradeoff register. Pure — every field must be non-blank and a path may hold one row.
 *
 * @param text the register file's contents
 * @returns the register, or why it could not be decoded
 */
export function parseFileSizeTradeoffsJson({ text }: { text: string }): Result<FileSizeTradeoffs, DevLintInputError> {
  const decoded = decodeDebtList({
    label: LABEL,
    schema: tradeoffsSchema,
    shape: "{ tradeoffs: [{ path, tradeoff, ownerApproval }] } with every field non-blank",
    text,
  });
  if (decoded.isErr()) {
    return err(decoded.error);
  }
  const seen = new Set<string>();
  for (const row of decoded.value.tradeoffs) {
    if (seen.has(row.path)) {
      return err(DevLintInputErrors.tradeoffPathDuplicate({ label: LABEL, path: row.path }));
    }
    seen.add(row.path);
  }
  return ok(decoded.value);
}

/** What one scan found against the register, each list sorted by path. */
export interface FileSizeTradeoffDebt {
  readonly unrecorded: readonly string[];
  readonly stale: readonly string[];
  readonly retiredMarkers: readonly string[];
}

/**
 * Every marker or register row that does not hold, across the WHOLE scanned tree. Pure.
 *
 * @param files every measured file, under its cap or not
 * @param tradeoffs the committed register
 * @returns the unrecorded markers, stale rows and retired markers, each sorted by path
 */
export function fileSizeTradeoffDebtOf({
  files,
  tradeoffs,
}: {
  files: readonly FileSize[];
  tradeoffs: FileSizeTradeoffs;
}): FileSizeTradeoffDebt {
  const rows = new Set(tradeoffs.tradeoffs.map((row) => row.path));
  const marked = files.filter((file) => file.exemptMarker).map((file) => file.path);
  const markedSet = new Set(marked);
  const byPath = (a: string, b: string): number => a.localeCompare(b);
  return {
    retiredMarkers: files
      .filter((file) => file.registerMarker)
      .map((file) => file.path)
      .toSorted(byPath),
    stale: [...rows].filter((path) => !markedSet.has(path)).toSorted(byPath),
    unrecorded: marked.filter((path) => isTestFilePath({ path }) || !rows.has(path)).toSorted(byPath),
  };
}

/**
 * One scan's findings grouped by the refusal each prints under: unrecorded first, then retired, then stale rows
 * through the shared debt id, a kind with no path left out. Pure.
 *
 * @param debt one scan's findings
 * @returns each non-empty kind with its refusal id, its paths and what each path line says
 */
export function tradeoffFindingsOf({ debt }: { debt: FileSizeTradeoffDebt }): readonly {
  readonly id: "file-size-ratchet-unrecorded-tradeoff" | "file-size-ratchet-retired-marker" | "file-size-ratchet-debt";
  readonly paths: readonly string[];
  readonly says: string;
}[] {
  const kinds = [
    {
      id: "file-size-ratchet-unrecorded-tradeoff",
      paths: debt.unrecorded,
      says: `an exemption marker with no row in ${TRADEOFF_FILE}, which exempts nothing`,
    },
    {
      id: "file-size-ratchet-retired-marker",
      paths: debt.retiredMarkers,
      says: "declares the retired register marker",
    },
    {
      id: "file-size-ratchet-debt",
      paths: debt.stale,
      says: `a row in ${TRADEOFF_FILE} whose file is gone or declares no exemption marker`,
    },
  ] as const;
  return kinds.filter((kind) => kind.paths.length > 0);
}

/**
 * Print one scan's findings to stderr — each path, then the refusal for its kind. IO edge, the module's one.
 *
 * @param debt one scan's findings
 * @returns how many kinds printed a refusal, zero when every marker and row holds
 */
export function printTradeoffFindings({ debt }: { debt: FileSizeTradeoffDebt }): number {
  const findings = tradeoffFindingsOf({ debt });
  for (const finding of findings) {
    for (const path of finding.paths) {
      process.stderr.write(`  ${path}: ${finding.says}\n`);
    }
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: finding.id }),
        detail: `${String(finding.paths.length)} file(s)`,
      })}\n`,
    );
  }
  return findings.length;
}
