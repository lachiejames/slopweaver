/**
 * One act card off the autonomy ledger, and that card again once its by-branch pull-request lookup has answered: a
 * finding act is refused until the lookup has read its one pull request, every other act is drawn. Split from
 * `./queueRows.ts`, which folds every register into one list, so that file stays under the 300-line cap.
 */

import type { AutonomyRow } from "../components/live/readAutonomy";
import type { ActGroup, ActReads } from "./actGroups";
import { lookupNoticeOf } from "./actLookupNotice";
import { actHint, patternActCard, withPatternSubjects } from "./actPatternCard";
import type { ActPullState } from "./actPullVerb";
import { type BriefingCardBasis, briefingCardForm, type QueueCardForm } from "./briefingCardForm";
import { withBriefingPages } from "./cardBriefingPages";
import { findingActCard } from "./findingActCard";
import { withMachineIdForm } from "./machineIdForm";
import { queueProvenanceOf } from "./provenance";
import { type BriefingCard, subjectLabel } from "./queueCard";
import { actCard, actPullRequests, type CardLink } from "./queueCardAct";
import { type ActLinks, actLinks } from "./queueCardActLinks";
import { actGroupSource, sourceForm } from "./queueCardSource";
import { firstRefusal, heldOf } from "./queueRowFields";
import type { QueueRow } from "./queueRows";
import type { QueueTags } from "./queueTagsInherited";
import type { ReasonWords } from "./quotedReason";
import { waitingTierOf } from "./waitingRank";

/**
 * One act card: the newest act of one kind on one subject, with the earlier ones folded beneath it.
 *
 * The ONE builder behind a check-in card and a card a standing rule settled (`./standingRules.ts`), so the settled
 * tally is filtered by exactly the hint and tags the check-in it replaced would have carried.
 *
 * @param group the acts the card stands for
 * @param reads the board and landing reads its links go through
 * @param queueKeys every other queue row's key, which its links may point at
 * @param observedAtIso when the ledger was read
 * @returns the card, before its tags are read off the board
 */
export function actRowOf({
  group,
  reads,
  queueKeys,
  observedAtIso,
}: {
  group: ActGroup;
  reads: ActReads;
  queueKeys: ReadonlySet<string>;
  observedAtIso: string;
}): Omit<QueueRow, keyof QueueTags> {
  const { act, earlier, subjects } = group;
  // The hint is what the queue's filter reads, and it takes the card's `whole` rather than the raw
  // `why`: the act's plain-words line is the half the owner would actually type to find the row again, and it
  // only exists once the card has composed the two accounts.
  const pulls = actPullRequests({ act, rows: reads.openPulls });
  // The landing reading is the owner's OPEN, undrafted pull requests and may be bounded, so a match in it proves
  // the pull request is the act's but never that it is the only one. It LINKS; only a subject that IS the
  // pull request's address makes the card about it here — and never a finding's, which only the by-branch
  // lookup names, because it alone reads every pull request its branch opened.
  let named = pulls.filter((pull) => pull.url === act.subject);
  if (act.kind === FINDING_ACT_KIND) {
    named = [];
  }
  const card = patternActCard({ card: actCard({ act, pulls: named }), kind: act.kind, subjects });
  // A by-branch lookup reads one branch, so it speaks for one subject: the newest act's, which governs the group.
  // Every finding act shares one constant plain-words line (`src/cli/commands/github/findingRulingGate.ts`), so a
  // pattern of them drawn from that line alone says nothing the owner could judge, on a 64-subject card. So a pattern looks its newest act's pull request up too, and `withLookedUpPull` names that
  // pull request as the newest (`./actPatternCard.ts`) rather than letting it pass for the rest.
  const forms: QueueCardForm[] = [
    actCardFormBefore({ act }),
    briefingCardForm({ basis: actBasis({ act, pulls: named }), card }),
  ];
  const lookupBranch = actPullLookupBranch({ act });
  const source = actGroupSource({ act, earlier, rows: reads.boardRows });
  forms.unshift(sourceForm({ source }));
  const placement = reads.placed({ act });
  return {
    aliases: earlier.map((was) => `act:${was.actionId}`),
    card,
    hint: actHint({ card, subjects }),
    id: act.actionId,
    key: `act:${act.actionId}`,
    kind: "act",
    pill: act.kind,
    placement,
    provenance: queueProvenanceOf({ placement }),
    record: {
      act,
      earlier,
      kind: "act",
      links: withPatternSubjects({
        links: actLinks({ act, board: reads.board, landing: reads.landing, pulls, queueKeys }),
        subjects,
      }),
      subjects,
      form: firstRefusal({ forms }),
      lookupBranch,
    },
    source,
    threadUrl: undefined,
    tier: waitingTierOf({ checkIn: true, teamFacing: false }),
    verifiedBy: "the autonomy ledger read",
    currencyFloorIso: undefined,
    verifiedIso: observedAtIso,
    whenIso: act.doneIso,
  };
}

/**
 * Whether an address may be anywhere on GitHub. It is resolved the way the console's own page resolves a link,
 * from an `http:` page and from an `https:` one, since a scheme with no slashes (`https:github.com/…`) resolves
 * differently from each, and it counts if EITHER lands on GitHub. So a queue chip's relative path does not count
 * and a protocol-relative `//github.com/…` does. The URL parser lowercases the host and a fully qualified name's
 * trailing dot is dropped, so `GITHUB.COM` and `github.com.` count. The test is deliberately the whole host and
 * never a pull request's path: a `.patch`, `/files` or `?diff=` address is a pull request as much as its bare
 * one, and no list of spellings is ever complete. An address that will not parse counts, because counting one
 * only ever takes the card OFF a title.
 */
function isGithubAddress({ url }: { url: string }): boolean {
  return ["http://console.invalid/", "https://console.invalid/"].some((base) => {
    if (!URL.canParse(url, base)) {
      return true;
    }
    const hostname = new URL(url, base).hostname.replace(/\.$/u, "");
    return hostname === "github.com" || hostname.endsWith(".github.com");
  });
}

/** The ledger kind the finding gate records when it opens a pull request on this install's own repository. */
export const FINDING_ACT_KIND = "open-internal-finding-pull-request";

/**
 * The branch a finding act's card looks its pull request up by, or `undefined` when there is nothing to look up.
 *
 * The landing join ({@link actPullRequests}) reads only OPEN, undrafted pull requests, and a finding lands
 * fast: MEASURED, two finding pull requests had both merged before the owner opened their cards. So every finding act
 * names the branch its seat opened one from — the board row it records as `run`, else its slug `subject` —
 * and the card asks GitHub by that name when it opens (`./actPullVerb.ts`), across every state, which is the
 * one read that can say a pull request is the ONLY one from that branch. Any other act looks nothing up.
 *
 * @param act the ledger row
 * @returns the branch, or `undefined`
 */
export function actPullLookupBranch({
  act,
}: {
  act: Pick<AutonomyRow, "kind" | "run" | "subject">;
}): string | undefined {
  if (act.kind !== FINDING_ACT_KIND) {
    return undefined;
  }
  if (act.run !== undefined && act.run !== "") {
    return act.run;
  }
  if (act.subject === "" || act.subject.startsWith("https://")) {
    return undefined;
  }
  return act.subject;
}

/**
 * Whether an act's panel may draw the card body, or the one sentence it draws instead.
 *
 * A card the verb cannot fill with the real pull request is refused by the form, not rendered with boilerplate. So
 * a finding act is `refused` until its lookup has READ its one pull request and that pull request's description
 * gave its Problem, Risk and Blast radius ({@link withLookedUpPull}); the panel then draws the reason, the links
 * and the steer controls, and no problem or stakes row at all. Every other act is `drawn`.
 */
export type ActCardForm = QueueCardForm;

/**
 * What an act's ledger row holds for its card: a `what` only when it carries a plain-words line or a pull request
 * proven its own whose title says something, and never a problem, stakes or lean — the ledger records none of them.
 *
 * @param act the ledger row
 * @param pulls the pull requests the card was built about
 * @returns the basis
 */
function actBasis({
  act,
  pulls,
}: {
  act: Pick<AutonomyRow, "said">;
  pulls: readonly { readonly title: string }[];
}): BriefingCardBasis {
  let what = heldOf({ value: act.said });
  const only = pulls.length === 1 ? pulls.at(0) : undefined;
  if (only !== undefined && heldOf({ value: only.title.replace(/[.\s]+$/u, "") }) === "present") {
    what = "present";
  }
  return { lean: "absent", problem: "absent", stakes: "absent", what };
}

/**
 * An act's form before any lookup has answered.
 *
 * @param act the ledger row
 * @returns `drawn` for an act that is not a finding, else the refusal saying what the card is waiting on
 */
function actCardFormBefore({ act }: { act: Pick<AutonomyRow, "kind" | "run" | "subject"> }): ActCardForm {
  if (act.kind !== FINDING_ACT_KIND) {
    return { kind: "drawn" };
  }
  const branch = actPullLookupBranch({ act });
  if (branch === undefined) {
    return {
      kind: "refused",
      why: "This finding names no branch to look its pull request up by, so the card cannot say what it did.",
    };
  }
  return {
    kind: "refused",
    why: `The pull request opened from branch ${branch} is read when this card opens; until then there is nothing to draw.`,
  };
}

/**
 * An act row as its panel draws it once the by-branch lookup has answered: the pull request it found leads the
 * links, and exactly one — with every search match read, no other GitHub address linked, and a description that
 * gave its Problem, Risk and Blast radius — DRAWS the card from that pull request (`./findingActCard.ts`
 * `findingActCard`), merged or not. Every other answer — still looking, not measured, none, several, matches left
 * unread, another GitHub address linked, a description the verb declined — REFUSES the card with the one sentence
 * saying why ({@link ActCardForm}); the links and the steer controls stay.
 *
 * @param row the row `rowsOf` built
 * @param lookup the lookup for the row's {@link actPullLookupBranch}
 * @returns the row to draw — the same row when it is not an act or the lookup is idle
 */
export function withLookedUpPull({ row, lookup }: { row: QueueRow; lookup: ActPullState }): QueueRow {
  const record = row.record;
  if (record.kind !== "act" || lookup.phase === "idle" || lookup.branch !== record.lookupBranch) {
    return row;
  }
  let notice: ReasonWords | undefined = lookupNoticeOf({ lookup });
  let already: readonly CardLink[] = [];
  if (record.links.kind === "linked") {
    already = record.links.links;
  }
  let found: readonly CardLink[] = [];
  // Every answer starts from the ledger's own words, so a row drawn from an earlier answer never keeps its title.
  let card: BriefingCard = actCard({ act: record.act, pulls: [] });
  let basis = actBasis({ act: record.act, pulls: [] });
  let drawn = false;
  if (lookup.phase === "ready") {
    found = lookup.pulls.map((pull) => ({ label: subjectLabel({ subject: pull.url }), url: pull.url }));
    // Any other GitHub address the card already links — a pull request its board row publishes, say — may be a
    // second candidate the lookup never saw, so the card is about neither rather than the one the lookup found.
    const others = already.filter(
      (link) => isGithubAddress({ url: link.url }) && !found.some((pull) => pull.url === link.url),
    );
    const only = lookup.pulls.length === 1 && lookup.unchecked === 0 ? lookup.pulls.at(0) : undefined;
    if (only !== undefined && others.length > 0) {
      notice = `This pull request was opened from branch ${lookup.branch}, but the card also links another address that may be on GitHub, so it is about neither.`;
    }
    if (only !== undefined && others.length === 0) {
      card = actCard({ act: record.act, pulls: [only] });
      basis = actBasis({ act: record.act, pulls: [only] });
      if (only.form.kind === "parsed") {
        card = findingActCard({ act: record.act, cells: only.form, pull: only });
        const bothStakes =
          heldOf({ value: only.form.risk }) === "present" && heldOf({ value: only.form.blastRadius }) === "present";
        basis = { ...basis, problem: heldOf({ value: only.form.problem }), stakes: bothStakes ? "present" : "absent" };
        drawn = true;
      } else {
        notice = `${subjectLabel({ subject: only.url })} was opened from branch ${lookup.branch}, but ${only.form.reason.replace(/[.\s]+$/u, "")}, so this card has nothing of its own to draw.`;
      }
    }
  }
  // A pattern keeps its count framing whatever the lookup answered: every card above starts from `actCard`, which
  // knows one act only.
  card = patternActCard({ card, kind: record.act.kind, subjects: record.subjects });
  let form: ActCardForm = briefingCardForm({ basis, card });
  if (!drawn) {
    // Every answer that does not draw has its sentence; the last line is the one no answer should reach.
    let why: ReasonWords = `The pull request opened from branch ${lookup.branch} was found, but the card could not be drawn from it.`;
    if (notice !== undefined) {
      why = notice;
    }
    form = { kind: "refused", why };
  }
  const links = [...found, ...already.filter((link) => !found.some((pull) => pull.url === link.url))];
  const stated = { boardNotice: record.links.boardNotice, landingNotice: record.links.landingNotice };
  let next: ActLinks = { ...stated, kind: "linked", links };
  if (links.length === 0) {
    next = { ...stated, kind: "none" };
  }
  // The lookup rebuilds the card and its form, so the source's and the machine-id refusals are folded back in first —
  // and the briefings the rebuilt card names are drawn again, since a pull request's own cells may name one
  // (`./cardBriefingPages.ts`).
  return withBriefingPages({
    row: withMachineIdForm({
      row: {
        ...row,
        card,
        hint: actHint({ card, subjects: record.subjects }),
        record: { ...record, form: firstRefusal({ forms: [sourceForm({ source: row.source }), form] }), links: next },
      },
    }),
  });
}
