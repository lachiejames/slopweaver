/**
 * `slopweaver handover row --slug <slug>` — ONE board row, composed exactly as `handover list` composes it,
 * without reading the rest of the board.
 *
 * It exists for a caller that wants one row's whole card now — a step linking a console queue row as
 * `?open=ask:<slug>` — for which the whole board's seconds are too slow.
 *
 * Same composer, smaller input: the target and its `blockedBy` closure (`../../../handover/rowClosure.ts`)
 * go through `journalEvidence`, `probeStates` and `composeBoardModels`, and the row is `boardJsonRow`, so
 * this verb and the board cannot disagree about a row's section, question, shape or stakes. `command:`
 * probes are not run, exactly as a bare `list` does not run them.
 *
 * Parity is with a COMPLETE board. A `list` whose `--deadline` cut its probe sweep says so (`unresolved` > 0)
 * and places its later rows without their probe evidence; this verb sweeps only its closure, so it is never
 * cut and never has that gap. There the row is the truer of the two, not the defect.
 *
 * A row is found by FILE NAME, `<slug>.md` — `lookupDocBySlug`'s contract — while `handover list` scans every
 * file and keys a row by its front-matter `slug:`. The two differ only for a doc filed under another name, and
 * the refusal names the file it looked for, so such a doc is reported rather than silently absent. MEASURED
 * on the owner's board: none of the 3,068 `.md` files in the handovers directory is named other than its slug.
 * Repro: `cd ~/.slopweaver/handovers; for f in *.md; do s=$(awk "/^slug:/{print \$2; exit}" "$f");
 * [ -n "$s" ] && [ "$s.md" != "$f" ] && echo "$f"; done | wc -l`.
 *
 * The slug must also pass `isSafeSlug` — the rule every run verb already holds
 * — so a doc slugged with, say, a space has a `list` row and no `row` one. MEASURED: none
 * of the same 3,068 files carries such a slug. Repro: the loop above, testing `$s` against `^[A-Za-z0-9._-]+$`
 * with awk printing the whole line after `slug:`.
 *
 * MEASURED on the owner's board (733 docs), warm: 0.73–0.97 s per row, against 0.66–0.72 s for
 * `hand list --ranked --json` (the CLI's own start-up is most of both) and 7.8 s for `handover list --json`.
 * Two cold first reads took 2.2 s and 3.0 s. Repro: `for s in iso-compliance-violations-bigtask
 * devx-709-ratchet-pair-pick; do /usr/bin/time -p ./bin/slopweaver handover row --slug $s --json >/dev/null;
 * done`.
 */
import { join } from "node:path";

import { journalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { rowClosure } from "../../../handover/rowClosure.js";
import { isSafeSlug } from "../../../handover/runStore.js";
import { lookupDocBySlug } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { boardReferences } from "./boardReferences.js";
import { boolFlag, flagNamesOf, resolveHandoverDir, stringFlag, VERB_ARG_OFFSET } from "./commandSupport.js";
import { boardOwnerNames } from "./pauseOwnerCheck.js";
import { probeStates } from "./probeSweep.js";
import { repoPullScale } from "./repoPullScale.js";
import { boardRowJsonText } from "./rowJson.js";

/** The flags `handover row` accepts, names without the leading `--`. */
const ROW_FLAGS: FlagSpec = { boolean: ["full", "json"], string: ["slug", "base", "dir", "home"] };

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const HANDOVER_ROW_FLAG_NAMES: readonly string[] = flagNamesOf({ spec: ROW_FLAGS });

const ROW_USAGE =
  "usage: slopweaver handover row --slug <slug> [--base <branch>] [--dir <path>] [--home <dir>] [--full] [--json]\n" +
  "\n" +
  "One board row, composed exactly as `handover list` composes it, from the live doc named <slug>.md and the\n" +
  "docs its blockedBy reaches — never the rest of the board. `command:` probes are not run. An archived doc\n" +
  "exits 3: the board carries no row for it.\n" +
  "\n" +
  "--full  print the doc's path under the row's one line. Text only: --json is the same either way.\n" +
  "--json  the row as `handover list --json` prints it, as one object, with its summary whole rather than\n" +
  "        capped at 320 characters, plus repoLargestPull: the largest (#N) its repo: checkout's default\n" +
  "        branch names, so a card with no board still links a bare pull-request number.";

/**
 * Parse `handover row` flags. Exported so the help-truth ratchet probes the real parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseHandoverRowArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: ROW_FLAGS });
}

/**
 * One slug's doc by exact file name, and whether it came from the archive.
 *
 * @param handoverDir the top-level handovers directory
 * @returns the lookup `rowClosure` walks with
 */
function exactLookup({
  handoverDir,
}: {
  handoverDir: string;
}): (request: { slug: string }) => { doc: HandoverDoc; archived: boolean } | undefined {
  return ({ slug }) => {
    // A `blockedBy` entry is authored text, so an unsafe one is a missing dependency, never a path.
    if (!isSafeSlug({ slug })) {
      return undefined;
    }
    const doc = lookupDocBySlug({ handoverDir, slug });
    if (doc === undefined) {
      return undefined;
    }
    return { archived: doc.path !== join(handoverDir, `${slug}.md`), doc };
  };
}

/**
 * Compose one slug's board row, or say why there is none — also what `handover example` reads a row's question off,
 * so the row it writes to is the row the board publishes.
 *
 * @param slug the row asked for, already checked safe
 * @param base the branch probes compare against, when named
 * @param handoverDir the top-level handovers directory
 * @param home the state home whose run journals are read
 * @returns the model, or the exit code and line that explain its absence
 */
export function composeRow({
  slug,
  base,
  handoverDir,
  home,
}: {
  slug: string;
  base: string | undefined;
  handoverDir: string;
  home: string;
}): { kind: "row"; model: BoardModel } | { kind: "none"; exit: number; line: string } {
  const read = rowClosure({ lookup: exactLookup({ handoverDir }), slug });
  if (read.kind === "missing") {
    return {
      exit: EXIT_ERROR,
      kind: "none",
      line: `handover row: no readable doc carries slug ${slug} as ${slug}.md under ${handoverDir} or its archive/`,
    };
  }
  if (read.kind === "archived") {
    // `handover list` never shows an archived doc, so a row composed from one would be a row nothing else has.
    return {
      exit: EXIT_EXPECTED_EMPTY,
      kind: "none",
      line: `handover row: ${slug} is archived (${read.doc.path}), so the board carries no row for it`,
    };
  }
  const { roots } = read;
  const sweep = probeStates({ base, docs: roots, runCommands: false });
  const [model] = composeBoardModels({
    journals: journalEvidence({ docs: roots, runsDir: stateHomePaths({ home }).runs }),
    probeStates: sweep.states,
    resolutionDocs: [...roots, ...read.archived],
    roots,
  });
  // `composeBoardModels` maps roots one-for-one and the target is the first root; a model missing here is the
  // composer breaking that contract, said as such rather than printed as an empty row.
  if (model === undefined) {
    return { exit: EXIT_ERROR, kind: "none", line: `handover row: the board composed no model for ${slug}` };
  }
  return { kind: "row", model };
}

/**
 * Print one row.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverRow(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ROW_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverRowArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: ROW_USAGE });
    return EXIT_USAGE;
  }
  const slug = stringFlag({ name: "slug", parsed: parsed.value });
  if (slug === undefined || !isSafeSlug({ slug })) {
    logger.error({ msg: "handover row: --slug takes one doc's slug — letters, digits, dots, dashes, underscores" });
    logger.error({ msg: ROW_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const handoverDir = resolveHandoverDir({ dir: stringFlag({ name: "dir", parsed: parsed.value }), home });
  const row = composeRow({ base: stringFlag({ name: "base", parsed: parsed.value }), handoverDir, home, slug });
  if (row.kind === "none") {
    logger.error({ msg: row.line });
    return row.exit;
  }
  const { model } = row;
  if (boolFlag({ name: "json", parsed: parsed.value })) {
    const { repo } = model.doc;
    const ownerNames = await boardOwnerNames({ home, identityRoster: identityRosterPort() });
    const references = boardReferences({ home, ownerNames, paths: repo === undefined ? [] : [repo] });
    const repoLargestPull = repo === undefined ? undefined : repoPullScale({ path: repo });
    logger.out({ line: boardRowJsonText({ model, references, repoLargestPull }) });
    return EXIT_OK;
  }
  for (const line of handoverRowLines({ full: boolFlag({ name: "full", parsed: parsed.value }), model })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * One row as text: its slug, section and reason, and with `--full` the doc's path as well.
 *
 * @param full whether `--full` was passed
 * @param model the composed row
 * @returns the lines to print
 */
export function handoverRowLines({ full, model }: { full: boolean; model: BoardModel }): readonly string[] {
  const head = `${model.doc.slug} — ${model.section}: ${model.reason}`;
  if (!full) {
    return [head];
  }
  return [head, `  path: ${model.doc.path}`];
}

export const handoverRowCommand = defineCommand({ run: runHandoverRow });
