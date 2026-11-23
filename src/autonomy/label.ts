/**
 * The short human labels a reader of this register sees. Pure: strings in, strings out.
 *
 * Every one of these is DERIVED from a stored field rather than stored beside it, which is `./types.ts`'s
 * call: a stored label is a second thing to get wrong and a place for a row to describe a pull request it
 * does not point at. A derived one can only be wrong by the row pointing at the wrong subject, which is a
 * defect a reader can see by following the link.
 *
 * They live here rather than in `../briefing/autonomy.ts` because two readers need the same words —
 * `slopweaver autonomy list` and the Fleet Briefing section — and a row the owner is steering by what it SAYS must
 * say the same thing in both places.
 *
 * Nothing here ever truncates with an ellipsis. `../briefing/pageBudget.ts` refuses a page carrying one, because
 * a cut-off line is a line the owner has to go and open something to finish reading.
 * Where a label would be long, these functions pick a SHORTER TRUE thing instead — the workspace rather than
 * the whole session string — and the full value stays in the fold.
 */

import { AUTONOMY_SESSION_LABEL_MAX_CHARS, AUTONOMY_SUBJECT_LABEL_MAX_CHARS } from "../briefing/caps.js";

import { classifyAutonomySubject } from "./subject.js";

/** The `workspace:<n>` prefix a cmux session's name starts with, which is the half the owner recognises. */
const WORKSPACE_PREFIX = /^workspace:\d+/;

/**
 * The short human label for a subject.
 *
 * A GitHub pull request or issue becomes `owner/repo#number`, a Slack permalink its channel and message id;
 * any other URL falls back to the host and path, which is still something the owner recognises. It never returns a
 * bare `#<number>`: `../briefing/bareRef.ts` refuses a bare reference on the page, and a label carrying its
 * repository is what the owner can read without opening the link anyway.
 *
 * A board slug is its own label and a `state:` reference is its file's name, because both are already short
 * and specific.
 *
 * **Every arm falls back to a truthful KIND rather than a cut-off name**, and the URL arm's fallback is the
 * load-bearing one. `../outbound/briefing/autonomySchema.ts` caps `subjectLabel` and the schema REFUSES the
 * whole form when it is over — so a single act recorded against a long URL would take the owner's entire
 * briefing off the page rather than render one awkward row (a 129-character URL derives a label of 121 against
 * a cap of 120). Nothing is lost by falling back: the full subject
 * renders inside the fold either way, and this file never truncates (see the overview).
 *
 * @param subject the row's subject, in any of `./subject.ts`'s three forms
 * @returns a short label for the row's visible line, never longer than the page's own bound
 */
export function autonomySubjectLabel({ subject }: { subject: string }): string {
  const classified = classifyAutonomySubject({ subject });
  if (classified === undefined) {
    return subject;
  }
  if (classified.kind === "board") {
    return withinCap({ candidate: classified.value, fallback: "board row", max: AUTONOMY_SUBJECT_LABEL_MAX_CHARS });
  }
  if (classified.kind === "state") {
    // `split` always yields at least one segment, so the last one is always there.
    const name = classified.relativePath.split("/").at(-1)!;
    return withinCap({ candidate: name, fallback: "local record", max: AUTONOMY_SUBJECT_LABEL_MAX_CHARS });
  }
  return withinCap({
    candidate: urlLabel({ url: classified.value }),
    fallback: "a link",
    max: AUTONOMY_SUBJECT_LABEL_MAX_CHARS,
  });
}

/**
 * The candidate when the page will actually carry it, otherwise a truthful word for what it names.
 *
 * Two rules, and the second is not about length at all: the form refuses any run ENDING in an ellipsis,
 * because on this page that shape means something was cut off. A subject can produce one honestly — a file
 * really called `notes...` derives the label `notes...`, eight characters and well inside the cap — and the
 * form would then refuse the whole page over a row that truncated nothing. So the same fallback covers it: a label the page cannot carry becomes the kind of thing it names.
 */
function withinCap({ candidate, fallback, max }: { candidate: string; fallback: string; max: number }): string {
  if (candidate.length > max) {
    return fallback;
  }
  return candidate.endsWith("...") || candidate.endsWith("…") ? fallback : candidate;
}

/** The best short name for a URL: its GitHub or Slack shape, otherwise its host and path. */
function urlLabel({ url }: { url: string }): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const github = githubLabel({ host: parsed.host, segments });
  if (github !== undefined) {
    return github;
  }
  const slack = slackLabel({ host: parsed.host, segments });
  if (slack !== undefined) {
    return slack;
  }
  return `${parsed.host}${parsed.pathname}`;
}

/** `owner/repo#number` for a GitHub pull request or issue URL, or undefined when it is neither. */
function githubLabel({ host, segments }: { host: string; segments: readonly string[] }): string | undefined {
  const [owner, repo, kind, number] = segments;
  const shaped =
    host === "github.com" &&
    owner !== undefined &&
    repo !== undefined &&
    (kind === "pull" || kind === "issues") &&
    number !== undefined;
  if (!shaped) {
    return undefined;
  }
  return `${owner}/${repo}#${number}`;
}

/** `slack <channel> <message>` for a Slack permalink, or undefined when the URL is not one. */
function slackLabel({ host, segments }: { host: string; segments: readonly string[] }): string | undefined {
  const [archives, channel, message] = segments;
  if (!host.endsWith(".slack.com") || archives !== "archives" || channel === undefined || message === undefined) {
    return undefined;
  }
  return `slack ${channel} ${message}`;
}

/**
 * The readable form of an action kind.
 *
 * Hyphens and dots become spaces and nothing else happens — no lookup table, no title casing. That is the
 * whole point:
 * `kind` is an OPEN vocabulary (`./types.ts`), so an unknown kind must render as well as a known one, and a
 * table would quietly make the newest act the worst-looking row on the page. `press-merge-when-ready-refused`
 * reads correctly as "press merge when ready refused" and keeps its own honesty about having been refused.
 *
 * @param kind the row's kind slug
 * @returns the slug with its hyphens replaced by spaces
 */
export function autonomyKindLabel({ kind }: { kind: string }): string {
  return kind.replaceAll(/[-.]/gu, " ");
}

/**
 * The short form of a session name — what appears on the one line the owner reads.
 *
 * A real `bySession` is the workspace, the run slug and the session uuid together, which is the right thing
 * to keep on the row and the wrong thing to put in a line the owner scans. When the name opens with a
 * `workspace:<n>`, that prefix IS the label, because it is what the owner types to go and look. Otherwise the whole
 * name stands: a session that named itself briefly has nothing to shorten.
 *
 * **And it is capped like every other label here**, for {@link autonomySubjectLabel}'s reason: the register
 * lets `bySession` run to `AUTONOMY_SESSION_MAX` characters and the form caps `sessionLabel` at
 * {@link AUTONOMY_SESSION_LABEL_MAX_CHARS}, so a single act recorded by a long-named session would take the
 * owner's whole briefing off the page rather than rendering one awkward row (a 121-character name against a
 * cap of 120). "a session" is the truthful fallback, the same shape as "a link".
 *
 * The full name is never lost — `../briefing/autonomy.ts` renders it inside the fold.
 *
 * @param bySession the row's full session name
 * @returns the workspace prefix when there is one, otherwise the name, or a truthful word when neither fits
 */
export function autonomySessionLabel({ bySession }: { bySession: string }): string {
  const workspace = WORKSPACE_PREFIX.exec(bySession);
  // A session started outside a cmux workspace has no `workspace:<n>` prefix, so its whole name is the label.
  const candidate = workspace === null ? bySession : workspace[0];
  return withinCap({ candidate, fallback: "a session", max: AUTONOMY_SESSION_LABEL_MAX_CHARS });
}
