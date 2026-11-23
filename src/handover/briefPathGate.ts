/**
 * The effectful half of the relative-path writer gate: read the two top-level name sets, ask the pure criterion in
 * {@link ./briefPaths.ts}, and render the refusal the two brief-writing doors print.
 *
 * The reads are `readdirSync` of two directories — the state home and the repository root — and both are
 * injected so every decision path is unit-tested without touching a disk. Neither read is allowed to be the
 * reason a door fails: a state home that cannot be listed means there is nothing to be relative TO, so the
 * gate answers "clean" rather than refusing on its own inability to look. A gate that failed closed here
 * would wedge `handover register` on any machine whose home had not been created yet.
 */
import { readdirSync } from "node:fs";

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { slopweaverHome } from "../homeDir.js";
import { briefPathCorrection, briefText, UNROOTED_BRIEF_PATH_HATCH, unrootedBriefPaths } from "./briefPaths.js";

/** List one directory's top-level entry names, answering an empty list rather than throwing. */
function entriesOf({ dir }: { dir: string }): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Whether this process may write a brief carrying an unrooted path anyway.
 *
 * Read into a local and OR-ed with the caller's own argument rather than written as a parameter default:
 * `hatch-release` refuses the default spelling anywhere in the tree, because a caller that always passes an
 * argument would skip the initialiser and close a hatch the operator had just opened.
 *
 * @param env the process environment
 * @param already whether the caller has its own reason to allow this
 * @returns true when the gate should report nothing
 */
function unrootedBriefPathAllowed({
  env,
  already,
}: {
  env: Readonly<Record<string, string | undefined>>;
  already: boolean;
}): boolean {
  const open = env[UNROOTED_BRIEF_PATH_HATCH] === "1";
  return already || open;
}

/**
 * The tokens {@link unrootedBriefPathRefusal} would refuse a brief on — none while the hatch is open. Exported for a
 * verb that PRINTS a `handover register` command (`../cli/commands/incident/postmortems.ts`), so what it prints is
 * judged by the same reads and criterion the pasted command meets.
 *
 * @param text the brief text
 * @param env the process environment, for the hatch
 * @param home the state home
 * @param repoRoot the repository root whose top level exempts a path
 * @param readEntries lists a directory's top-level names (defaults to the real filesystem)
 * @returns the offending tokens, empty when the brief roots everything it names
 */
export function unrootedBriefPathTokens({
  text,
  env,
  home,
  repoRoot,
  readEntries = entriesOf,
}: {
  text: string;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  repoRoot: string;
  readEntries?: (input: { dir: string }) => readonly string[];
}): readonly string[] {
  if (unrootedBriefPathAllowed({ already: false, env })) {
    return [];
  }
  return unrootedBriefPaths({
    repoEntries: readEntries({ dir: repoRoot }),
    stateEntries: readEntries({ dir: home }),
    text,
  });
}

/**
 * The refusal one door prints, or `undefined` when the brief roots everything it names.
 *
 * @param text the brief text — the chair's own words, never the whole doc (see {@link ./briefPaths.ts})
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @param home the state home (defaults to the resolved home)
 * @param repoRoot the repository root whose top level exempts a path
 * @param readEntries lists a directory's top-level names (defaults to the real filesystem)
 * @returns the four-line refusal plus its per-token corrections, or undefined
 */
export function unrootedBriefPathRefusal({
  text,
  command,
  env,
  home = slopweaverHome(),
  repoRoot,
  readEntries = entriesOf,
}: {
  text: string;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
  home?: string;
  repoRoot: string;
  readEntries?: (input: { dir: string }) => readonly string[];
}): string | undefined {
  const offenders = unrootedBriefPathTokens({ env, home, readEntries, repoRoot, text });
  if (offenders.length === 0) {
    return undefined;
  }
  const hatch = { ...hatchFor({ id: "unrooted-brief-path" }), command };
  const detail =
    `the brief names ${String(offenders.length)} path(s) relative to the state home, which a seat cannot root: ` +
    offenders.join(", ");
  const corrections = offenders.map((token) => briefPathCorrection({ home, token }));
  return [hatchRefusal({ detail, hatch }), "Write each one as:", ...corrections].join("\n");
}

/**
 * The same refusal for a handover DOC, which carries its brief inside its markdown.
 *
 * @param docText the doc's full markdown
 * @param command the door being refused
 * @param env the process environment, for the hatch
 * @param home the state home
 * @param repoRoot the repository root whose top level exempts a path
 * @param readEntries lists a directory's top-level names
 * @returns the refusal, or undefined
 */
export function unrootedDocBriefRefusal({
  docText,
  command,
  env,
  home,
  repoRoot,
  readEntries,
}: {
  docText: string;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
  home?: string;
  repoRoot: string;
  readEntries?: (input: { dir: string }) => readonly string[];
}): string | undefined {
  return unrootedBriefPathRefusal({
    command,
    env,
    ...(home === undefined ? {} : { home }),
    ...(readEntries === undefined ? {} : { readEntries }),
    repoRoot,
    text: briefText({ docText }),
  });
}
