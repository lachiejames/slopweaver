/**
 * A card's briefing reads, an act's pull-request lookup and the console's move, held inside ONE Queue tool call's own
 * deadline: in time they answer as they came back,
 * past it they answer as unread or unconfirmed, and a later call's deadline never lends an earlier call more time.
 */
import { describe, expect, it } from "vitest";
import { boundedCardSeams } from "../../components/voice/boundedCardSeams";
import type { ConsolePresentation } from "../../components/voice/openCardRun";
import type { QueueCall } from "../../components/voice/talkToolRunTypes";
import type { ActPullState } from "../../lib/actPullVerb";
import type { BriefingRead } from "../../lib/briefingRead";
import { byDeadline } from "../../lib/voiceRecordQueue";

const TIME_UP = "the Queue tool's time ran out before this was read";
const BRIEFING: BriefingRead = {
  masked: false,
  nextFrom: null,
  ok: true,
  path: "briefings/acme.md",
  text: "x",
  whole: true,
};
const PULLS: ActPullState = { branch: "acme-1", phase: "ready", pulls: [], unchecked: 0 };
const NEVER = (): Promise<never> => new Promise<never>(() => undefined);

/** One call's deadline race on a hand-fired timer, at a fixed clock, as `useQueueRecord` builds it on a real one. */
function callBy({ deadlineAtMs, nowMs }: { deadlineAtMs: number; nowMs: number }) {
  const asked: string[] = [];
  let fire = (): void => undefined;
  const after = ({ ms }: { readonly ms: number }) => {
    asked.push(`set ${String(ms)}`);
    const done = new Promise<void>((resolve) => {
      fire = resolve;
    });
    return { cancel: () => asked.push("cancel"), done };
  };
  const within: QueueCall["within"] = ({ ask, late }) =>
    byDeadline({ after, ask, deadlineAtMs, late, nowMs: () => nowMs });
  return { asked, fire: () => fire(), within };
}

function seamsOver({
  briefing = NEVER,
  pulls = NEVER,
  move = NEVER,
  verb = NEVER,
}: {
  briefing?: () => Promise<BriefingRead>;
  pulls?: () => Promise<ActPullState>;
  move?: () => Promise<ConsolePresentation>;
  verb?: () => Promise<{ answer: unknown; detail: string; refused: boolean }>;
}) {
  return { actLookup: pulls, presentConsole: move, readBriefing: briefing, verb };
}

describe("boundedCardSeams", () => {
  it("answers each wait as it came back when it comes back in time, the timer set to what is left", async () => {
    const call = callBy({ deadlineAtMs: 20_000, nowMs: 18_000 });
    const bounded = boundedCardSeams({
      seams: seamsOver({
        briefing: async () => BRIEFING,
        move: async () => ({ kind: "opened" }),
        pulls: async () => PULLS,
      }),
      within: call.within,
    });
    const briefing = await bounded.readBriefing({ slug: "acme" });
    const pulls = await bounded.actLookup({ branch: "acme-1" });
    const moved = await bounded.presentConsole({ path: "/queue?card=ask:acme-1" });
    expect([briefing, pulls, moved]).toEqual([BRIEFING, PULLS, { kind: "opened" }]);
    expect(call.asked).toEqual(["set 2000", "cancel", "set 2000", "cancel", "set 2000", "cancel"]);
  });

  it("answers a briefing past the deadline as one that could not be read", async () => {
    const call = callBy({ deadlineAtMs: 20_000, nowMs: 18_000 });
    const raced = boundedCardSeams({ seams: seamsOver({}), within: call.within }).readBriefing({ slug: "acme" });
    call.fire();
    expect(await raced).toEqual({ ok: false, why: TIME_UP });
  });

  it("answers an act's lookup past the deadline as not measured, naming its branch", async () => {
    const call = callBy({ deadlineAtMs: 20_000, nowMs: 18_000 });
    const raced = boundedCardSeams({ seams: seamsOver({}), within: call.within }).actLookup({ branch: "acme-1" });
    call.fire();
    expect(await raced).toEqual({ branch: "acme-1", phase: "not-measured", why: TIME_UP });
  });

  it("answers a console move past the deadline as unconfirmed, one that may still land", async () => {
    const call = callBy({ deadlineAtMs: 20_000, nowMs: 18_000 });
    const bounded = boundedCardSeams({ seams: seamsOver({}), within: call.within });
    const raced = bounded.presentConsole({ path: "/queue?card=ask:acme-1" });
    call.fire();
    expect(await raced).toEqual({
      kind: "refused",
      why: "the Queue tool's time ran out before the console said it moved, so it may still move",
    });
  });

  // A stale answer must not win: open_card's page and thread went through an unbounded browser_open.
  it("answers a verb past the deadline as refused, saying what it opens may still open, and never starts one late", async () => {
    const raced = callBy({ deadlineAtMs: 20_000, nowMs: 18_000 });
    const pending = boundedCardSeams({ seams: seamsOver({}), within: raced.within }).verb({
      args: { page: "acme" },
      name: "browser_open",
    });
    raced.fire();
    const why = "the Queue tool's time ran out before this verb answered, so what it opens may still open";
    expect(await pending).toEqual({ answer: { refused: why }, detail: why, refused: true });
    const opens: string[] = [];
    const gone = callBy({ deadlineAtMs: 20_000, nowMs: 20_000 });
    const late = await boundedCardSeams({
      seams: seamsOver({
        verb: async () => {
          opens.push("opened");
          return { answer: {}, detail: "opened", refused: false };
        },
      }),
      within: gone.within,
    }).verb({ args: { url: "https://acme.example/thread" }, name: "browser_open" });
    expect([late.refused, opens]).toEqual([true, []]);
  });

  it("never starts a move once the call's own deadline has gone, whatever deadline a later call holds", async () => {
    const moves: string[] = [];
    const move = async (): Promise<ConsolePresentation> => {
      moves.push("moved");
      return { kind: "opened" };
    };
    const earlier = callBy({ deadlineAtMs: 20_000, nowMs: 20_100 });
    const later = callBy({ deadlineAtMs: 25_000, nowMs: 20_100 });
    const earlierMove = await boundedCardSeams({ seams: seamsOver({ move }), within: earlier.within }).presentConsole({
      path: "/queue?card=ask:acme-1",
    });
    const laterMove = await boundedCardSeams({ seams: seamsOver({ move }), within: later.within }).presentConsole({
      path: "/queue?card=ask:acme-2",
    });
    expect([earlierMove.kind, laterMove.kind, moves, earlier.asked]).toEqual(["refused", "opened", ["moved"], []]);
  });
});
