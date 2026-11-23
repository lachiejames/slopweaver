/**
 * Pure argument handling and rendering for `slopweaver atlas probe` — the estate-wide count of a
 * question's keywords against the atlas tables.
 *
 * The statements and the folds are `src/store/atlas/probe.ts`'s and the connection is
 * {@link ./probeRun}'s; what lives here is the flag spec and the lines. Nothing in this file counts
 * anything.
 *
 * ## The one sentence every rendering of this verb carries
 *
 * A count here is a count of STORED records and proves nothing about a provider. That is not a hedge, it
 * is the finding `src/atlas/kit/estateEvidence.ts` was written for: Datadog's `monitor` kind held 29 SDK
 * operations and zero monitors while `atlas doctor` graded the whole atlas ANSWERABLE, and two dogfood
 * turns quoted it. So this verb SIZES a lead and `slopweaver atlas <platform> read` ANSWERS it — that verb
 * is the one carrying the claim boundary, the estate line and the per-row match witness.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import {
  ATLAS_CELL_LIMIT,
  type AtlasProbeReport,
  atlasCellLine,
  atlasHoldingLine,
  foldPlatforms,
} from "../../../store/atlas/probe.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

import { atlasCommandErrorLines } from "./errors.js";
import { integerFlagAtLeast } from "./integerFlag.js";

/**
 * The flag names, held as two arrays rather than inline in the spec.
 *
 * The sibling estate verbs read their spec back through `stringFlagsOf` / `booleanFlagsOf` (`parseFlags.ts`),
 * which name the absence of `FlagSpec`'s two optional keys at one binding. Naming the arrays first means the
 * spec and {@link ATLAS_PROBE_FLAG_NAMES} read the SAME values with nothing absent to name at all.
 */
const ATLAS_PROBE_BOOLEAN_FLAGS = ["json"] as const;

/** The flags that take a value — same reason as {@link ATLAS_PROBE_BOOLEAN_FLAGS}. */
const ATLAS_PROBE_STRING_FLAGS = ["platform", "cells"] as const;

/** Every flag this verb accepts. The spec is local; {@link ATLAS_PROBE_FLAG_NAMES} is what leaves. */
const ATLAS_PROBE_FLAGS: FlagSpec = {
  boolean: ATLAS_PROBE_BOOLEAN_FLAGS,
  string: ATLAS_PROBE_STRING_FLAGS,
};

/** Every flag NAME, derived from the same arrays the spec holds, so the two cannot drift. */
export const ATLAS_PROBE_FLAG_NAMES: readonly string[] = [...ATLAS_PROBE_BOOLEAN_FLAGS, ...ATLAS_PROBE_STRING_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * How many cells one keyword keeps when the caller names no cap.
 *
 * The store module owns the number so the verb default and the statement cap cannot drift; this is a
 * re-export rather than a second literal.
 */
export const DEFAULT_ATLAS_PROBE_CELLS = ATLAS_CELL_LIMIT;

/** What an `atlas probe` invocation asked for. */
export interface AtlasProbeArgs {
  readonly terms: readonly string[];
  readonly platform: string | null;
  readonly cells: number;
  readonly json: boolean;
}

/**
 * Parse the verb's arguments.
 *
 * Keywords are POSITIONAL for the reason `../store/probeCore.ts` records: `parseArgs` folds a repeated
 * flag to its last value, so a `--term` list would silently probe one keyword while looking like a
 * working command.
 *
 * **No keyword is a MODE, not a mistake.** It is the cheap SCOPE read — what each platform holds — and it
 * exists because `src/route/genericCapabilities.ts`'s `atlas-estate` row needs a command a routing session
 * can run before it has decided on keywords. An earlier draft refused here, which made that row's own
 * `run:` line either a refusal or a whole English sentence fed to an `ilike` filter, matching nothing and
 * reading as absence.
 *
 * @param rest the argv tail after `atlas probe`
 * @returns the resolved options, or every usage problem found
 */
export function parseAtlasProbeArgs({ rest }: { rest: readonly string[] }): Result<AtlasProbeArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: ATLAS_PROBE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, positionals } = parsed.value;
  const terms = positionals.filter((word) => word.trim().length > 0);
  const cells = integerFlagAtLeast({
    fallback: DEFAULT_ATLAS_PROBE_CELLS,
    min: 1,
    name: "cells",
    raw: values["cells"],
  });
  if (cells.isErr()) {
    return err(atlasCommandErrorLines({ error: cells.error }));
  }
  return ok({
    cells: cells.value,
    json: values["json"] === true,
    platform: typeof values["platform"] === "string" ? values["platform"] : null,
    terms,
  });
}

/**
 * One keyword's block of the human report.
 *
 * @param report what the probe counted
 * @returns the lines
 */
function rowLines({ report }: { report: AtlasProbeReport }): readonly string[] {
  return report.rows.flatMap((row) => {
    const named =
      row.platformNames.length === 0
        ? []
        : [`  the keyword names ${String(row.platformNames.length)} atlas itself: ${row.platformNames.join(", ")}`];
    const cells =
      row.cells.length === 0
        ? ["  no stored atlas record carries it"]
        : row.cells.map((cell) => `  ${atlasCellLine({ cell })}`);
    const platforms = foldPlatforms({ row });
    const roll =
      platforms.length === 0
        ? []
        : [
            `  platforms: ${platforms
              .map((each) => `${each.platform} ${String(each.entities)} in ${String(each.kinds)} kind(s)`)
              .join(" · ")}`,
          ];
    return [`${row.subject}  (${String(row.elapsedMs)}ms)`, ...named, ...cells, ...roll, ""];
  });
}

/**
 * The keyword-less SCOPE report: what each platform holds, and nothing about any question.
 *
 * Its closing line points at the keyword form rather than leaving a reader with a table, because this
 * report is what a routing session runs FIRST — `src/route/genericCapabilities.ts`'s `atlas-estate` row —
 * and the next act is always a keyword, never another scope read.
 *
 * @param report what the probe counted
 * @returns the lines
 */
function holdingLines({ report }: { report: AtlasProbeReport }): readonly string[] {
  return [
    ...report.holdings.map((holding) => `  ${atlasHoldingLine({ holding })}`),
    "",
    `${String(report.holdings.length)} platform(s) hold stored atlas rows.`,
    "Name one or more KEYWORDS to size a question against them: `slopweaver atlas probe <keyword> [<keyword>…]`.",
  ];
}

/**
 * The human report an atlas probe prints.
 *
 * The closing two lines are not decoration: without them a reader takes a cell count for a statement about
 * the provider, which is the exact defect `estateEvidence.ts` records two dogfood turns making.
 *
 * @param report what the probe counted
 * @returns the lines
 */
export function atlasProbeLines({ report }: { report: AtlasProbeReport }): readonly string[] {
  const scope = report.platform === null ? "the whole estate" : `the ${report.platform} atlas`;
  // The total stays estate-wide even under `--platform`, because its job is the never-imported sentinel
  // (`../../../store/atlas/probe.ts`'s `atlasTotalStatement`) rather than the scope's own size — a
  // platform-filtered zero would fire "this install never ran import-atlas" at an atlas that simply holds
  // nothing. So the head SAYS which one it is, instead of letting a narrowed scope read it as its own.
  const acrossAll = report.platform === null ? "" : " across all atlases";
  const head = `atlas probe over ${scope} — ${String(report.atlasEntities)} stored entity row(s)${acrossAll}, ${String(report.elapsedMs)}ms`;
  if (report.rows.length === 0) {
    return [head, "", ...holdingLines({ report })];
  }
  const empty =
    report.atlasEntities === 0
      ? [
          "the atlas tables hold NO entity rows at all — this install has never run `slopweaver store import-atlas`,",
          "so every zero above is about the STORE rather than about any platform",
          "",
        ]
      : [];
  return [
    head,
    "",
    ...rowLines({ report }),
    ...empty,
    "A count here is of STORED records and proves nothing about what a provider holds.",
    "Open the winner with `slopweaver atlas <platform> read --kind <kind> --query <keyword>` — that verb",
    "carries the claim boundary, the estate line and the per-row match witness; this one only sizes.",
  ];
}
