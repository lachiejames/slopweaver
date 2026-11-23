/**
 * Qualifying an act's bare GitHub references — a bare `#<number>` written as `owner/repo#<number>` — the pure half
 * shared by the one door that writes an act from text a session did not compose for the owner, and the one verb that
 * repairs an act already stored.
 *
 * The failure it closes: the internal finding door (`../cli/commands/github/findingRulingGate.ts`) writes an act
 * whose `why` embeds its board row's evidence verbatim, a qualified reference to one pull request beside a bare
 * reference to another. `autonomy record` refuses that act at its door (`./autonomyActRefs.ts`); the finding door
 * appends through the port with no such pass, and `briefing check` then refuses every chair page, because the
 * page links more than one repository and no bare reference resolves on it.
 *
 * ## Which references, and against what
 *
 * Only a GitHub reference spelled WITHOUT its repository (a bare `#<number>`, or a PR-list digit) is rewritten, and only when
 * the context resolves it to exactly one repository with `../outbound/linkify/bareRefs.ts`'s own `resolveBareRef`
 * — the same resolver every outbound door links with, magnitude rule included. Anything it does not resolve is
 * left as written, so a caller re-runs the briefing's own check over the result rather than trusting this pass:
 * {@link qualifyActProse} does that, and refuses whatever still renders as text.
 *
 * Only `why` and `said` are touched. They are the act's PROSE on the page; the subject is an identifier, the
 * witness renders as `<code>` (which the check never reads), and a steer is the owner's word, which nothing rewrites.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type AutonomyError } from "../autonomy/errors.js";
import type { AutonomyActionRow } from "../autonomy/types.js";
import { renderAutonomy } from "../outbound/briefing/autonomyRender.js";
import { type BareRefContext, resolveBareRef, scanBareRefs } from "../outbound/linkify/bareRefs.js";
import { projectAutonomyRow } from "./autonomy.js";
import { bareReferenceErrors } from "./autonomyActRefs.js";
import { bareRefContextOfPage } from "./bareRef.js";

/** The repository and number a resolved bare reference's URL names. */
const RESOLVED_ISSUE_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/u;

/** One prose field with its bare GitHub references qualified, and the references that were rewritten. */
export interface QualifiedText {
  readonly text: string;
  /** Each rewritten reference as written before and after, in text order. */
  readonly rewrites: readonly { readonly from: string; readonly to: string }[];
}

/**
 * One prose field with every bare GitHub reference the context resolves to exactly one repository written as
 * `owner/repo#N`. A reference already naming its repository, a Linear key, a control id and an unresolved bare
 * reference are all left byte for byte.
 *
 * @param text the prose to qualify
 * @param context what the references resolve against — the act's own links, or a repository a caller named
 * @returns the qualified text, and what was rewritten
 */
export function qualifyGithubRefs({ text, context }: { text: string; context: BareRefContext }): QualifiedText {
  const rewrites: { from: string; to: string; start: number; end: number }[] = [];
  for (const span of scanBareRefs({ context, text })) {
    if (span.kind !== "githubRef" || span.owner !== undefined) {
      continue;
    }
    const resolved = resolveBareRef({ context, span });
    const named = resolved === undefined ? null : RESOLVED_ISSUE_URL.exec(resolved.url);
    if (named === null) {
      continue;
    }
    const [, owner, repo, number] = named;
    rewrites.push({ end: span.end, from: span.raw, start: span.start, to: `${owner!}/${repo!}#${number!}` });
  }
  let qualified = text;
  // From the last reference back, so every earlier one's offsets still hold.
  for (const rewrite of rewrites.toReversed()) {
    qualified = `${qualified.slice(0, rewrite.start)}${rewrite.to}${qualified.slice(rewrite.end)}`;
  }
  return { rewrites: rewrites.map(({ from, to }) => ({ from, to })), text: qualified };
}

/** An act with its prose qualified: the revised act, and every field that changed with what it held before. */
export interface QualifiedAct {
  readonly action: AutonomyActionRow;
  /** Each prose field that changed, with its value before this pass. Empty when nothing was bare. */
  readonly changed: readonly { readonly field: "why" | "said"; readonly original: string }[];
}

/**
 * An act's `why` and `said` with their bare GitHub references qualified, refused when any reference still renders
 * on the briefing as plain text afterwards — the briefing's own check decides, never this pass.
 *
 * @param action the act as built or as stored
 * @param context what the references resolve against
 * @returns the revised act and what changed, or the `BARE_REFERENCE` refusal naming the first residue
 */
export function qualifyActProse({
  action,
  context,
}: {
  action: AutonomyActionRow;
  context: BareRefContext;
}): Result<QualifiedAct, AutonomyError> {
  const why = qualifyGithubRefs({ context, text: action.why });
  const said = action.said === undefined ? undefined : qualifyGithubRefs({ context, text: action.said });
  const changed: { field: "why" | "said"; original: string }[] = [];
  if (why.text !== action.why) {
    changed.push({ field: "why", original: action.why });
  }
  let revised: AutonomyActionRow = { ...action, why: why.text };
  if (said !== undefined && said.text !== action.said) {
    changed.push({ field: "said", original: action.said! });
    revised = { ...revised, said: said.text };
  }
  // Judged with no steer folded on, exactly as `autonomy record` judges an act: a steer is the owner's word, judged on
  // its own when it was written, and not this pass's to rewrite.
  const residue = bareReferenceErrors({
    entry: {
      action: withoutSteer({ action: revised }),
      classSteer: undefined,
      latestSteer: undefined,
      patternSteer: undefined,
    },
  });
  if (residue.length > 0) {
    return err(residue[0]!);
  }
  return ok({ action: revised, changed });
}

/** The act without any steer it carries inline. */
function withoutSteer({ action }: { action: AutonomyActionRow }): AutonomyActionRow {
  const copy: { -readonly [K in keyof AutonomyActionRow]: AutonomyActionRow[K] } = { ...action };
  delete copy.steer;
  return copy;
}

/**
 * What the act's OWN rendered links resolve a bare reference against — the context `autonomy record`'s check
 * would credit if the act stood alone on a page. A writer that has no repository named for it uses this, so the
 * repository written down is one the act itself already links, never a guess.
 *
 * @param action the act as it would be written
 * @returns the context its own render supplies
 */
export function actOwnContext({ action }: { action: AutonomyActionRow }): BareRefContext {
  const row = projectAutonomyRow({
    entry: { action: withoutSteer({ action }), classSteer: undefined, latestSteer: undefined, patternSteer: undefined },
  });
  return bareRefContextOfPage({ html: renderAutonomy({ autonomy: { notShown: 0, rows: [row] } }).join("\n") });
}
