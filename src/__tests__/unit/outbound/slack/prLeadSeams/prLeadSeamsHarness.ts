/*
 * The production read behind the sibling `*.test.ts` files here: every production TypeScript file under `src/`, the
 * write callees and judged producers `PR_LEAD_*` classify, and the counts the call-site and producer cases compare
 * against. Calls are read off each file's syntax tree by `../prLeadWalk.ts`; loads by `../prLeadModules.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TsModuleResolver } from "#lib/tsProject.js";
import {
  PR_LEAD_PRODUCERS,
  type PrLeadProducer,
  SLACK_WRITE_ENTRIES,
  SLACK_WRITE_METHODS,
} from "../../../../../outbound/slack/prLeadSeams.js";

import { loadsOf } from "../prLeadModules.js";
import { type callsIn, WALKED_EXTENSIONS, walkFile } from "../prLeadWalk.js";

/** The three spellings of the judgement a verb may call. */
export const JUDGEMENT = /\b(?:prLedSendRefusals|prLedRefusalsFor|prLedOpeningGate)\(/u;

/** The two classification modules, which spell every write callee as a string literal. */
const SELF: ReadonlySet<string> = new Set([
  "src/outbound/slack/prLeadCallSites.ts",
  "src/outbound/slack/prLeadSeams.ts",
]);

/** Every production TypeScript file under `src/`, in any extension the compiler takes, repository-relative. */
export const PRODUCTION: readonly string[] = readdirSync("src", { recursive: true })
  .map((entry) => join("src", String(entry)))
  .filter(
    (path) =>
      WALKED_EXTENSIONS.some((extension) => path.endsWith(extension)) &&
      !path.startsWith("src/__tests__/") &&
      !SELF.has(path),
  );

/** Each production file's text, by repository-relative path. */
export const SOURCE = new Map(PRODUCTION.map((path) => [path, readFileSync(path, "utf8")]));

/** Each callee a word-carrying write is reached by, keyed as `callsIn` spells it. */
export const WRITE_CALLEES: readonly string[] = [
  ...Object.entries(SLACK_WRITE_METHODS)
    .filter(([, carries]) => carries === "words")
    .map(([method]) => `.${method}`),
  ...SLACK_WRITE_ENTRIES,
];

/**
 * The names each write callee is spelled with (`.postCard` is `postCard`), so a file missing one of every set is never
 * parsed: parsing every production file ran past a loaded CI shard's timeout.
 */
const WRITE_NAMES: readonly (readonly string[])[] = WRITE_CALLEES.map((callee) =>
  callee.split(".").filter((segment) => segment !== ""),
);

/** A write's own name, as a whole word: what an unkeyable callee must not mention. */
export const WRITE_MENTION = new RegExp(`\\b(?:${WRITE_NAMES.map((names) => names.at(-1)!).join("|")})\\b`, "u");

/** The production files naming every part of some write callee: the only ones a write can be in. */
export const ADMITTED: readonly string[] = PRODUCTION.filter((file) =>
  WRITE_NAMES.some((names) => names.every((name) => SOURCE.get(file)!.includes(name))),
);

/** Every write callee and every judged producer's entry, watched for a value use. */
const WATCH: ReadonlySet<string> = new Set([
  ...WRITE_CALLEES,
  ...Object.values(PR_LEAD_PRODUCERS).flatMap((row) => (row.kind === "judged" ? [row.entry] : [])),
]);

/** The production files naming every part of some watched name: the only ones a value use can be in. */
export const WATCHED_FILES: readonly string[] = PRODUCTION.filter((file) =>
  [...WATCH].some((watched) =>
    watched
      .split(".")
      .filter((segment) => segment !== "")
      .every((name) => SOURCE.get(file)!.includes(name)),
  ),
);

/**
 * The write callee a call's keys reach: a key itself, or a bare entry called as a member (`.runCompositeSend`).
 *
 * @returns the callee, or nothing when no key reaches one
 */
export function writeKeyOf({ keys }: { keys: readonly string[] }): string | undefined {
  return WRITE_CALLEES.find((callee) => keys.includes(callee) || keys.includes(`.${callee}`));
}

const WALKS = new Map<string, ReturnType<typeof walkFile>>();

/**
 * `walkFile` over a production file with every write callee watched, parsed once however many cases read it.
 *
 * @returns the file's calls and value uses
 */
export function walked({ path }: { path: string }): ReturnType<typeof walkFile> {
  const seen = WALKS.get(path);
  if (seen !== undefined) {
    return seen;
  }
  const result = walkFile({ path, text: SOURCE.get(path)!, watch: WATCH });
  WALKS.set(path, result);
  return result;
}

/**
 * A production file's invocations.
 *
 * @returns each call, with the function it sits in
 */
export function walk({ path }: { path: string }): ReturnType<typeof callsIn> {
  return walked({ path }).calls;
}

/** Add one to `counts[key]`, starting it at one. */
function bump({ counts, key }: { counts: Record<string, number>; key: string }): void {
  const seen = counts[key];
  counts[key] = seen === undefined ? 1 : seen + 1;
}

/** Per enclosing function in `path`, the count of each write callee it calls. */
function writesIn({ path }: { path: string }): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const { keys, within } of walk({ path })) {
    const key = writeKeyOf({ keys });
    if (key !== undefined) {
      const inFunction = counts[within];
      if (inFunction === undefined) {
        counts[within] = { [key]: 1 };
      } else {
        bump({ counts: inFunction, key });
      }
    }
  }
  return counts;
}

/**
 * Per production file and enclosing function, the count of each write callee it calls, omitting what is never called.
 *
 * @returns the counts, keyed by file then function then callee
 */
export function countCallSites(): Record<string, Record<string, Record<string, number>>> {
  const counted: Record<string, Record<string, Record<string, number>>> = {};
  for (const path of ADMITTED) {
    const counts = writesIn({ path });
    if (Object.keys(counts).length > 0) {
      counted[path] = counts;
    }
  }
  return counted;
}

const LOADS = new Map<string, ReadonlySet<string>>();

/** Every judged producer's file — what a caller is found by loading. */
const PRODUCER_FILES: readonly string[] = Object.entries(PR_LEAD_PRODUCERS).flatMap(([file, row]) =>
  row.kind === "judged" ? [file] : [],
);

/** Every judged producer's file a production file could load by a literal local specifier, read once. */
function loadsOfFile({ path, resolver }: { path: string; resolver: TsModuleResolver }): ReadonlySet<string> {
  const seen = LOADS.get(path);
  if (seen !== undefined) {
    return seen;
  }
  const result = loadsOf({ path, resolver, targets: PRODUCER_FILES, text: SOURCE.get(path)! });
  LOADS.set(path, result);
  return result;
}

/**
 * Every production file that could load `file`, however the specifier is spelled and whatever loads it.
 *
 * @returns the importing files
 */
export function importersOf({ file, resolver }: { file: string; resolver: TsModuleResolver }): readonly string[] {
  return PRODUCTION.filter((path) => path !== file && loadsOfFile({ path, resolver }).has(file));
}

/**
 * Per file loading `file`, or `file` itself, and per enclosing function, how many times it calls `entry`. Complete
 * because nothing re-exports an entry: a named re-export is a value use, and any re-export of its file is refused below.
 *
 * @returns the counts, keyed by file then function
 */
export function countCallers({
  entry,
  file,
  resolver,
}: {
  entry: string;
  file: string;
  resolver: TsModuleResolver;
}): Record<string, Record<string, number>> {
  const counted: Record<string, Record<string, number>> = {};
  for (const path of [file, ...importersOf({ file, resolver })]) {
    const counts: Record<string, number> = {};
    for (const { keys, within } of walk({ path })) {
      if (keys.includes(entry) || keys.includes(`.${entry}`)) {
        bump({ counts, key: within });
      }
    }
    if (Object.keys(counts).length > 0) {
      counted[path] = counts;
    }
  }
  return counted;
}

/** Every classified producer row, with its file. */
export const ROWS: readonly (readonly [string, PrLeadProducer])[] = Object.entries(PR_LEAD_PRODUCERS);

/** The judged rows, each with its fields in reach. */
export const JUDGED = ROWS.flatMap(([file, row]) => (row.kind === "judged" ? [{ file, row }] : []));
