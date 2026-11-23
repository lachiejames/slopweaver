/**
 * The card-age measurement's entry point — the reading half, so `./briefingCardAge.ts` stays pure.
 *
 * ```
 * yarn tsx src/measurement/briefingCardAge.entry.ts \
 *   --open-pages ~/.slopweaver/supervisor-scratch/handoff-<n>/open-pages.json \
 *   --briefings '~/.slopweaver/supervisor-scratch/handoff-<n>/briefing-t*.html'
 * ```
 *
 * `--briefings` takes a GLOB and expands it here rather than leaning on the shell, so the same command works
 * quoted (which it must be, or the shell hands over one expanded argument per file and the twentieth-newest
 * cut this does silently becomes a different set).
 */
import { globSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { type MeasuredVersion, measureVersion, totalAges } from "./briefingCardAge.js";

/** The age the totals are counted against, and the one `../briefing/cardPremise.ts` states its finding in. */
const THRESHOLD_HOURS = 12;

/** How many of the newest versions the report covers, which is the window the finding was stated over. */
const VERSIONS = 20;

/** One flag's value, or `undefined` when the caller gave none. */
function flag({ argv, name }: { argv: readonly string[]; name: string }): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
}

/**
 * A path with a leading `~` resolved, since the command in the doc comment above carries one.
 *
 * `homedir()` rather than `$HOME`, which can be unset — and an unset home on a `~/` path is a reading this
 * measurement cannot do, so it throws rather than silently resolving against the working directory.
 */
function expand({ path }: { path: string }): string {
  const swapped = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(swapped) ? swapped : resolve(process.cwd(), swapped);
}

/** Each open page's own landing instant, keyed by URL, from the `--open-artifacts` document. */
function landedByUrl({ path }: { path: string }): ReadonlyMap<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : [];
  const landed = new Map<string, string>();
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const url = row["url"];
    const iso = row["landedIso"];
    if (typeof url === "string" && typeof iso === "string") {
      landed.set(url, iso);
    }
  }
  return landed;
}

const argv = process.argv.slice(2);
const openPages = flag({ argv, name: "open-pages" });
const briefings = flag({ argv, name: "briefings" });
if (openPages === undefined || briefings === undefined) {
  process.stderr.write(
    "usage: yarn tsx src/measurement/briefingCardAge.entry.ts --open-pages <json> --briefings '<glob>'\n",
  );
  process.exit(2);
}

const landed = landedByUrl({ path: expand({ path: openPages }) });
const files = globSync(expand({ path: briefings }))
  .map((path) => ({ mtimeMs: statSync(path).mtimeMs, path }))
  .toSorted((left, right) => left.mtimeMs - right.mtimeMs)
  .slice(-VERSIONS);

const versions: MeasuredVersion[] = files.map((file) =>
  measureVersion({
    html: readFileSync(file.path, "utf8"),
    landedByUrl: landed,
    renderedIso: new Date(file.mtimeMs).toISOString(),
    source: file.path,
  }),
);

for (const version of versions) {
  const ages = version.cards.map((card) => card.ageHours).filter((age): age is number => age !== undefined);
  const over = ages.filter((age) => age > THRESHOLD_HOURS).length;
  const oldest = ages.length === 0 ? "-" : `${ages.reduce((a, b) => Math.max(a, b), 0).toFixed(1)}h`;
  process.stdout.write(
    `${version.renderedIso}  ${String(version.cards.length).padStart(3)} cards  ` +
      `${String(ages.length).padStart(3)} datable  ${String(over).padStart(3)} over ${String(THRESHOLD_HOURS)}h  ` +
      `oldest ${oldest}\n`,
  );
}

const totals = totalAges({ thresholdHours: THRESHOLD_HOURS, versions });
process.stdout.write(
  `\n${String(versions.length)} version(s): ${String(totals.appearances)} card-appearance(s), ` +
    `${String(totals.datable)} datable, ${String(totals.appearances - totals.datable)} with no age source at all, ` +
    `${String(totals.overThreshold)} over ${String(THRESHOLD_HOURS)} hours, oldest ` +
    `${totals.oldestHours === undefined ? "none" : `${totals.oldestHours.toFixed(1)}h`}\n`,
);
