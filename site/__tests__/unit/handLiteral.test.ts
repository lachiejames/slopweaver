/*
 * A hand step's LITERAL, from `hand list --json` to the copy block on its queue card.
 *
 * A card telling the owner to paste a command into a terminal must show the command to copy. The record carries
 * the literal, so the site's reader reads it and the card draws it. The fixture below is such a record, driven
 * through the real reader and row builder.
 */

import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../components/live/read";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { cardForVoice } from "../../lib/queueVoice";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

/** `hand:mds-off-for-good` as `hand list --json` prints it. */
const STEP = {
  context: "slopweaver",
  id: "mds-off-for-good",
  literal:
    "sudo /bin/sh -c '/bin/launchctl disable system/com.apple.metadata.mds || exit 1; /usr/bin/killall mds 2>/dev/null'",
  postedBy: "unnamed-session",
  postedIso: "2026-09-26T09:53:07.593Z",
  unaddressed: undefined,
  unblocks: "mds off outright, proved by no mds after your next restart",
  what: "Paste this in a terminal to switch Spotlight's mds off for good, then restart the Mac whenever suits",
  where: "any terminal; it asks for your Mac password once and is safe to run twice",
  witness: 'slopweaver hand done mds-off-for-good --did "ran it"',
};

function handRowFor({ step }: { step: Record<string, unknown> }): QueueRow {
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: {
      fixture: undefined,
      observedAtIso: "2026-09-26T10:24:00.000Z",
      phase: "ready",
      stampedByRoute: false,
      value: readHandSteps([step])!,
    },
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  return rows.find((row) => row.key === `hand:${String(step["id"])}`)!;
}

/** The copy block a hand row's card draws — a hand row always draws a step card, and anything else fails loudly. */
function copyOf({ row }: { row: QueueRow }): string | undefined {
  const { card } = row;
  if (card.kind !== "step") {
    throw new Error(`a hand row drew a ${card.kind} card, not a step card`);
  }
  return card.copy;
}

describe("a hand step's literal reaches its card", () => {
  it("carries the literal byte for byte into the card's copy block", () => {
    expect(copyOf({ row: handRowFor({ step: STEP }) })).toBe(STEP.literal);
  });

  it("hands the voice the same string, so 'what do I paste' is answered from the card", () => {
    expect(cardForVoice({ row: handRowFor({ step: STEP }) }).pastes).toEqual([STEP.literal]);
  });

  it("draws no copy block on a step with nothing to paste", () => {
    const { literal: _dropped, ...bare } = STEP;
    expect(copyOf({ row: handRowFor({ step: bare }) })).toBeUndefined();
  });

  it("keeps a multi-line literal's newlines and quotes exactly", () => {
    const literal = "cat <<'EOF' > ~/.x\nline \"one\"\n  two\nEOF";
    expect(copyOf({ row: handRowFor({ step: { ...STEP, literal } }) })).toBe(literal);
  });

  it("draws the step as unreadable, naming literal, rather than blanking the list or dropping it silently", () => {
    expect(readHandSteps([{ ...STEP, literal: 42 }])![0].unreadable).toBe("literal");
    expect(readHandSteps([{ ...STEP, literal: null }])![0].unreadable).toBe("literal");
    expect(readHandSteps([{ ...STEP, literal: { cmd: "x" } }])![0].unreadable).toBe("literal");
  });
});
