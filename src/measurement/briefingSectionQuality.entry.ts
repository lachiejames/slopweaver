/**
 * The section-quality measurement's entry point — the reading half, so `./briefingSectionQuality.ts` stays
 * pure.
 *
 * ```
 * yarn tsx src/measurement/briefingSectionQuality.entry.ts \
 *   --forms '~/.slopweaver/supervisor-scratch/handoff-*\/form.json'
 * ```
 *
 * `--forms` takes a GLOB and expands it here rather than leaning on the shell, so the same command works
 * quoted — which it must be, or the shell hands over one expanded argument per file and every form after the
 * first is silently dropped.
 *
 * It reads the FORM rather than the rendered page, which is the opposite call `./briefingCardAge.entry.ts`
 * made and for the matching reason: a card's age never existed in the form, and a section's prose never
 * exists anywhere else. Every cell here is what a composer wrote, before a renderer touched it.
 */
import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { type MeasuredCell, measureCell, measuredKinds, renderMeasurement } from "./briefingSectionQuality.js";

/** One flag's value, or `undefined` when the caller gave none. */
function flag({ argv, name }: { argv: readonly string[]; name: string }): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
}

/** A path with a leading `~` resolved, since the command in the doc comment above carries one. */
function expand({ path }: { path: string }): string {
  const swapped = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(swapped) ? swapped : resolve(process.cwd(), swapped);
}

/** One content array as the text a reader meets, the way `textOfContent` joins one. */
function textOf({ value }: { value: unknown }): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((run) => (isRecord(run) && typeof run["text"] === "string" ? run["text"] : "")).join("");
}

/** Every note's headline in one section-shaped record, as cells of the named kind. */
function notesOf({ cell, value }: { cell: string; value: unknown }): readonly MeasuredCell[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((note) => (isRecord(note) ? [{ cell, text: textOf({ value: note["headline"] }) }] : []));
}

/** Every composed cell one form carries, in the kinds the report groups by. */
function cellsOf({ form }: { form: unknown }): readonly MeasuredCell[] {
  if (!isRecord(form)) {
    return [];
  }
  const header = isRecord(form["header"]) ? form["header"] : {};
  const alignment = isRecord(form["alignment"]) ? form["alignment"] : {};
  const reactNow = isRecord(form["reactNow"]) ? form["reactNow"] : {};
  const earlierToday = isRecord(form["earlierToday"]) ? form["earlierToday"] : {};
  const history = Array.isArray(form["history"]) ? form["history"] : [];
  const cards = [reactNow["teamFacing"], reactNow["meFacing"]].flatMap((group) => (Array.isArray(group) ? group : []));
  const ranked = Array.isArray(reactNow["openArtifacts"]) ? reactNow["openArtifacts"] : [];
  const awaiting = Array.isArray(form["awaiting"]) ? form["awaiting"] : [];
  const yourRows =
    isRecord(form["yourList"]) && Array.isArray(form["yourList"]["rows"]) ? form["yourList"]["rows"] : [];
  return [
    { cell: "header lede", text: textOf({ value: header["lede"] }) },
    { cell: "alignment headline", text: textOf({ value: alignment["headline"] }) },
    ...cards.flatMap((card) =>
      isRecord(card) ? [{ cell: "card `what` (gated)", text: textOf({ value: card["what"] }) }] : [],
    ),
    ...ranked.flatMap((row) => (isRecord(row) ? [{ cell: "ranked ask", text: textOf({ value: row["ask"] }) }] : [])),
    ...awaiting.flatMap((row) =>
      isRecord(row) ? [{ cell: "awaiting waiting-on", text: textOf({ value: row["waitingOn"] }) }] : [],
    ),
    ...yourRows.flatMap((row) =>
      isRecord(row) ? [{ cell: "your-list headline", text: textOf({ value: row["headline"] }) }] : [],
    ),
    ...notesOf({ cell: "recent note headline", value: form["recent"] }),
    ...notesOf({ cell: "earlier-today headline", value: earlierToday["notes"] }),
    ...history.flatMap((section) =>
      isRecord(section) ? notesOf({ cell: "history note headline", value: section["notes"] }) : [],
    ),
  ].filter((cell) => cell.text.trim().length > 0);
}

const argv = process.argv.slice(2);
const forms = flag({ argv, name: "forms" });
if (forms === undefined) {
  process.stderr.write("usage: yarn tsx src/measurement/briefingSectionQuality.entry.ts --forms '<glob>'\n");
  process.exit(2);
}

const files = globSync(expand({ path: forms })).toSorted();
const cells = files.flatMap((path) => {
  try {
    return cellsOf({ form: JSON.parse(readFileSync(path, "utf8")) });
  } catch {
    // A scratch directory holds half-written forms; one that will not parse is not a reading.
    return [];
  }
});

const readings = cells.map((cell) => measureCell({ cell }));
for (const line of renderMeasurement({ kinds: measuredKinds({ readings }) })) {
  process.stdout.write(`${line}\n`);
}
process.stdout.write(
  `\n${String(files.length)} form(s), ${String(readings.length)} composed cell(s), ` +
    `${String(readings.filter((reading) => reading.unglossed !== undefined).length)} using a fleet word the ` +
    "cell never explains\n",
);
