/** A card declares whether it is ready for the owner now or waiting on a named session and event. */
import { describe, expect, it } from "vitest";

import { cardAboveFoldWords } from "../../../../../outbound/briefing/aboveFoldText.js";
import { briefingFormSchema } from "../../../../../outbound/briefing/schema.js";
import type { BriefingCard } from "../../../../../outbound/briefing/types.js";
import { CARD, FORM, text, withCard, withMineCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("a card declares whether it is the owner's to answer now", () => {
  it("defaults an omitted readiness to ready, so a form written before the field still renders", () => {
    const { readiness: _dropped, ...withoutReadiness } = CARD;
    const form = { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [withoutReadiness] } };
    const parsed = briefingFormSchema.safeParse(form);

    expect(parsed.success).toBe(true);
    expect(parsed.data!.reactNow.teamFacing[0]!.readiness).toEqual({ state: "ready" });
  });

  it("admits a waiting card naming its session and its event", () => {
    const over = {
      readiness: { state: "waiting" as const, event: "the 271x measurement comes back", session: "handoff-9141" },
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
  });

  it("refuses a waiting card that names no session, because it says nothing the owner can act on", () => {
    const over = {
      readiness: { event: "the measurement comes back", state: "waiting" },
    } as unknown as Partial<BriefingCard>;

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.readiness.session: Invalid input: expected string, received undefined",
    ]);
  });

  it("refuses an `event` running past one sentence", () => {
    const over = {
      readiness: {
        event: "The measurement comes back. Then it lands.",
        session: "ws:12",
        state: "waiting" as const,
      },
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.readiness.event: a waiting card's `event` names the one moment the wait ends, " +
        "in one sentence. The `what` carries the work.",
    ]);
  });

  // A card in the shape that reached the owner: ready by declaration, and its own `what`
  // saying the session had not finished.
  it("refuses a card that declares itself ready while its `what` says a session is still working", () => {
    const over = {
      what: text({
        value: "The chain of four is not a native stack. The session is adopting the four into one native stack.",
      }),
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.what: `what` says a session is still working while the card declares itself " +
        'ready. Declare `"readiness": { "state": "waiting", "session": "…", "event": "…" }` so the card ranks ' +
        "below the ones you can answer now, or reword the `what` to report work that has finished.",
    ]);
  });

  it("admits the same `what` once the card declares what it waits on", () => {
    const over = {
      readiness: { event: "the four adopt into one native stack", session: "handoff-9141", state: "waiting" as const },
      what: text({
        value: "The chain of four is not a native stack. The session is adopting the four into one native stack.",
      }),
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
  });

  it("counts a wait line against the card's own above-fold budget", () => {
    const ready = { ...CARD, readiness: { state: "ready" as const } };
    const waiting = {
      ...CARD,
      readiness: { event: "the measurement comes back", session: "handoff-9141", state: "waiting" as const },
    };

    expect(cardAboveFoldWords({ card: waiting })).toBe(cardAboveFoldWords({ card: ready }) + 5);
  });

  it("applies the same rule to the me-facing grouping, which is where the owner's own card sat", () => {
    const over = {
      what: text({ value: "The page is open. The session is measuring the query cost right now." }),
    };

    expect(refusals({ form: withMineCard({ over }) })).toEqual([
      "reactNow.meFacing.0.what: `what` says a session is still working while the card declares itself " +
        'ready. Declare `"readiness": { "state": "waiting", "session": "…", "event": "…" }` so the card ranks ' +
        "below the ones you can answer now, or reword the `what` to report work that has finished.",
    ]);
  });
});
