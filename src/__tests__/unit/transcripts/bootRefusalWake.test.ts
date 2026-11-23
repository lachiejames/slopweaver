/**
 * The line the courier types into the chair when every boot refuses, and the reader that knows it: both causes word the
 * exact commands or none, every line fits the inline paste cap, and nothing but a whole generated line reads as one.
 */
import { describe, expect, it } from "vitest";

import {
  BOOT_REFUSAL_LINE_MAX,
  bootRefusalSlug,
  bootRefusalWakeLine,
  isBootRefusalWake,
  isRegisterCardId,
  nextUnwokenCard,
} from "../../../transcripts/bootRefusalWake.js";

const CARD = "mon-claude-register-0123456789abcdef";
const CARD_AGAIN = "mon-claude-register-0123456789abcdef.2";

describe("bootRefusalSlug", () => {
  it("names the board row by the card's digest", () => {
    expect(bootRefusalSlug({ cardId: CARD })).toBe("boots-refused-0123456789abcdef");
  });

  it("keeps a second occurrence on its own row", () => {
    expect(bootRefusalSlug({ cardId: CARD_AGAIN })).toBe("boots-refused-0123456789abcdef-2");
  });

  it("names no row for a plan's own card or a short digest", () => {
    expect(bootRefusalSlug({ cardId: "mon-claude-plan-two" })).toBe(undefined);
    expect(bootRefusalSlug({ cardId: "mon-claude-register-0123" })).toBe(undefined);
  });
});

describe("isRegisterCardId", () => {
  it("is true only for the register card's exact id shape", () => {
    expect(isRegisterCardId({ id: CARD })).toBe(true);
    expect(isRegisterCardId({ id: CARD_AGAIN })).toBe(true);
    expect(isRegisterCardId({ id: `${CARD}x` })).toBe(false);
    expect(isRegisterCardId({ id: "mon-codex-register-0123456789abcdef" })).toBe(false);
  });
});

describe("bootRefusalWakeLine", () => {
  it("hands a stale store the two exact commands that seat one Opus investigator under the hatch", () => {
    const line = bootRefusalWakeLine({ cardId: CARD, cause: "stale-store" })!;

    expect(line).toBe(
      "[boots refused mon-claude-register-0123456789abcdef] Every new Claude seat is refusing to boot: the store " +
        "answered and was refused as stale. Say in one line that no new sessions can launch right now, then seat ONE " +
        "Opus investigator, each command on its own: `SLOPWEAVER_ALLOW_STALE_STORE=1 slopweaver handover register " +
        '--ask "Investigate why every boot refuses (mon-claude-register-0123456789abcdef)" --dispatch --slug ' +
        "boots-refused-0123456789abcdef --priority p0`, then `SLOPWEAVER_ALLOW_STALE_STORE=1 slopweaver cmux spawn " +
        "boots-refused-0123456789abcdef --driver claude --model opus`. Keep the refusal: judge the migration, never " +
        "a blind `store push` (skills/supervisor/reference/boots-refused.md).",
    );
  });

  it("names no hatch when the store is not merely stale", () => {
    const line = bootRefusalWakeLine({ cardId: CARD, cause: "register-unreadable" })!;

    expect(line).toBe(
      "[boots refused mon-claude-register-0123456789abcdef] Every new Claude seat is refusing to boot: the plans " +
        "register does not read and the store is not merely stale, so no hatch boots a seat. Say in one line that no " +
        "new sessions can launch right now, read `slopweaver store status`, and make the store readable from this " +
        "chair. Keep the refusal: judge the migration, never a blind `store push` " +
        "(skills/supervisor/reference/boots-refused.md).",
    );
    expect(line.includes("SLOPWEAVER_ALLOW_STALE_STORE")).toBe(false);
  });

  it("fits the inline paste cap for the longest id either cause carries", () => {
    const longest = "mon-claude-register-0123456789abcdef.999999";

    expect(bootRefusalWakeLine({ cardId: longest, cause: "stale-store" })!.length).toBeLessThanOrEqual(
      BOOT_REFUSAL_LINE_MAX,
    );
    expect(bootRefusalWakeLine({ cardId: longest, cause: "register-unreadable" })!.length).toBeLessThanOrEqual(
      BOOT_REFUSAL_LINE_MAX,
    );
  });

  it("writes no line for an id that is not a register card's", () => {
    expect(bootRefusalWakeLine({ cardId: "mon-claude-plan-two", cause: "stale-store" })).toBe(undefined);
  });
});

describe("isBootRefusalWake", () => {
  it("reads either whole generated line as the wake", () => {
    expect(isBootRefusalWake({ text: bootRefusalWakeLine({ cardId: CARD, cause: "stale-store" })! })).toBe(true);
    expect(
      isBootRefusalWake({ text: bootRefusalWakeLine({ cardId: CARD_AGAIN, cause: "register-unreadable" })! }),
    ).toBe(true);
  });

  it("reads a person's words that quote or extend it as that person's", () => {
    const line = bootRefusalWakeLine({ cardId: CARD, cause: "stale-store" })!;

    expect(isBootRefusalWake({ text: `${line} and then merge #12` })).toBe(false);
    expect(isBootRefusalWake({ text: `why did you get ${line}` })).toBe(false);
    expect(isBootRefusalWake({ text: "[boots refused mon-claude-register-0123456789abcdef] fix it" })).toBe(false);
    expect(isBootRefusalWake({ text: "[boots refused no closing bracket" })).toBe(false);
  });
});

describe("nextUnwokenCard", () => {
  it("picks the oldest open register card nobody has claimed", () => {
    expect(
      nextUnwokenCard({
        claimed: (id) => id === CARD,
        openCardIds: ["mon-claude-plan-two", CARD, CARD_AGAIN],
      }),
    ).toBe(CARD_AGAIN);
  });

  it("finds none when every register card is claimed or none is open", () => {
    expect(nextUnwokenCard({ claimed: () => true, openCardIds: [CARD] })).toBe(undefined);
    expect(nextUnwokenCard({ claimed: () => false, openCardIds: ["mon-claude-plan-two"] })).toBe(undefined);
    expect(nextUnwokenCard({ claimed: () => false, openCardIds: [] })).toBe(undefined);
  });
});
