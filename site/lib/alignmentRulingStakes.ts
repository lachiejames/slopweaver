/**
 * The Risk and Blast radius rows on an Alignment "make it a general ruling?" card: what making the ruling standing would
 * let the fleet do unasked, and what it would reach.
 *
 * A standing ruling made without seeing its risk or blast radius is the failure this answers: it lets the fleet go on
 * doing what the owner had not pictured. So every number, date and surface here is read off the rows the page already
 * holds — the autonomy ledger's acts of the kind, or the draft chains the owner sent back — and what those
 * rows cannot say, reversibility above all, is said to be unmeasured rather than called low. There is no table of kinds:
 * kinds are free-form strings, so the only wording of one is `kindWords`. Pure, so the unit lane holds it alone.
 */

import { kindWords, subjectLabel } from "./queueCard";
import { counted } from "./sidebarCountsBasis";

/** The two stakes rows a general-ruling card draws above the owner's quotes. */
export interface AlignmentRulingStakes {
  readonly risk: string;
  readonly blastRadius: string;
}

/** As much of a ledger act as its stakes read — `AutonomyRow` fits. */
export interface ActRulingStakesRow {
  readonly actionId: string;
  readonly doneIso: string;
  readonly kind: string;
  readonly subject: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * A day as `D Mon YYYY` in UTC, so every machine prints the same string for one instant.
 *
 * @returns the day
 */
function utcDayOf({ ms }: { ms: number }): string {
  const date = new Date(ms);
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear())}`;
}

/**
 * The window a set of instants spans, as words: "on <day>" for one day, else "from <day> to <day>".
 *
 * @param isos the instants, in any order; one that does not parse is left out
 * @returns the words, or `undefined` when no instant parses
 */
function windowOf({ isos }: { isos: readonly string[] }): string | undefined {
  const times = isos.map((iso) => Date.parse(iso)).filter((ms) => !Number.isNaN(ms));
  if (times.length === 0) {
    return undefined;
  }
  const oldest = utcDayOf({ ms: Math.min(...times) });
  const newest = utcDayOf({ ms: Math.max(...times) });
  if (oldest === newest) {
    return `on ${oldest}`;
  }
  return `from ${oldest} to ${newest}`;
}

/**
 * A GitHub pull request or issue as `subjectLabel` draws one, `owner/repo#number`. A subject recorded in that
 * shorthand already is GitHub's own cross-reference form, so it counts as GitHub too.
 */
const PULL_LABEL = /^([^/\s#]+\/[^/\s#]+)#\d+$/u;

/**
 * The stakes of making the owner's word on one kind of act standing, off every ledger row of that kind — not only the
 * steered ones that raised the question, since a standing ruling would cover them all.
 *
 * @param acts the whole ledger, as read; repeated copies of one act count once
 * @param kind the kind the question is about
 * @returns the Risk and Blast radius rows
 */
export function actRulingStakesOf({
  acts,
  kind,
}: {
  acts: readonly ActRulingStakesRow[];
  kind: string;
}): AlignmentRulingStakes {
  const byId = new Map<string, ActRulingStakesRow>();
  for (const act of acts) {
    if (act.kind === kind && !byId.has(act.actionId)) {
      byId.set(act.actionId, act);
    }
  }
  const rows = [...byId.values()];
  const words = kindWords({ kind });
  const actWords = counted({ count: rows.length, many: "acts", one: "act" });
  const window = windowOf({ isos: rows.map((row) => row.doneIso) });
  let recorded = `The ledger records ${actWords} of this kind`;
  if (window !== undefined) {
    recorded = `${recorded} ${window}`;
  }
  const risk = `Making this standing would let the fleet treat “${words}” as authorised unasked. ${recorded}; it does not measure reversibility.`;
  const labels = new Set(rows.map((row) => subjectLabel({ subject: row.subject })));
  const repositories = new Set<string>();
  let elsewhere = false;
  for (const label of labels) {
    const pull = PULL_LABEL.exec(label);
    if (pull === null) {
      elsewhere = true;
    } else {
      repositories.add(pull[1]);
    }
  }
  const repositoryWords = counted({
    count: repositories.size,
    many: "GitHub repositories",
    one: "GitHub repository",
  });
  const subjectWords = counted({ count: labels.size, many: "distinct subjects", one: "distinct subject" });
  let surfaces = "none reached Slack or another non-GitHub surface.";
  if (elsewhere) {
    surfaces = "Slack or another non-GitHub surface is also among them.";
  }
  const blastRadius = `It would reach everything this kind of act touches. The recorded ${rows.length === 1 ? "act spans" : "acts span"} ${repositoryWords} and ${subjectWords}; ${surfaces}`;
  return { blastRadius, risk };
}

/**
 * The stakes of holding every card to one class of feedback, off the distinct draft chains the owner sent back for it —
 * the chains `cardRulingCandidates` kept, one per re-cut chain, never the raw feedback rows.
 *
 * @param drafts one entry per draft chain the question is based on
 * @param subject the class as the page names it (`FEEDBACK_SUBJECT`)
 * @returns the Risk and Blast radius rows
 */
export function cardRulingStakesOf({
  drafts,
  subject,
}: {
  drafts: readonly { readonly atIso: string; readonly draftId: string }[];
  subject: string;
}): AlignmentRulingStakes {
  const chains = new Set(drafts.map((draft) => draft.draftId)).size;
  const chainWords = counted({ count: chains, many: "distinct draft chains", one: "distinct draft chain" });
  const window = windowOf({ isos: drafts.map((draft) => draft.atIso) });
  let based = `This question is based on ${chainWords} you sent back`;
  if (window !== undefined) {
    based = `${based} ${window}`;
  }
  return {
    blastRadius: `It would reach every card in that class, not only these. ${based}.`,
    risk: `Making this standing would let the fleet hold back, before it reaches you, every card it judges to be ${subject}, without asking on each one. The draft readings do not measure how often that judgement is wrong.`,
  };
}
