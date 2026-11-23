/**
 * The writer end of the relative-path gate: a BRIEF may not name a file by a path that is relative to the state home.
 *
 * ## The incident, and why this is a gate rather than a convention
 *
 * A docs seat was given a row whose `summary:` read *"image in supervisor-scratch/<handoff>/<images>"*. Nothing
 * in that sentence says what the path
 * is relative to. It is not in the repository, the seat had no other root to try, and so the seat went and
 * looked for it — a breadth-first scan from `/`, three cores for eleven minutes. The chair typed one
 * relative path and the seat paid for it, which is the whole class: **a seat never scans the disk for a
 * path the chair named.**
 *
 * So a brief names such a file ABSOLUTELY, or with the `state:` prefix `../autonomy/subject.ts` already
 * declares for exactly this purpose. Anything else is refused at the two doors that write a brief —
 * `slopweaver handover register` and `slopweaver cmux spawn`.
 *
 * ## The criterion: a two-set DIFFERENCE, so there is no list to drift
 *
 * A token is refused when its first path segment is a top-level entry of the state home and is NOT a
 * top-level entry of the repository. Both sets are read at the moment the gate runs, so nothing here is a
 * hand-maintained allowlist. The difference is load-bearing rather than tidy: five names are in both sets
 * on this install — `.claude`, `.git`, `.gitignore`, `bin`, `eval` — and `bin/slopweaver` is named in
 * dozens of briefs. Reproduce the overlap:
 *
 * ```bash
 * comm -12 <(ls -A "$SLOPWEAVER_HOME" | sort) <(ls -A . | sort)
 * ```
 *
 * A repo-relative path written without its root (`live/automation/plan.ts` for `src/live/automation/plan.ts`) is
 * refused too, and that is correct rather than collateral: it does not resolve from the repository root
 * either, so the seat still has to guess. Rooting it makes the first segment `src`, which is repo-only, so
 * the refusal resolves itself.
 *
 * ## Two things this module does differently from {@link ../cmux/baseFreshness.ts}, both measured
 *
 * **It reads PLAIN PROSE, not only backticked tokens.** `docReferencedPaths` reads only `` `backticks` ``,
 * and the incident's token is not backticked — it is bare prose with a trailing `)`. A scanner modelled on
 * that one would have let the incident through. Measured over the 2661 docs in `$SLOPWEAVER_HOME/handovers`:
 * a backticks-only scanner of the brief finds **6**, and the prose-aware scanner below finds **446 (17%)**.
 * Set membership on the first segment is what keeps prose safe — `and/or`, `24/7` and `9/21` cannot collide
 * with a state-home directory name, so no word list is needed.
 *
 * **It reads the BRIEF, not the whole doc.** The same criterion over a whole doc body refuses 148 docs
 * against 6 on the identical scanner, and the extra class is not the defect: `live/turn` appears repeatedly
 * as a quoted string FRAGMENT under discussion (a doc reasoning about a prefix matcher), which is a pattern
 * and not a file to open. The brief is what the CHAIR wrote — the front matter plus the owner's-request section.
 * The rest of the doc is what an implementing session adds later, in a checkout, where a relative path
 * resolves.
 *
 * ## Residue, stated rather than discovered
 *
 * The gate's strength is install-dependent: it reads the state home's own top level, so on a fresh install
 * with an empty state home the set is empty and the gate is a no-op. That is correct — there is nothing to
 * be relative to — but no test can assert otherwise. And this is forward-only by construction: the 446
 * briefs already on disk are not touched by it.
 */

/**
 * The prefix a brief uses to name a file under the state home. Shared with `../autonomy/subject.ts`.
 *
 * @internal — the legal spelling this module both exempts and recommends; callers read the refusal.
 */
export const STATE_BRIEF_PREFIX = "state:";

/** The ambient hatch this gate is opened with — declared as `unrooted-brief-path` in `../hatch/registry.ts`. */
export const UNROOTED_BRIEF_PATH_HATCH = "SLOPWEAVER_ALLOW_UNROOTED_BRIEF_PATH";

/** Characters stripped off the FRONT of a prose token before it is read as a path. */
const LEADING_NOISE = /^[`"'([{<*_,;:]+/u;

/** Characters stripped off the END of a prose token — a trailing `)` is what the incident's token carried. */
const TRAILING_NOISE = /[`"'()[\]{}>*_.,;:!?]+$/u;

/**
 * Whether one already-trimmed token reads as a path that needs a root.
 *
 * An absolute path, a `~`-relative one, a `./` or `../` one and a URL all say where they start, so none of
 * them is this gate's business; a leading `-` is a flag; a token with no `/` at all is a word, a slug or an
 * identifier, and refusing every hyphenated word in a brief would refuse every board slug. A leading dot is
 * NOT itself disqualifying — `.cache/linear-probe/` is a real state-home path a brief has named.
 *
 * @param token the token, already stripped of surrounding punctuation
 * @returns true when the token is a relative, rootless path
 */
function isRootlessPath({ token }: { token: string }): boolean {
  if (token.length === 0 || !token.includes("/")) {
    return false;
  }
  if (token.startsWith("/") || token.startsWith("~") || token.startsWith("-")) {
    return false;
  }
  if (token.startsWith("./") || token.startsWith("../")) {
    return false;
  }
  return !token.includes("://") && !token.startsWith(STATE_BRIEF_PREFIX);
}

/**
 * Every prose token in a text, stripped of the punctuation that surrounds a path written into a sentence.
 *
 * @internal — {@link unrootedBriefPaths} is this module's public surface; this is its first step.
 * @param text the brief, as the chair wrote it
 * @returns each whitespace-separated token with its surrounding noise removed, in order
 */
export function briefTokens({ text }: { text: string }): readonly string[] {
  return text.split(/\s+/u).map((raw) => raw.replace(LEADING_NOISE, "").replace(TRAILING_NOISE, ""));
}

/**
 * The chair's own words out of a handover doc: the front matter and the owner's-request section.
 *
 * Deliberately NOT the whole doc — see this module's header for the measurement behind that seam.
 *
 * @param docText the doc's full markdown
 * @returns the brief text, empty when the doc carries neither part
 */
export function briefText({ docText }: { docText: string }): string {
  const parts: string[] = [];
  const frontMatter = /^---\n([\s\S]*?)\n---/u.exec(docText);
  if (frontMatter !== null) {
    parts.push(frontMatter[1]!); // group 1 exists whenever the pattern matched
  }
  const asked = askedSection({ docText });
  if (asked !== undefined) {
    parts.push(asked);
  }
  return parts.join("\n");
}

/** The heading over the owner's-request section, as `handover register` writes it. */
export const ASK_HEADING = "## What the owner asked for";

/**
 * The text under the first owner's-request heading below the doc's first line, up to the next `## ` heading or the end.
 *
 * @param docText the doc's full markdown
 * @returns the section's text after its heading line, undefined when the doc carries no such heading
 */
function askedSection({ docText }: { docText: string }): string | undefined {
  const lines = docText.split("\n");
  const headingAt = lines.findIndex((line, index) => index > 0 && line === ASK_HEADING);
  if (headingAt === -1) {
    return undefined;
  }
  const after = lines.slice(headingAt + 1);
  const nextHeading = after.findIndex((line) => line.startsWith("## "));
  return (nextHeading === -1 ? after : after.slice(0, nextHeading)).join("\n");
}

/**
 * Every state-home-relative path a brief names, in the order it names them, each reported once.
 *
 * @param text the brief text (see {@link briefText})
 * @param stateEntries the state home's top-level entry names
 * @param repoEntries the repository root's top-level entry names
 * @returns the offending tokens, empty when the brief roots everything it names
 */
export function unrootedBriefPaths({
  text,
  stateEntries,
  repoEntries,
}: {
  text: string;
  stateEntries: readonly string[];
  repoEntries: readonly string[];
}): readonly string[] {
  const state = new Set(stateEntries);
  const repo = new Set(repoEntries);
  const seen = new Set<string>();
  const found: string[] = [];
  for (const token of briefTokens({ text })) {
    if (!isRootlessPath({ token }) || seen.has(token)) {
      continue;
    }
    const first = token.slice(0, token.indexOf("/"));
    if (state.has(first) && !repo.has(first)) {
      seen.add(token);
      found.push(token);
    }
  }
  return found;
}

/**
 * How one offending token should have been written, as the refusal prints it.
 *
 * Both forms, because which one is right depends on what the chair meant and the gate cannot know: the
 * `state:` form is shorter and survives a machine move, the absolute form is what a seat can paste
 * straight into a command.
 *
 * @param token the offending token
 * @param home the resolved state home
 * @returns the one-line correction for this token
 */
export function briefPathCorrection({ token, home }: { token: string; home: string }): string {
  return `  ${token} → ${STATE_BRIEF_PREFIX}${token}   (or absolutely: ${home}/${token})`;
}
