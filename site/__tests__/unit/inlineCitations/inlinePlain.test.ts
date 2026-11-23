import { describe, expect, it } from "vitest";

import { inlinePlain } from "../../../lib/inlineCitations";
import { ACME_ADMIN_QUESTION, WITH_PEOPLE } from "./fixtures";

describe("inlinePlain", () => {
  it("prints the acme-admin question as it reads on the card, every URL gone", () => {
    expect(inlinePlain({ text: ACME_ADMIN_QUESTION })).toBe(
      "Should the fleet bump #16676 and send #16670 its first review ask now, or hold each until the PR below it " +
        "lands (#16672, #16367)? #17560 and #16672, the two red ones in the doc, are now 93/93 green with CodeRabbit " +
        "clean on their content, and #16672 was chased last week.",
    );
  });

  it("prints a person the roster knows by first name, for a queue tile that is itself a link", () => {
    expect(inlinePlain({ references: WITH_PEOPLE, text: "Reply to <@U0QUINN> in the thread?" })).toBe(
      "Reply to Quinn in the thread?",
    );
  });

  it("writes a sentence's numbers one way, as the drawn card does", () => {
    expect(inlinePlain({ text: "Archive 1.7K of 5,977 threads?" })).toBe("Archive 1.7K of 5.9K threads?");
  });
});
