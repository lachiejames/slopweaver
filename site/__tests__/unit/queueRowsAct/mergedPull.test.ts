/*
 * A finding act's queue card once its lookup has read the pull request opened from its branch: drawn from that pull
 * request's own title, Problem, Risk, Blast radius and status when the lookup proves it is the only one, and refused,
 * the links kept, whenever it cannot.
 */

import { describe, expect, it } from "vitest";

import type { ReadPullRequest } from "../../../lib/findingActCard";
import { notConnectedOf } from "../../../lib/integrations";
import { withLookedUpPull } from "../../../lib/queueActRow";
import { actCard } from "../../../lib/queueCardAct";
import { ACT_LANDING_SUBJECT } from "../../../lib/queueCardActLinks";
import type { QueueRow } from "../../../lib/queueRows";
import { type ReasonWords, reasonTextOf } from "../../../lib/quotedReason";
import { briefingOf } from "../cardKind";
import {
  ACT_LINKED,
  actRows,
  acts,
  BOARD_LOADING,
  board,
  formOf,
  LOADING,
  landing,
  mergedLanding,
  PR,
  PR_OPEN,
  PULL_BASE,
  ready,
  SLUG,
  statusOf,
} from "./harness";

/** The pull request number of an address that is not the act's own. */
const OTHER_NUMBER = 4;

describe("a finding act whose pull request merged before the owner opened its card", () => {
  const OPEN_PULL: ReadPullRequest = {
    boardRowSlug: undefined,
    form: {
      blastRadius: "Every Codex launch Slopweaver makes.",
      kind: "parsed",
      problem: "Codex seats started the ChatGPT app's computer-use tool.",
      risk: "Low risk. A Codex seat could be refused on a home that is fine.",
    },
    headRefName: SLUG,
    mergedAt: "2026-09-26T11:00:00Z",
    number: 7,
    readAtIso: "2026-09-26T12:00:00.000Z",
    repoSlug: "lachiejames/slopweaver",
    state: "merged",
    title: "No Codex Slopweaver starts can launch the ChatGPT app's browser",
    url: PR_OPEN,
  };
  const readyOpen = { branch: SLUG, phase: "ready", pulls: [OPEN_PULL], unchecked: 0 } as const;
  /** The reason half of every open-pull what: the fleet opened it, and on what. */
  const WHY_OPENED =
    "The fleet opened it without asking, on a problem it found itself: Codex seats started the ChatGPT app's computer-use tool.";

  it("looks its pull request up by the board row the ledger names", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    expect(row.record).toEqual({ ...row.record, lookupBranch: SLUG });
  });

  it("draws the card from the merged pull request's own title, Problem, Risk, Blast radius and status", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: readyOpen, row });
    expect([drawn.card.subject, drawn.card.question, drawn.card.what!.whole]).toEqual([
      "lachiejames/slopweaver#7",
      "Was open internal finding pull request on lachiejames/slopweaver#7 the right call?",
      `#7, merged: No Codex Slopweaver starts can launch the ChatGPT app's browser. ${WHY_OPENED}`,
    ]);
    expect(briefingOf({ card: drawn.card }).problem).toBe("Codex seats started the ChatGPT app's computer-use tool.");
    expect(briefingOf({ card: drawn.card }).stakes).toEqual({
      blastRadius: "Every Codex launch Slopweaver makes.",
      checkedIso: "2026-09-26T12:00:00.000Z",
      kind: "pull-request",
      risk: "Low risk. A Codex seat could be refused on a home that is fine.",
      status: "merged",
    });
    expect(drawn.record).toEqual({
      ...row.record,
      form: { kind: "drawn" },
      links: {
        boardNotice: BOARD_LOADING,
        kind: "linked",
        landingNotice: undefined,
        links: [{ label: "lachiejames/slopweaver#7", url: PR_OPEN }],
      },
    });
  });

  it("carries no problem, stakes or lean before its pull request is read, and no lean after", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: readyOpen, row });
    const before = briefingOf({ card: row.card });
    expect([before.problem, before.stakes, before.lean]).toEqual([undefined, undefined, undefined]);
    expect(briefingOf({ card: drawn.card }).lean).toBe(undefined);
  });

  // A what that is the title alone leaves the owner asking what the card is, so it leads with the pull request.
  it("leads the what with which pull request, where it stands, and why the fleet opened it — whole above the fold", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: readyOpen, row });
    const what = briefingOf({ card: drawn.card }).what!;
    expect([what.aboveFold, what.folded]).toEqual([what.whole, false]);
  });

  it("takes only the Problem's first sentence as the reason, and keeps the whole Problem on its own row", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const problem =
      "`autonomy_event` held 1,149 rows for a 931-line register. `autonomy adopt` rewrites lines in place.";
    const pull = { ...OPEN_PULL, form: { ...OPEN_PULL.form, problem } };
    const card = briefingOf({ card: withLookedUpPull({ lookup: { ...readyOpen, pulls: [pull] }, row }).card });
    expect([card.what!.whole, card.problem]).toEqual([
      "#7, merged: No Codex Slopweaver starts can launch the ChatGPT app's browser. The fleet opened it without asking, on a problem it found itself: `autonomy_event` held 1,149 rows for a 931-line register.",
      problem,
    ]);
  });

  // `foldedText` splitting the what at every full stop would let its caps end the drawn what at "Assoc." inside a
  // reason already rejoined, so the what folds by its own two parts instead.
  it("holds a reason that would carry the what past its word cap back whole, never cut inside it", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const problem = `The fix was reviewed by Assoc. Prof. Smith ${"and one more reviewer ".repeat(8)}before it landed.`;
    const pull = { ...OPEN_PULL, form: { ...OPEN_PULL.form, problem } };
    const what = briefingOf({ card: withLookedUpPull({ lookup: { ...readyOpen, pulls: [pull] }, row }).card }).what!;
    expect([what.aboveFold, what.folded, what.whole.endsWith(problem)]).toEqual([
      "#7, merged: No Codex Slopweaver starts can launch the ChatGPT app's browser.",
      true,
      true,
    ]);
  });

  // A splitter that cut a Problem at an abbreviation would leave "Use e.g." above the fold.
  it("never cuts the reason at an abbreviation's full stop", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const reasons = [
      "Use e.g. stale-cache fixtures to reproduce the bug. Then reset them.",
      "Dr. Smith found the stale cache. It affects all users.",
      "Prof. Smith found the stale cache. It affects all users.",
      "The fix was reviewed by Prof. Smith before it landed. It affects all users.",
      "Customers in the U.S. cannot sign in. Retry also fails.",
      "The bug affects users with Ph.D. credentials. They cannot sign in.",
      "The fix was reviewed by Assoc. Prof. Smith before it landed. It affects all users.",
      "The cache was stale for approx. ten minutes each deploy. Nothing alerted.",
      "The failure appears in ver. 2 only. Then retry.",
      "The affected service is issue no. 123 in the tracker. Nothing else is.",
    ].map((problem) => {
      const pull = { ...OPEN_PULL, form: { ...OPEN_PULL.form, problem } };
      const card = briefingOf({ card: withLookedUpPull({ lookup: { ...readyOpen, pulls: [pull] }, row }).card });
      return card.what!.aboveFold.split("found itself: ").at(1);
    });
    expect(reasons).toEqual([
      "Use e.g. stale-cache fixtures to reproduce the bug.",
      "Dr. Smith found the stale cache.",
      "Prof. Smith found the stale cache.",
      "The fix was reviewed by Prof. Smith before it landed.",
      "Customers in the U.S. cannot sign in.",
      "The bug affects users with Ph.D. credentials.",
      "The fix was reviewed by Assoc. Prof. Smith before it landed.",
      "The cache was stale for approx. ten minutes each deploy.",
      "The failure appears in ver. 2 only.",
      "The affected service is issue no. 123 in the tracker.",
    ]);
  });

  it("never doubles the full stop a title already ends on", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const pull = { ...OPEN_PULL, title: "The store holds each act once." };
    const card = briefingOf({ card: withLookedUpPull({ lookup: { ...readyOpen, pulls: [pull] }, row }).card });
    expect(card.what!.whole).toBe(`#7, merged: The store holds each act once. ${WHY_OPENED}`);
  });

  it("still names the pull request and why, and still draws the card, when its title is blank", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: { ...readyOpen, pulls: [{ ...OPEN_PULL, title: "   " }] }, row });
    expect(briefingOf({ card: drawn.card }).what!.whole).toBe(`#7, merged. ${WHY_OPENED}`);
    expect(formOf({ row: drawn })).toEqual({ kind: "drawn" });
  });

  it("names no reason, rather than ending on a colon, when the Problem cell is blank", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const pull = { ...OPEN_PULL, form: { ...OPEN_PULL.form, problem: "  " } };
    const card = briefingOf({ card: withLookedUpPull({ lookup: { ...readyOpen, pulls: [pull] }, row }).card });
    expect(card.what!.whole).toBe("#7, merged: No Codex Slopweaver starts can launch the ChatGPT app's browser.");
  });

  it("omits a problem and stakes whose description cells are blank, and still draws the card", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const blank = { ...OPEN_PULL, form: { blastRadius: "  ", kind: "parsed" as const, problem: " ", risk: "R" } };
    const drawn = withLookedUpPull({ lookup: { ...readyOpen, pulls: [blank] }, row });
    const card = briefingOf({ card: drawn.card });
    expect([card.problem, card.stakes, formOf({ row: drawn })]).toEqual([undefined, undefined, { kind: "drawn" }]);
  });

  it("says each lifecycle in words", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const statuses = (["open", "draft", "closed"] as const).map((state) => {
      const pull = { ...OPEN_PULL, mergedAt: undefined, state };
      const drawn = withLookedUpPull({ lookup: { ...readyOpen, pulls: [pull] }, row });
      return [statusOf({ row: drawn }), briefingOf({ card: drawn.card }).what!.whole.split(":").at(0)];
    });
    expect(statuses).toEqual([
      ["open", "#7, open"],
      ["open, as a draft", "#7, open, as a draft"],
      ["closed without merging", "#7, closed without merging"],
    ]);
  });

  it("refuses the card, keeping the link, when the pull request's description gives no cells", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const declined = {
      ...OPEN_PULL,
      form: { kind: "declined", reason: "its description carries no Risk or Blast radius row" },
    } as const;
    const drawn = withLookedUpPull({ lookup: { ...readyOpen, pulls: [declined] }, row });
    expect(drawn.record).toEqual({
      ...row.record,
      form: {
        kind: "refused",
        why: `lachiejames/slopweaver#7 was opened from branch ${SLUG}, but its description carries no Risk or Blast radius row, so this card has nothing of its own to draw.`,
      },
      links: {
        boardNotice: BOARD_LOADING,
        kind: "linked",
        landingNotice: undefined,
        links: [{ label: "lachiejames/slopweaver#7", url: PR_OPEN }],
      },
    });
  });

  it("refuses the card while it is still looking", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: { branch: SLUG, phase: "loading" }, row });
    expect(drawn.record).toEqual({
      ...row.record,
      form: { kind: "refused", why: `Looking up the pull request opened from branch ${SLUG}, merged or not.` },
      links: { boardNotice: BOARD_LOADING, kind: "none", landingNotice: undefined },
    });
  });

  it("says no pull request was opened from the branch, and how many matches went unread", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: { branch: SLUG, phase: "ready", pulls: [], unchecked: 2 }, row });
    expect(drawn.card).toEqual(row.card);
    expect(drawn.record).toEqual({
      ...row.record,
      form: {
        kind: "refused",
        why: `No pull request, open or merged, was opened from branch ${SLUG}. 2 more search matches were not read, so one of them may be it.`,
      },
      links: { boardNotice: BOARD_LOADING, kind: "none", landingNotice: undefined },
    });
  });

  it("links both pull requests on one branch but refuses to draw either", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const other = { ...OPEN_PULL, number: 8, title: "A second attempt", url: `${PULL_BASE}8` };
    const drawn = withLookedUpPull({ lookup: { ...readyOpen, pulls: [OPEN_PULL, other] }, row });
    expect(drawn.card.subject).toBe(SLUG);
    expect(drawn.record).toEqual({
      ...row.record,
      form: {
        kind: "refused",
        why: `2 pull requests were opened from branch ${SLUG}, so each is linked and the card is about neither.`,
      },
      links: {
        boardNotice: BOARD_LOADING,
        kind: "linked",
        landingNotice: undefined,
        links: [
          { label: "lachiejames/slopweaver#7", url: PR_OPEN },
          { label: "lachiejames/slopweaver#8", url: other.url },
        ],
      },
    });
  });

  it("links one exact match but refuses the card while search matches went unread", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: { ...readyOpen, unchecked: 1 }, row });
    expect(drawn.card).toEqual(row.card);
    expect(drawn.record).toMatchObject({
      form: {
        kind: "refused",
        why: `This pull request was opened from branch ${SLUG}, but the card is not about it yet: 1 more search match was not read, so it may be it.`,
      },
      links: { links: [{ label: "lachiejames/slopweaver#7", url: PR_OPEN }] },
    });
  });

  it("refuses the card when the board row publishes a different GitHub address", () => {
    const [row] = actRows({ boardState: ready({ value: board() }), landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: readyOpen, row });
    expect(drawn.card).toEqual(row.card);
    expect(drawn.record).toEqual({
      ...row.record,
      form: {
        kind: "refused",
        why: `This pull request was opened from branch ${SLUG}, but the card also links another address that may be on GitHub, so it is about neither.`,
      },
      links: {
        boardNotice: undefined,
        kind: "linked",
        landingNotice: undefined,
        links: [
          { label: "lachiejames/slopweaver#7", url: PR_OPEN },
          { label: "lachiejames/slopweaver#6", url: PR },
        ],
      },
    });
  });

  it("keeps the landing reading's own notice beside a refusal", () => {
    const [row] = actRows({ boardState: LOADING });
    const drawn = withLookedUpPull({ lookup: { branch: SLUG, phase: "loading" }, row });
    expect(drawn.record).toMatchObject({
      links: {
        landingNotice: { read: { phase: "loading" }, subject: ACT_LANDING_SUBJECT },
      },
    });
  });

  it("draws the open pull request once the lookup proves it is the only one from the branch", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    const open = { ...OPEN_PULL, mergedAt: undefined, state: "open" } as const;
    const drawn = withLookedUpPull({ lookup: { ...readyOpen, pulls: [open] }, row });
    expect([drawn.card.subject, drawn.card.what!.whole, formOf({ row: drawn })]).toEqual([
      "lachiejames/slopweaver#7",
      `#7, open: No Codex Slopweaver starts can launch the ChatGPT app's browser. ${WHY_OPENED}`,
      { kind: "drawn" },
    ]);
  });

  it("says a lookup that failed without a reason gave none, rather than ending on a colon", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    const drawn = withLookedUpPull({ lookup: { branch: SLUG, phase: "not-measured", why: " " }, row });
    expect(drawn.record).toMatchObject({
      form: {
        kind: "refused",
        why: `The pull request opened from branch ${SLUG} could not be looked up, and the lookup gave no reason.`,
      },
    });
  });

  it("keeps a failed lookup's own reason apart from the console's lead, so the card says it plainly", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    const drawn = withLookedUpPull({ lookup: { branch: SLUG, phase: "not-measured", why: "search refused" }, row });
    expect(formOf({ row: drawn })).toEqual({
      kind: "refused",
      why: [{ lead: `The pull request opened from branch ${SLUG} could not be looked up`, why: "search refused" }],
    });
  });

  it("hands the connect test the same joined sentence it read before the reason was carried apart", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    const why = "no GitHub token configured; run `slopweaver connect github`";
    const drawn = withLookedUpPull({ lookup: { branch: SLUG, phase: "not-measured", why }, row });
    const joined = reasonTextOf({ reason: (formOf({ row: drawn }) as { kind: "refused"; why: ReasonWords }).why });
    expect(joined).toBe(`The pull request opened from branch ${SLUG} could not be looked up: ${why}`);
    // The raw reason alone would read as not connected; the joined sentence never did, so the card's fallback still draws.
    expect([notConnectedOf({ why }) === undefined, notConnectedOf({ why: joined }) === undefined]).toEqual([
      false,
      true,
    ]);
  });

  it("says an unread count that is not a count could not be looked up, and draws nothing", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    const drawn = withLookedUpPull({ lookup: { ...readyOpen, unchecked: -1 }, row });
    expect(drawn.card).toEqual(row.card);
    expect(drawn.record).toMatchObject({
      form: {
        kind: "refused",
        why: `The pull request opened from branch ${SLUG} could not be looked up: -1 unread matches is not a count.`,
      },
    });
  });

  it.each([
    ["still loading", { branch: SLUG, phase: "loading" } as const],
    ["not measured", { branch: SLUG, phase: "not-measured", why: "search refused" } as const],
  ])("takes a card drawn by an earlier answer back to a refusal while the lookup is %s", (_state, lookup) => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    const named = withLookedUpPull({ lookup: readyOpen, row });
    expect(named.card.subject).toBe("lachiejames/slopweaver#7");
    const again = withLookedUpPull({ lookup, row: named });
    expect([again.card, formOf({ row: again }).kind]).toEqual([row.card, "refused"]);
  });

  it("still draws the pull request beside the board row's own queue chip", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    const chip = { label: "board row", url: `/queue?open=ask%3A${SLUG}` };
    const joined = { ...row, record: { ...row.record, links: { ...ACT_LINKED, links: [chip] } } } as QueueRow;
    const drawn = withLookedUpPull({ lookup: readyOpen, row: joined });
    expect(drawn.card.subject).toBe("lachiejames/slopweaver#7");
  });

  it.each([
    ["with its host in capitals", `https://GITHUB.COM/other/repo/pull/${OTHER_NUMBER}`],
    ["with a trailing dot", `https://github.com./other/repo/pull/${OTHER_NUMBER}`],
    ["as its patch", `https://github.com/other/repo/pull/${OTHER_NUMBER}.patch`],
    ["protocol-relative", `//github.com/other/repo/pull/${OTHER_NUMBER}`],
    ["with a scheme and no slashes", `https:github.com/other/repo/pull/${OTHER_NUMBER}`],
  ])("counts an already-linked pull request written %s as another one", (_spelling, shouting) => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: landing() }) });
    const joined = {
      ...row,
      record: {
        ...row.record,
        links: { ...ACT_LINKED, links: [{ label: `other/repo#${OTHER_NUMBER}`, url: shouting }] },
      },
    } as QueueRow;
    const drawn = withLookedUpPull({ lookup: readyOpen, row: joined });
    expect([drawn.card.question, formOf({ row: drawn }).kind]).toEqual([
      `Was open internal finding pull request on ${SLUG} the right call?`,
      "refused",
    ]);
  });

  it("takes the card off its subject pull request when the lookup proves a second one is the act's", () => {
    const subject = `${PULL_BASE}9`;
    const act = { ...acts()[0], subject };
    const openPull = {
      ...OPEN_PULL,
      headRefName: "elsewhere",
      number: 9,
      title: "An earlier attempt",
      url: subject,
    };
    const row = {
      ...actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) })[0],
      card: actCard({ act, pulls: [openPull] }),
    };
    const joined = {
      ...row,
      record: {
        ...row.record,
        act,
        links: { ...ACT_LINKED, links: [{ label: "lachiejames/slopweaver#9", url: subject }] },
      },
    } as QueueRow;
    const drawn = withLookedUpPull({ lookup: readyOpen, row: joined });
    expect([drawn.card.question, drawn.card.what!.whole]).toEqual([
      "Was open internal finding pull request on lachiejames/slopweaver#9 the right call?",
      "I opened a pull request for a problem the fleet found itself.",
    ]);
  });

  it("ignores a lookup for another branch — an answer that arrived after the panel moved on", () => {
    const [row] = actRows({ boardState: LOADING, landingState: ready({ value: mergedLanding() }) });
    const drawn = withLookedUpPull({ lookup: { ...readyOpen, branch: "another-row" }, row });
    expect(drawn).toBe(row);
  });
});
