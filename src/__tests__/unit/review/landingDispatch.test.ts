import { describe, expect, it } from "vitest";
import { DISTANCE_NOT_REQUESTED } from "../../../live/github/baseDistance.js";
import type { ChannelShare } from "../../../review/channelShare.js";
import { githubCodeownerRequirement } from "../../../review/githubCodeowners.js";
import { githubMergeStatus } from "../../../review/githubMergeStatus.js";
import { type LandingRow, type LandingTest, landingRow, type QueueAvailability } from "../../../review/landing.js";
import type { LandingBoardRow } from "../../../review/landingBoard.js";
import {
  type DispatchDecision,
  dispatchDecision,
  remoteJudgementSignals,
  supervisorDispatchRows,
} from "../../../review/landingDispatch.js";
import { FIRST_ASK_BRIEF } from "../../../review/landingDispatchAsk.js";
import { unreadDispatchFacts } from "../../../review/landingDispatchGate.js";
import type { ThreadDetail } from "../../../review/prStateDetail.js";
import type { PrReviewState } from "../../../review/reviewState.js";
import {
  FINISH_OR_CARD,
  inputs,
  NO_BOARD_ROW,
  NO_SIDE,
  NO_TALK,
  PASSING,
  state,
  summary,
} from "./landingDispatchFixtures.js";

const HAS_QUEUE: QueueAvailability = { kind: "queue", url: "https://github.com/acme/widgets/queue/staging" };

const failing = ({ id, why }: { id: LandingTest["id"]; why: string }): readonly LandingTest[] =>
  PASSING.map((test): LandingTest => (test.id === id ? { id, verdict: "fail", why } : test));

const unknownIn = ({ id, why }: { id: LandingTest["id"]; why: string }): readonly LandingTest[] =>
  PASSING.map((test): LandingTest => (test.id === id ? { id, verdict: "unknown", why } : test));

/**
 * The brief a first-ask session carries, spelled out so a softened "never send", or a dropped
 * lead-with-the-discussion check, fails the test.
 */
const FIRST_ASK =
  "first link a team discussion outside the pull request where a person who owns the topic agreed the change " +
  "and no pushback or objection remains unresolved, either one from before the pull request or the thread of the opener this " +
  "row parked earlier; or name the bug's observed symptom, its one-line fix and why that fix touches nothing else, which is what " +
  "makes it small and obvious (the owner's lead-with-the-discussion row: `slopweaver knowledge recall review ask reviewer " +
  "--domain review`). Where neither holds, record a discussion opener to the channel and people that own the " +
  "topic instead of any ask, with `slack draft record --row <this row> --reviewer not-an-ask --asked-before " +
  "none` (and `--kind message` for a top-level post), never `--act review-ask`. Then pause this row ONCE as this " +
  "cycle's ending, never `handover finish` or settle, so `cmux spawn` can reseat it once unpaused: " +
  '`handover pause <this row> --on "the people the opener asks, once the owner sends it" --why ' +
  '<the draft id>`, one state covering both held and sent, then `handover release <this row> --why "paused on ' +
  "discussion opener <the draft id>\"` before you exit so the run is nobody's; whoever reads their agreement, the owner, " +
  "the supervisor or a seat on the thread, runs `handover unpause <this row> --why <the thread>`, and the " +
  'reseated seat runs `handover claim <this row> --why "resuming after agreement in <the thread>"`, links that ' +
  "thread and drafts the ask. A dropped opener leaves the row paused naming it, which is the owner's to settle. " +
  "Otherwise draft the FIRST review ask to a named person, never a team or a channel. Either way park it for the owner's yes with `slack draft record`, and never send " +
  "it yourself";

describe("FIRST_ASK_BRIEF", () => {
  it("is the brief spelled out here, word for word — a softened 'never send' fails", () => {
    expect(FIRST_ASK_BRIEF).toBe(FIRST_ASK);
  });
});

describe("dispatchDecision — the acts the supervisor sends to a session", () => {
  it("says merge-now when every test passed and nothing is unread", () => {
    expect(dispatchDecision({ inputs: inputs() })).toStrictEqual({
      kind: "act",
      verdict: "merge-now",
      why: "every test passed and it is not queued",
    });
  });

  it("says rebase-and-fix on red CI, naming the required check and how far behind it is", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "spawn-ci",
        state: state({
          ci: "red",
          failingChecks: [{ kind: "check-run", name: "build", required: true, state: "failed", url: undefined }],
        }),
        tests: failing({ id: "ci-green", why: "1 failed" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "rebase-and-fix",
      why: "required check(s) failing: build — it is 47 commit(s) behind staging",
    });
  });

  it("never claims a rebase is needed when the distance was NOT read", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "spawn-ci",
        state: state({ baseDistance: DISTANCE_NOT_REQUESTED, ci: "red" }),
        tests: failing({ id: "ci-green", why: "1 failed" }),
      }),
    });
    expect(decision.kind).toBe("act");
    expect(decision.why).toContain("was not read");
    expect(decision.why).toContain("rebase only if it is");
  });

  it("says it is level with its base rather than inventing a rebase", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "spawn-ci",
        state: state({
          baseDistance: { kind: "read", value: { aheadBy: 3, behindBy: 0, status: "AHEAD" } },
          ci: "red",
        }),
        tests: failing({ id: "ci-green", why: "1 failed" }),
      }),
    });
    expect(decision.why).toContain("it is level with staging, so there is nothing to rebase onto");
  });

  it("says coderabbit-loop when CodeRabbit asked for changes", () => {
    expect(
      dispatchDecision({
        inputs: inputs({
          action: "spawn-coderabbit",
          state: state({
            codeRabbit: "changes-requested",
            codeRabbitDetail: "5 unresolved CodeRabbit comment(s) still open",
          }),
        }),
      }),
    ).toStrictEqual({
      kind: "act",
      verdict: "coderabbit-loop",
      why: "5 unresolved CodeRabbit comment(s) still open",
    });
  });

  it("says coderabbit-loop for open threads when only a BOT is waiting, and never calls it CodeRabbit's", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: { ...NO_SIDE, awaitingUs: 3, open: 3 }, humans: NO_SIDE },
        state: state({ waitingOn: [{ login: "coderabbitai", open: 3 }] }),
        tests: failing({ id: "threads-clear", why: "a reviewer thread is open" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "coderabbit-loop",
      why: "3 open BOT thread(s) — CodeRabbit's or another app's — and no human waiting on us",
    });
  });

  it("says resolve-then-merge when a human is waiting on us and nothing else is", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 7, open: 7 } },
        state: state({ waitingOn: [{ login: "jonahy-acme", open: 7 }] }),
        tests: failing({ id: "threads-clear", why: "a reviewer thread is open" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "resolve-then-merge",
      why: "jonahy-acme (7) is waiting on us, and a chase is not due yet (asked recently)",
    });
  });

  it("reads an advisory-only red as no hold: threads waiting on us are the work, then the merge", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 7, open: 7 } },
        state: state({
          failingChecks: [
            { kind: "check-run", name: "Advisory local browser E2E", required: false, state: "failed", url: undefined },
          ],
          waitingOn: [{ login: "jonahy-acme", open: 7 }],
        }),
        tests: failing({ id: "threads-clear", why: "a reviewer thread is open" }).map((test): LandingTest =>
          test.id === "ci-green" ? { id: "ci-green", verdict: "fail", why: "red" } : test,
        ),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "resolve-then-merge",
      why: "jonahy-acme (7) is waiting on us, and a chase is not due yet (asked recently)",
    });
  });

  it("never says merge-now for a pressed row whose CI test failed, whatever the ladder did", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        state: state({
          failingChecks: [
            { kind: "check-run", name: "Advisory local browser E2E", required: false, state: "failed", url: undefined },
          ],
        }),
        tests: failing({ id: "ci-green", why: "red" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "rebase-and-fix",
      why: "its CI is red (Advisory local browser E2E) — read why and fix it; nothing here promises it lands over that red",
    });
  });

  it("refuses resolve-then-merge while whether a chase is owed could not be established", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 1, open: 1 } },
        state: state({
          bump: { kind: "unknown", why: "the Slack window cannot bound an absence" },
          slack: {
            asked: "unknown",
            asks: [],
            bounded: true,
            mentioned: "unknown",
            mentions: [],
            why: "the corpus is behind",
          },
          waitingOn: [{ login: "jonahy-acme", open: 1 }],
        }),
        tests: failing({ id: "threads-clear", why: "a reviewer thread is open" }),
      }),
    });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("a chase that is due would make this resolve-then-bump instead");
  });

  it("still says resolve-then-merge when the corpus reaches far enough to say nobody was asked", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 1, open: 1 } },
        state: state({
          bump: { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
          slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
          waitingOn: [{ login: "jonahy-acme", open: 1 }],
        }),
        tests: failing({ id: "threads-clear", why: "a reviewer thread is open" }),
      }),
    });
    expect(summary({ decision })).toBe("act:resolve-then-merge");
  });

  it("dispatches the first-ask seat after the threads, never a bump, when a code owner is pending and nobody was asked", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 1, open: 1 } },
        state: state({
          bump: { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
          slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
          waitingOn: [{ login: "jonahy-acme", open: 1 }],
        }),
        tests: PASSING.map((test): LandingTest => {
          if (test.id === "threads-clear") {
            return { id: test.id, verdict: "fail", why: "a reviewer thread is open" };
          }
          if (test.id === "codeowners-satisfied") {
            return { id: test.id, verdict: "fail", why: "GitHub still holds a code-owner request out to @acme/eng" };
          }
          return test;
        }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "draft-first-review-ask",
      why:
        "jonahy-acme (1) is waiting on us, a code owner is still pending, and the Slack corpus reaches far " +
        `enough to say nobody has been asked at all — resolve those threads first, then ${FIRST_ASK}`,
    });
  });

  it("does NOT gate merge-now on the chase state, which has nobody waiting and nobody to chase", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        state: state({
          bump: { kind: "unknown", why: "the Slack window cannot bound an absence" },
          slack: {
            asked: "unknown",
            asks: [],
            bounded: true,
            mentioned: "unknown",
            mentions: [],
            why: "the corpus is behind",
          },
        }),
      }),
    });
    expect(summary({ decision })).toBe("act:merge-now");
  });

  it("says resolve-then-bump when a code owner is ALSO pending", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 1, open: 1 } },
        state: state({ waitingOn: [{ login: "jonahy-acme", open: 1 }] }),
        tests: PASSING.map((test) => {
          if (test.id === "threads-clear") {
            return { id: test.id, verdict: "fail", why: "a reviewer thread is open" } as const;
          }
          if (test.id === "codeowners-satisfied") {
            return {
              id: test.id,
              verdict: "fail",
              why: "GitHub still holds a code-owner request out to @acme/eng",
            } as const;
          }
          return test;
        }),
      }),
    });
    expect(decision.kind).toBe("act");
    expect(summary({ decision })).toBe("act:resolve-then-bump");
  });

  it("refuses a DUE chase the Slack window cannot actually bound, rather than sending one on stale evidence", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 1, open: 1 } },
        state: state({
          bump: {
            eligibleSinceIso: "2026-09-10T00:00:00.000Z",
            kind: "due",
            silentSinceIso: "2026-09-09T00:00:00.000Z",
          },
          slack: { asked: "yes", asks: [], bounded: false, mentioned: "yes", mentions: [], why: "" },
          waitingOn: [{ login: "jonahy-acme", open: 1 }],
        }),
        tests: failing({ id: "threads-clear", why: "a reviewer thread is open" }),
      }),
    });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("that window cannot carry an absence");
  });

  it("refuses resolve-then-bump when a code owner is pending AND the chase state is unknown", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 1, open: 1 } },
        state: state({
          bump: { kind: "unknown", why: "the Slack window cannot bound an absence" },
          slack: {
            asked: "unknown",
            asks: [],
            bounded: true,
            mentioned: "unknown",
            mentions: [],
            why: "the corpus is behind",
          },
          waitingOn: [{ login: "jonahy-acme", open: 1 }],
        }),
        tests: PASSING.map((test): LandingTest => {
          if (test.id === "threads-clear") {
            return { id: test.id, verdict: "fail", why: "a reviewer thread is open" };
          }
          if (test.id === "codeowners-satisfied") {
            return { id: test.id, verdict: "fail", why: "GitHub still holds a code-owner request out to @acme/eng" };
          }
          return test;
        }),
      }),
    });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("a chase that is due would make this resolve-then-bump instead");
  });

  it("says resolve-then-bump on a code-owner wait once a chase is DUE", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "blocked-on",
        state: state({
          bump: {
            eligibleSinceIso: "2026-09-10T00:00:00.000Z",
            kind: "due",
            silentSinceIso: "2026-09-09T00:00:00.000Z",
          },
        }),
        tests: failing({ id: "codeowners-satisfied", why: "GitHub still holds a code-owner request out to @acme/eng" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "resolve-then-bump",
      why:
        "GitHub still holds a code-owner request out to @acme/eng, and a chase is DUE — the newest " +
        "ask-like message found was 2026-09-09T00:00:00.000Z and nobody has answered",
    });
  });

  it("waits rather than bumping when the chase is not due yet", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "blocked-on",
        tests: failing({ id: "codeowners-satisfied", why: "GitHub still holds a code-owner request out to @acme/eng" }),
      }),
    });
    expect(decision.kind).toBe("waiting");
  });

  it("dispatches the first-ask seat to record a draft, never a send, when the corpus says nobody was asked", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "blocked-on",
        state: state({
          bump: { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
          slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
        }),
        tests: failing({ id: "codeowners-satisfied", why: "GitHub still holds a code-owner request out to @acme/eng" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "draft-first-review-ask",
      why:
        "GitHub still holds a code-owner request out to @acme/eng, and the Slack corpus reaches far enough to say " +
        `nobody has been asked at all — ${FIRST_ASK}`,
    });
  });

  it("never drafts the first ask on a TEAMMATE's pull request, in either arm that would", () => {
    const unasked = state({
      bump: { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
      slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
    });
    const owners = failing({
      id: "codeowners-satisfied",
      why: "GitHub still holds a code-owner request out to @acme/eng",
    });
    const theirs = {
      kind: "outside-the-set",
      why: "nobody was asked to review it, and it is the-owner's — the first ask is theirs to send",
    };
    expect(
      dispatchDecision({
        inputs: inputs({ action: "blocked-on", authoredByOwner: false, state: unasked, tests: owners }),
      }),
    ).toStrictEqual(theirs);
    expect(
      dispatchDecision({
        inputs: inputs({
          action: "answer-threads",
          authoredByOwner: false,
          conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 1, open: 1 } },
          state: unasked,
          tests: owners,
        }),
      }),
    ).toStrictEqual(theirs);
  });

  it("still dispatches the first-ask seat over unread terminal facts, because it promises no end state", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "blocked-on",
        state: state({
          bump: { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
          checksTruncated: true,
          reviewsTruncated: true,
          slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
          threadsTruncated: true,
        }),
        tests: failing({ id: "codeowners-satisfied", why: "GitHub still holds a code-owner request out to @acme/eng" }),
      }),
    });
    expect(summary({ decision })).toBe("act:draft-first-review-ask");
  });

  it("reads UNREAD, not waiting, when whether anybody was asked could not be established", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "blocked-on",
        state: state({
          bump: { kind: "unknown", why: "the Slack window cannot bound an absence" },
          slack: {
            asked: "unknown",
            asks: [],
            bounded: true,
            mentioned: "unknown",
            mentions: [],
            why: "the corpus is 14h behind",
          },
        }),
        tests: failing({ id: "codeowners-satisfied", why: "GitHub still holds a code-owner request out to @acme/eng" }),
      }),
    });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("could not be established");
  });
});

describe("dispatchDecision — the owner-judgment verdict, on STRUCTURE alone", () => {
  it("escalates when a reviewer spoke LAST on an open thread, and says it does not judge their words", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, open: 1, reviewerLastWord: 1 } },
      }),
    });
    expect(summary({ decision })).toBe("act:needs-owner-judgment");
    expect(decision.why).toContain("a reviewer spoke LAST on 1 open thread(s)");
    expect(decision.why).toContain("this read does not judge whether they conflict with what you asked");
  });

  it("escalates on a standing CHANGES_REQUESTED, naming who", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        state: state({
          standingChangesRequested: [
            { atIso: "2026-09-10T09:00:00.000Z", login: "tobias-acme", opinion: "changes-requested" },
          ],
        }),
      }),
    });
    expect(summary({ decision })).toBe("act:needs-owner-judgment");
    expect(decision.why).toContain("tobias-acme has a standing CHANGES_REQUESTED review");
  });

  it("never cards a conflict whose local merge NAMED paths — the resolving seat judges materiality", () => {
    // Two README conflicts on a pull request nobody had approved yet, which
    // the old third signal turned into a card telling the owner the resolution was "yours to judge".
    const decision = dispatchDecision({
      inputs: inputs({
        action: "conflicting",
        state: state({
          conflict: {
            local: { kind: "measured", paths: ["README.md", "docs/README.md"], why: "" },
            mergeable: "CONFLICTING",
          },
        }),
        tests: failing({ id: "mergeable", why: "GitHub reports it CONFLICTING" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "rebase-and-fix",
      why:
        "it is 47 commit(s) behind staging — resolve README.md, docs/README.md yourself, markdown included, and " +
        "card the owner only if the resolution materially changes what this pull request does or its risk, naming " +
        "that change",
    });
    expect(decision.why).not.toContain("yours to judge");
  });

  it("gives an approved and an unapproved named conflict the SAME verdict, because approval no longer decides it", () => {
    const conflict = {
      local: { kind: "measured", paths: ["a.ts"], why: "a local merge could not resolve" },
      mergeable: "CONFLICTING",
    } as const;
    const tests = failing({ id: "mergeable", why: "GitHub reports it CONFLICTING" });
    const approved = dispatchDecision({
      inputs: inputs({ action: "conflicting", state: state({ approvedBy: ["lionelb-acme"], conflict }), tests }),
    });
    const unapproved = dispatchDecision({
      inputs: inputs({ action: "conflicting", state: state({ conflict }), tests }),
    });
    expect(approved).toStrictEqual({
      kind: "act",
      verdict: "rebase-and-fix",
      why:
        "a local merge could not resolve — it is 47 commit(s) behind staging — " +
        "resolve a.ts yourself, markdown included, and card the owner only if the resolution materially changes what " +
        "this pull request does or its risk, naming that change",
    });
    expect(unapproved).toStrictEqual(approved);
  });

  it("does not card a named conflict whose reviews did not fit one page, because truncation cannot manufacture a card", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "conflicting",
        state: state({
          conflict: { local: { kind: "measured", paths: ["a.ts"], why: "" }, mergeable: "CONFLICTING" },
          reviewsTruncated: true,
        }),
        tests: failing({ id: "mergeable", why: "GitHub reports it CONFLICTING" }),
      }),
    });
    expect(summary({ decision })).toBe("act:rebase-and-fix");
    expect(decision.why).not.toContain("yours to judge");
  });

  it("still CARDS a conflicting pull request carrying a standing CHANGES_REQUESTED — on the review, never the conflict", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "conflicting",
        state: state({
          approvedBy: ["lionelb-acme"],
          conflict: { local: { kind: "measured", paths: ["a.ts"], why: "" }, mergeable: "CONFLICTING" },
          standingChangesRequested: [
            { atIso: "2026-09-07T03:26:04Z", login: "jonahy-acme", opinion: "changes-requested" },
          ],
        }),
        tests: failing({ id: "mergeable", why: "GitHub reports it CONFLICTING" }),
      }),
    });
    expect(summary({ decision })).toBe("act:needs-owner-judgment");
    expect(decision.why).toContain("jonahy-acme has a standing CHANGES_REQUESTED review");
    expect(decision.why).not.toContain("a.ts");
  });

  it("rebases instead when the local merge came out CLEAN, which is three of the owner's four conflicts", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "conflicting",
        state: state({
          conflict: {
            local: { kind: "measured", paths: [], why: "a local merge of the head into staging came out clean" },
            mergeable: "CONFLICTING",
          },
        }),
        tests: failing({ id: "mergeable", why: "GitHub reports it CONFLICTING" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "rebase-and-fix",
      why: "a local merge of the head into staging came out clean — it is 47 commit(s) behind staging",
    });
  });

  it("reads UNREAD on a conflict nothing measured, rather than guessing a rebase clears it", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "conflicting",
        state: state({
          conflict: {
            local: { kind: "unmeasured", why: "no declared checkout holds acme/widgets" },
            mergeable: "CONFLICTING",
          },
        }),
        tests: failing({ id: "mergeable", why: "GitHub reports it CONFLICTING" }),
      }),
    });
    expect(decision).toStrictEqual({ kind: "unread", why: "no declared checkout holds acme/widgets" });
  });

  it("lets an OPT-OUT label outrank the judgment arm, because a human already said not this one", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "opted-out",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, open: 1, reviewerLastWord: 1 } },
        state: state({ labels: ["no-auto-merge"] }),
      }),
    });
    expect(decision).toStrictEqual({ kind: "waiting", why: "a label opts it out of any press: no-auto-merge" });
  });

  it("lets a DRAFT outrank the judgment arm, and sends a session to finish it or card its close", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "draft",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, open: 1, reviewerLastWord: 1 } },
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "finish-or-card-close",
      why: `it is a draft and no board row states its branch — ${FINISH_OR_CARD}`,
    });
  });
});

describe("dispatchDecision — a draft, held only by a LIVE board row", () => {
  const draftWith = ({ boardRow }: { boardRow: LandingBoardRow }): DispatchDecision =>
    dispatchDecision({ inputs: inputs({ action: "draft", boardRow }) });

  it("waits on a live row, naming its slug and status, so a second seat never lands on the branch", () => {
    const boardRow: LandingBoardRow = { kind: "row", slug: "land-acme-widgets-16378-1111111", status: "ready" };
    expect(draftWith({ boardRow })).toStrictEqual({
      kind: "waiting",
      why: "it is a draft, and land-acme-widgets-16378-1111111 already holds this branch and is ready — that seat finishes it",
    });
  });

  it("treats a status this build does not know as live, holding the draft rather than duplicating a seat", () => {
    const boardRow: LandingBoardRow = { kind: "row", slug: "some-run", status: "parked-somewhere" };
    expect(draftWith({ boardRow })).toStrictEqual({
      kind: "waiting",
      why: "it is a draft, and some-run already holds this branch and is parked-somewhere — that seat finishes it",
    });
  });

  it.each(["done", "cancelled", "rejected"])(
    "acts on a draft whose only row ended %s — a terminal row holds nothing",
    (status) => {
      const boardRow: LandingBoardRow = { kind: "row", slug: "old-run", status };
      expect(draftWith({ boardRow })).toStrictEqual({
        kind: "act",
        verdict: "finish-or-card-close",
        why: `it is a draft and its only board row, old-run, is ${status} — ${FINISH_OR_CARD}`,
      });
    },
  );

  it("never sends a session at a TEAMMATE's draft: finishing or closing it is theirs", () => {
    const decision = dispatchDecision({ inputs: inputs({ action: "draft", authoredByOwner: false }) });
    expect(decision).toStrictEqual({
      kind: "outside-the-set",
      why: "it is still a draft, and it is the-owner's — finishing or closing it is theirs, not a session's",
    });
  });

  it("still acts over unread terminal facts, because finishing a draft promises no end state", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "draft",
        state: state({ checksTruncated: true, reviewsTruncated: true, threadsTruncated: true }),
      }),
    });
    expect(summary({ decision })).toBe("act:finish-or-card-close");
  });
});

describe("dispatchDecision — the three non-act kinds stay distinguishable", () => {
  it("reads a queued pull request as waiting, not as an act", () => {
    expect(dispatchDecision({ inputs: inputs({ action: "queued" }) })).toStrictEqual({
      kind: "waiting",
      why: "GitHub's merge queue has it — nothing to send anybody",
    });
  });

  it("CARDS a queued pull request carrying a standing changes-requested, rather than filing it as waiting", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "queued",
        state: state({
          standingChangesRequested: [
            { atIso: "2026-09-10T09:00:00.000Z", login: "tobias-acme", opinion: "changes-requested" },
          ],
        }),
      }),
    });
    expect(summary({ decision })).toBe("act:needs-owner-judgment");
  });

  it("still files a queued pull request with NO judgment signal as waiting", () => {
    expect(dispatchDecision({ inputs: inputs({ action: "queued" }) }).kind).toBe("waiting");
  });

  it("reads a stacked pull request as waiting on the bottom of its stack", () => {
    expect(dispatchDecision({ inputs: inputs({ action: "stacked" }) }).kind).toBe("waiting");
  });

  it("reads a base with no queue as outside the set, never as an act", () => {
    expect(dispatchDecision({ inputs: inputs({ action: "no-queue" }) }).kind).toBe("outside-the-set");
  });

  it("reads a pull request we pressed that GitHub dropped as waiting, and says not to press again", () => {
    const decision = dispatchDecision({ inputs: inputs({ action: "pressed-not-queued" }) });
    expect(decision.kind).toBe("waiting");
    expect(decision.why).toContain("do not press it again until the head moves");
  });

  it("reads landing's own unknown act as UNREAD rather than as an ordinary wait", () => {
    expect(dispatchDecision({ inputs: inputs({ action: "unknown" }) }).kind).toBe("unread");
  });
});

describe("the terminal evidence gate", () => {
  it("refuses merge-now when GitHub has not computed mergeability", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        state: state({ conflict: { local: { kind: "not-requested" }, mergeable: "UNKNOWN" } }),
        tests: unknownIn({ id: "mergeable", why: "GitHub has not computed it" }),
      }),
    });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("merge-now would claim an end state, and mergeable is unread");
  });

  it("refuses resolve-then-merge when the thread read was TRUNCATED", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, awaitingUs: 1, open: 1 } },
        state: state({ threadsTruncated: true, waitingOn: [{ login: "jonahy-acme", open: 1 }] }),
        tests: failing({ id: "threads-clear", why: "a reviewer thread is open" }),
      }),
    });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("threads is unread");
  });

  it("refuses a terminal verdict when the failing-check list is a lower bound", () => {
    const decision = dispatchDecision({ inputs: inputs({ state: state({ checksTruncated: true }) }) });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("check-contexts is unread");
  });

  it("refuses a terminal verdict when the reviews read was capped, so a standing verdict may be missing", () => {
    const decision = dispatchDecision({ inputs: inputs({ state: state({ reviewsTruncated: true }) }) });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("reviews is unread");
  });

  it("refuses a terminal verdict when the LABEL page was capped, so an opt-out may be invisible", () => {
    const decision = dispatchDecision({ inputs: inputs({ state: state({ labelsTruncated: true }) }) });
    expect(decision.kind).toBe("unread");
    expect(decision.why).toContain("labels is unread");
  });

  it("does NOT hold a first-step verdict back for the same unread facts", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "spawn-ci",
        state: state({ checksTruncated: true, ci: "red", reviewsTruncated: true, threadsTruncated: true }),
        tests: failing({ id: "ci-green", why: "1 failed" }),
      }),
    });
    expect(summary({ decision })).toBe("act:rebase-and-fix");
  });

  it("does NOT hold coderabbit-loop back when it is reached through open threads either", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "answer-threads",
        conversations: { codeRabbit: { ...NO_SIDE, awaitingUs: 1, open: 1 }, humans: NO_SIDE },
        state: state({ reviewsTruncated: true, waitingOn: [{ login: "coderabbitai", open: 1 }] }),
        tests: failing({ id: "threads-clear", why: "a reviewer thread is open" }),
      }),
    });
    expect(summary({ decision })).toBe("act:coderabbit-loop");
  });

  it("does NOT hold the owner-judgment verdict back for the same unread facts", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        conversations: { codeRabbit: NO_SIDE, humans: { ...NO_SIDE, open: 1, reviewerLastWord: 1 } },
        state: state({ threadsTruncated: true }),
      }),
    });
    expect(summary({ decision })).toBe("act:needs-owner-judgment");
  });

  it("does NOT treat an unread base distance as a hole, because a merge queue rebases", () => {
    const decision = dispatchDecision({
      inputs: inputs({ state: state({ baseDistance: DISTANCE_NOT_REQUESTED }) }),
    });
    expect(summary({ decision })).toBe("act:merge-now");
  });
});

describe("unreadDispatchFacts", () => {
  it("names nothing on a row every read answered", () => {
    expect(unreadDispatchFacts({ inputs: inputs() })).toStrictEqual([]);
  });

  it("reports mergeability first, then the conflict measurement, then the reads behind them", () => {
    const facts = unreadDispatchFacts({
      inputs: inputs({
        state: state({
          checksTruncated: true,
          conflict: { local: { kind: "unmeasured", why: "no checkout" }, mergeable: "CONFLICTING" },
          threadsTruncated: true,
        }),
        tests: unknownIn({ id: "queue-available", why: "the queue read failed" }),
      }),
    });
    expect(facts.map((fact) => fact.fact)).toStrictEqual([
      "conflict-measurement",
      "check-contexts",
      "threads",
      "landing-test",
    ]);
  });
});

describe("supervisorDispatchRows", () => {
  it("selects every act the supervisor spawns for, both stale-work acts included, and excludes the one the owner answers", () => {
    const rows = [
      { dispatch: { kind: "act", verdict: "merge-now", why: "every test passed" } } as const,
      { dispatch: { kind: "act", verdict: "needs-owner-judgment", why: "a standing changes-requested" } } as const,
      { dispatch: { kind: "waiting", why: "queued" } } as const,
      { dispatch: { kind: "act", verdict: "coderabbit-loop", why: "2 open bot thread(s)" } } as const,
      { dispatch: { kind: "unread", why: "mergeable is unread" } } as const,
      { dispatch: { kind: "act", verdict: "draft-first-review-ask", why: "nobody was asked" } } as const,
      { dispatch: { kind: "act", verdict: "finish-or-card-close", why: "an unheld draft" } } as const,
    ];
    expect(supervisorDispatchRows({ rows })).toStrictEqual([rows[0], rows[3], rows[5], rows[6]]);
  });

  it("DISPATCHES a named conflict, so the landing read boards it for a seat rather than carding the owner", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "conflicting",
        state: state({
          conflict: { local: { kind: "measured", paths: ["README.md"], why: "" }, mergeable: "CONFLICTING" },
        }),
        tests: failing({ id: "mergeable", why: "GitHub reports it CONFLICTING" }),
      }),
    });
    const rows = [{ dispatch: decision }];
    expect(supervisorDispatchRows({ rows })).toStrictEqual(rows);
  });

  it("selects nothing from a fleet that is entirely waiting", () => {
    expect(supervisorDispatchRows({ rows: [{ dispatch: { kind: "waiting", why: "queued" } } as const] })).toStrictEqual(
      [],
    );
  });
});

describe("remoteJudgementSignals", () => {
  /** One thread as the reader's shape carries it, with the fields a signal turns on overridden. */
  const thread = (over: Partial<ThreadDetail> = {}): ThreadDetail => ({
    commentCount: 2,
    id: "PRRT_kwDOfake1",
    disposition: "reviewer-replied",
    isOutdated: false,
    lastCommentAtIso: "2026-09-11T10:00:00Z",
    lastCommentLine: "still not what I asked for",
    lastCommentLogin: "a-colleague",
    line: 12,
    openedAtIso: "2026-09-11T09:00:00Z",
    openedByLogin: "coderabbitai",
    openerLine: "consider extracting this",
    path: "src/app.ts",
    ...over,
  });

  it("escalates a colleague's last word on a CODERABBIT-opened thread, which the tallies count as the bot's", () => {
    const signals = remoteJudgementSignals({
      conversations: NO_TALK,
      standingChangesRequested: [],
      threads: [thread()],
    });
    expect(signals).toEqual([
      "a colleague spoke LAST on 1 open CodeRabbit thread(s) — tallied with the bot's by opener, so read those " +
        "words rather than sending a CodeRabbit session at them",
    ]);
  });

  it("says nothing when the bot itself spoke last on its own thread", () => {
    const signals = remoteJudgementSignals({
      conversations: NO_TALK,
      standingChangesRequested: [],
      threads: [thread({ lastCommentLogin: "coderabbitai" })],
    });
    expect(signals).toEqual([]);
  });

  it("says nothing when a colleague OPENED the thread, because the humans tally already counts that one", () => {
    const signals = remoteJudgementSignals({
      conversations: NO_TALK,
      standingChangesRequested: [],
      threads: [thread({ openedByLogin: "a-colleague" })],
    });
    expect(signals).toEqual([]);
  });

  it("says nothing about a RESOLVED bot thread a colleague had spoken on", () => {
    const signals = remoteJudgementSignals({
      conversations: NO_TALK,
      standingChangesRequested: [],
      threads: [thread({ disposition: "resolved" })],
    });
    expect(signals).toEqual([]);
  });
});

describe("a conflict whose measured merge carried no sentence of its own", () => {
  it("opens on the rebase clause rather than on a bare em dash", () => {
    const decision = dispatchDecision({
      inputs: inputs({
        action: "conflicting",
        state: state({
          approvedBy: ["quinn-acme"],
          conflict: { local: { kind: "measured", paths: ["a.ts"], why: "" }, mergeable: "CONFLICTING" },
        }),
        tests: failing({ id: "mergeable", why: "GitHub reports it CONFLICTING" }),
      }),
    });
    expect(decision).toStrictEqual({
      kind: "act",
      verdict: "rebase-and-fix",
      why:
        "it is 47 commit(s) behind staging — " +
        "resolve a.ts yourself, markdown included, and card the owner only if the resolution materially changes what " +
        "this pull request does or its risk, naming that change",
    });
  });
});

describe("a pending code-owner request, driven through the REAL ladder rather than hand-fed tests", () => {
  /** The eleven of owner ask 291-9x differed from a held pull request in exactly one field. */
  const withOpenRequest = ({ value }: { value: string }): PrReviewState =>
    state({
      githubCodeowners: githubCodeownerRequirement({
        requests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
        requestsTruncated: false,
        reviews: [],
        reviewsTruncated: false,
      }),
      githubMergeStatus: githubMergeStatus({ value }),
    });

  const rowFor = ({ value }: { value: string }): LandingRow =>
    landingRow({
      inputs: {
        authoredByOwner: true,
        boardRow: NO_BOARD_ROW,
        nowIso: "2026-09-24T17:00:00.000Z",
        optOutLabels: [],
        press: undefined,
        queueAvailability: HAS_QUEUE,
        state: withOpenRequest({ value }),
      },
    });

  const decisionFor = ({ value }: { value: string }): DispatchDecision => {
    const row = rowFor({ value });
    return dispatchDecision({
      inputs: inputs({ action: row.action, state: withOpenRequest({ value }), tests: row.tests }),
    });
  };

  it("reaches merge-now when GitHub answers CLEAN, which is the whole of the owner's ask", () => {
    expect(summary({ decision: decisionFor({ value: "CLEAN" }) })).toBe("act:merge-now");
  });

  it("holds the very same pull request when GitHub answers BLOCKED, never reaching an act at all", () => {
    // The pair is the witness: the two states differ only in mergeStateStatus, so a criterion that ignored
    // it would answer the same thing twice. Here the request IS the requirement and the chase is not due.
    expect(summary({ decision: decisionFor({ value: "BLOCKED" }) })).toBe("waiting");
  });

  it("names BOTH halves on the held row — who is holding it, and what GitHub answered", () => {
    const row = rowFor({ value: "BLOCKED" });
    expect(row.action).toBe("blocked-on");
    expect(row.actionDetail).toBe(
      "waiting on a human review — GitHub still holds a code-owner request out to @acme/eng, and " +
        "GitHub reports the merge BLOCKED, without saying by what",
    );
  });

  it("holds a CLEAN pull request GitHub has STATED CHANGES_REQUESTED on, which the enqueue door also refuses", () => {
    // CLEAN plus a stated decision reached merge-now here while
    // enqueueFindings' reviewFinding raised review-not-approved on the identical inputs — a read planning a
    // press the write would not take. The pair against the case above differs only in reviewDecision.
    const held = state({
      githubCodeowners: githubCodeownerRequirement({
        requests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
        requestsTruncated: false,
        reviews: [],
        reviewsTruncated: false,
      }),
      githubMergeStatus: githubMergeStatus({ value: "CLEAN" }),
      reviewDecision: "CHANGES_REQUESTED",
    });
    const row = landingRow({
      inputs: {
        authoredByOwner: true,
        boardRow: NO_BOARD_ROW,
        nowIso: "2026-09-24T17:00:00.000Z",
        optOutLabels: [],
        press: undefined,
        queueAvailability: HAS_QUEUE,
        state: held,
      },
    });
    expect(row.action).toBe("blocked-on");
    expect(
      summary({
        decision: dispatchDecision({ inputs: inputs({ action: row.action, state: held, tests: row.tests }) }),
      }),
    ).toBe("waiting");
  });
});

describe("dispatchDecision — shared with a channel, nobody named", () => {
  const share = ({ tone }: { tone: ChannelShare["tone"] }): ChannelShare => ({
    asOfIso: "2026-09-28T04:00:00.000Z",
    asksThroughIso: "2026-09-28T04:00:00.000Z",
    badge: "waiting for engagement",
    businessDaysSincePost: 0.4,
    channel: "#dev-team",
    lastReplyAtIso: undefined,
    messageKey: "C0SYN000002:1790508621.312739",
    permalink: "https://acme.slack.com/archives/C0SYN000002/p1790508621312739",
    postedAtIso: "2026-09-27T11:30:21.000Z",
    redAfterBusinessDays: 3,
    replies: 0,
    repliesThroughIso: "2026-09-28T04:00:00.000Z",
    seen: "asks seen through 2026-09-28 04:00Z (the Slack corpus), replies seen through 2026-09-28 04:00Z (the whole thread)",
    tone,
    why: "no reply yet, 0.4 business days into the first business day",
  });
  const decide = ({ tone }: { tone: ChannelShare["tone"] }): DispatchDecision =>
    dispatchDecision({
      inputs: inputs({
        action: "blocked-on",
        state: state({
          bump: { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
          channelShare: share({ tone }),
          slack: { asked: "no", asks: [], bounded: true, mentioned: "yes", mentions: [], why: "" },
        }),
        tests: failing({ id: "codeowners-satisfied", why: "GitHub still holds a code-owner request out to @acme/eng" }),
      }),
    });

  it("waits on the channel while the clock reads green or yellow, rather than drafting a first ask", () => {
    const green = decide({ tone: "green" });
    expect(green).toStrictEqual({
      kind: "waiting",
      why: "GitHub still holds a code-owner request out to @acme/eng, and it was shared in #dev-team with nobody named — waiting for engagement: no reply yet, 0.4 business days into the first business day",
    });
    expect(summary({ decision: decide({ tone: "yellow" }) })).toBe("waiting");
  });

  it("dispatches the first-ask seat, which leads with the discussion, once the clock reads red", () => {
    expect(summary({ decision: decide({ tone: "red" }) })).toBe("act:draft-first-review-ask");
  });

  it("reads an unknown clock as unread, never a first ask the clock has not earned", () => {
    expect(decide({ tone: "unknown" })).toStrictEqual({
      kind: "unread",
      why: "GitHub still holds a code-owner request out to @acme/eng, and it was shared in #dev-team with nobody named — waiting for engagement: no reply yet, 0.4 business days into the first business day",
    });
  });
});
