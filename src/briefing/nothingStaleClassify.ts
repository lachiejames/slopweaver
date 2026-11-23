/**
 * The "Nothing stale" classification: every row of the five surfaces placed in exactly one lane, every
 * document that could not be read named as a gap, and every document's stated bounds kept as a caveat.
 *
 * ## A gap is a HOLE, a caveat is a BOUND
 *
 * Three of the documents state what they can never see on every run: the landing read's `residue`, the cycle
 * report's two standing lines (`../cycle/types.ts`'s `CYCLE_STANDING_BOUNDS`), and the owed read's
 * `coverage.residue`, which its schema requires to be non-empty. Counting those as gaps would name every
 * surface as unseen on every morning, which is the same as naming none. So a bound is shown as a caveat, and a
 * surface is named as unseen only by a hole one particular read hit: a missing, stale or invalid document, an
 * `unread` pull request, a cycle line that is not one of its standing two, or an owed read that is not
 * `complete`.
 *
 * ## The fleet's work is never the owner's word
 *
 * A board finding still in today's document is one the chair has not applied, so it is STALE and the fleet's
 * to clear; only an `ORPHANED` row — a run the owner started that nobody holds — asks them, because only they can say
 * whether they still want it, and a decline they give carries their reason. A cycle proposal and a followed thread whose last word asks the owner a question are
 * the owner's word; a thread asking nothing is outside the rule, so it is not listed at all.
 *
 * ## Rule 10: nothing here acts
 *
 * Every item carries the evidence and, where it asks the owner, the closed reply vocabulary it is answered by. The
 * projection has no executor and no provider dependency; answering is a separate door, taken later, in a
 * visible session.
 *
 * Pure.
 */
import { CYCLE_STANDING_BOUNDS } from "../cycle/types.js";
import type { SlackOwedDocument } from "../live/slack/owedDocument.js";
import { linkRuns } from "./nothingStaleLink.js";
import { pullRequestSurface } from "./nothingStalePullRequests.js";
import type {
  CycleBriefingDocument,
  CycleProposalView,
  NothingStaleGap,
  NothingStaleInputs,
  NothingStaleItem,
  NothingStaleProjection,
  SweepBriefingCandidate,
} from "./nothingStaleTypes.js";

/** The reply words an `ORPHANED` board finding is answered by, per what acting on it would do. */
const BOARD_REPLIES: Readonly<Record<SweepBriefingCandidate["act"], readonly [string, string]>> = {
  close: ["close", "keep"],
  none: ["investigate", "keep"],
  settle: ["settle", "keep"],
};

/** Every reply word, as the line spells it: `a` / `b`. */
function replyWords({ words }: { readonly words: readonly string[] }): string {
  return words.map((word) => `\`${word}\``).join(" / ");
}

/**
 * One cycle proposal's line: the ticket or project, the producer's own one-word replies, its headline and
 * every piece of evidence, and a project update's draft.
 *
 * @param proposal the stored proposal
 * @returns the item
 */
function cycleItem({ proposal }: { readonly proposal: CycleProposalView }): NothingStaleItem {
  const project = proposal.action === "project-update";
  const named = proposal.title === undefined ? proposal.subject : `${proposal.subject} ${proposal.title}`;
  const evidence = proposal.evidence.map((piece) => piece.fact).join("; ");
  const draft = proposal.draft === undefined ? "" : ` Draft: ${proposal.draft}`;
  const text =
    ` — ${proposal.action}; reply ${replyWords({ words: proposal.oneWordReplies })}: ${proposal.headline}` +
    ` Evidence: ${evidence}.${draft}`;
  return {
    identity: `${project ? "linear-project" : "linear-ticket"}:${proposal.subject}`,
    lane: "needs-word",
    line: [...linkRuns({ text: named, url: proposal.url }), { kind: "text", text }],
    surface: project ? "linear-projects" : "linear-tickets",
  };
}

/** Every followed thread whose last word is somebody else's question to the owner, each asking them `reply`. */
function threadItems({ document }: { readonly document: SlackOwedDocument }): readonly NothingStaleItem[] {
  return document.threads
    .filter((thread) => thread.asksQuestion)
    .map((thread): NothingStaleItem => {
      const { channelId, channelName: where = channelId } = thread;
      const said = thread.lastText.length === 0 ? "" : `: "${thread.lastText}"`;
      const text =
        ` — reply \`reply\`: ${thread.audience}; their last word ${thread.lastWordAtIso}, yours ` +
        `${thread.ownerLastWordAtIso}${said}`;
      return {
        identity: `followed-thread:${thread.nativeId}`,
        lane: "needs-word",
        line: [
          ...linkRuns({ text: `${thread.lastAuthorName} in ${where}`, url: thread.permalink }),
          { kind: "text", text },
        ],
        surface: "followed-threads",
      };
    });
}

/**
 * One board finding: an `ORPHANED` row asks the owner the word its act would need; every other finding is the
 * fleet's, not yet applied, so it is stale.
 *
 * A `settle` act is a decline, and `sweep apply` takes one only with the owner's reason and the anchor to where they gave
 * it, so a bare `settle` is the owner's decision but not yet the whole of what the act needs — the line asks why too.
 *
 * @param candidate the stored finding
 * @returns the item
 */
function boardItem({ candidate }: { readonly candidate: SweepBriefingCandidate }): NothingStaleItem {
  const slug = { kind: "code" as const, text: candidate.slug };
  if (candidate.verdict === "ORPHANED") {
    const replies = replyWords({ words: BOARD_REPLIES[candidate.act] });
    const why = candidate.act === "settle" ? " (if settle, say why)" : "";
    return {
      identity: `board:${candidate.slug}`,
      lane: "needs-word",
      line: [slug, { kind: "text", text: ` — ORPHANED; reply ${replies}${why}: ${candidate.witness}` }],
      surface: "board",
    };
  }
  return {
    identity: `board:${candidate.slug}`,
    lane: "stale",
    line: [
      slug,
      { kind: "text", text: ` — ${candidate.verdict}, act \`${candidate.act}\` not applied: ${candidate.witness}` },
    ],
    surface: "board",
  };
}

/** The cycle report's lines that are NOT its standing bounds — the holes this one pass hit. */
function cycleHoles({ document }: { readonly document: CycleBriefingDocument }): readonly string[] {
  return document.couldNotSee.filter((line) => !CYCLE_STANDING_BOUNDS.includes(line));
}

/** What one surface's read contributed: its items, the holes it hit, and the bounds it states. */
interface SurfaceRead {
  readonly items: readonly NothingStaleItem[];
  readonly gaps: readonly { readonly gap: NothingStaleGap; readonly reasons: readonly string[] }[];
  readonly caveats: readonly (readonly [string, readonly string[]])[];
}

/** A surface whose document could not be used at all: every gap it covers carries the one reason. */
function unseenRead({
  gaps,
  reason,
}: {
  readonly gaps: readonly NothingStaleGap[];
  readonly reason: string;
}): SurfaceRead {
  return { caveats: [], gaps: gaps.map((gap) => ({ gap, reasons: [reason] })), items: [] };
}

/** The pull-request surface: its rows, its undecided rows as holes, and the landing read's residue. */
function pullRequestRead({
  input,
  runs,
}: {
  readonly input: NothingStaleInputs["pullRequests"];
  readonly runs: NothingStaleInputs["runs"];
}): SurfaceRead {
  if (input.kind !== "available") {
    return unseenRead({ gaps: ["pull-requests"], reason: input.reason });
  }
  const landing = input.value.document;
  const surface = pullRequestSurface({ document: landing, publishedIso: input.value.observedAtIso, runs });
  return {
    caveats: [["pull requests", [...landing.residue, ...surface.bounds]]],
    gaps: [{ gap: "pull-requests", reasons: surface.unseen }],
    items: surface.items,
  };
}

/** Both Linear surfaces: every proposal, every non-standing line as a hole in each, the standing two as bounds. */
function linearRead({ input }: { readonly input: NothingStaleInputs["linearCycle"] }): SurfaceRead {
  if (input.kind !== "available") {
    return unseenRead({ gaps: ["linear-tickets", "linear-projects"], reason: input.reason });
  }
  const cycle = input.value.document;
  const holes = cycleHoles({ document: cycle });
  return {
    caveats: [["Linear", cycle.couldNotSee.filter((line) => CYCLE_STANDING_BOUNDS.includes(line))]],
    gaps: [
      { gap: "linear-tickets", reasons: holes },
      { gap: "linear-projects", reasons: holes },
    ],
    items: cycle.proposals.map((proposal) => cycleItem({ proposal })),
  };
}

/** The followed threads: rows unless the read was unavailable, bounds when complete, a hole when not. */
function followedThreadRead({ input }: { readonly input: NothingStaleInputs["followedThreads"] }): SurfaceRead {
  if (input.kind !== "available") {
    return unseenRead({ gaps: ["followed-threads"], reason: input.reason });
  }
  const owed = input.value.document;
  const items = owed.status === "unavailable" ? [] : threadItems({ document: owed });
  if (owed.status === "complete") {
    return { caveats: [["followed threads", owed.coverage.residue]], gaps: [], items };
  }
  const reasons = [`the read was ${owed.status}`, ...owed.coverage.residue];
  return { caveats: [], gaps: [{ gap: "followed-threads", reasons }], items };
}

/** The board: every finding, or a hole naming why the findings could not be read. */
function boardRead({ input }: { readonly input: NothingStaleInputs["board"] }): SurfaceRead {
  if (input.kind !== "available") {
    return unseenRead({ gaps: ["board"], reason: input.reason });
  }
  return { caveats: [], gaps: [], items: input.value.document.map((candidate) => boardItem({ candidate })) };
}

/**
 * Every gap that carries at least one reason, reasons joined per gap, in the order the reads named them.
 *
 * @param reads each surface's contribution, in section order
 * @returns the gap register
 */
function gapRegister({ reads }: { readonly reads: readonly SurfaceRead[] }): Map<NothingStaleGap, readonly string[]> {
  const register = new Map<NothingStaleGap, readonly string[]>();
  reads
    .flatMap((read) => read.gaps)
    .filter((entry) => entry.reasons.length > 0)
    .forEach(({ gap, reasons }) => {
      const held = register.get(gap);
      if (held === undefined) {
        register.set(gap, reasons);
        return;
      }
      register.set(gap, [...held, ...reasons]);
    });
  return register;
}

/**
 * Classify every current document the section reads.
 *
 * @param inputs each document already resolved to a current document or a named gap
 * @returns every item, every gap with its reasons, every caveat, and the board's unproven count
 */
export function classifyNothingStale({ inputs }: { readonly inputs: NothingStaleInputs }): NothingStaleProjection {
  const census = inputs.boardCensus;
  const censusRead: SurfaceRead =
    census.kind === "available"
      ? { caveats: [], gaps: [], items: [] }
      : unseenRead({ gaps: ["board-unproven"], reason: census.reason });
  const reads = [
    pullRequestRead({ input: inputs.pullRequests, runs: inputs.runs }),
    linearRead({ input: inputs.linearCycle }),
    followedThreadRead({ input: inputs.followedThreads }),
    boardRead({ input: inputs.board }),
    censusRead,
  ];
  const caveats = new Map(reads.flatMap((read) => read.caveats).filter(([, lines]) => lines.length > 0));
  return {
    caveats,
    couldNotSee: gapRegister({ reads }),
    items: reads.flatMap((read) => read.items),
    unproven: census.kind === "available" ? census.value.document.census.UNWITNESSED : undefined,
  };
}
