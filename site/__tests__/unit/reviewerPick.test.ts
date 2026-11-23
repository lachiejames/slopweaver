/*
 * The suggestion card's pure half: the slots an approve sends, and the words a tier is drawn with — a history tier
 * never reads as ownership. A "not them" is said in the call's chat, so no act row takes one.
 */
import { describe, expect, it } from "vitest";

import { ACT_VERBS, actVerbFor, buildActArgv } from "../../lib/actVerbs";
import { APPROVE_SLUG, approveSlotsOf, tierWords } from "../../lib/reviewerPick";

const TARGET = { number: 17560, repoSlug: "acme/acme-admin", reviewer: "U0SYN000004" };

describe("approveSlotsOf", () => {
  it("sends the bare repository name, which the act's id slot accepts, and builds the verb's own argv", () => {
    const verb = ACT_VERBS.find((each) => each.slug === APPROVE_SLUG)!;
    expect(buildActArgv({ slots: approveSlotsOf(TARGET), verb })).toEqual({
      argv: [
        "github",
        "reviewer",
        "pick",
        "--repo",
        "acme-admin",
        "--number",
        "17560",
        "--reviewer",
        "U0SYN000004",
        "--verdict",
        "approve",
        "--by-session",
        "work-console",
        "--json",
      ],
      kind: "argv",
    });
  });

  it("leaves the console no decline row to press, since a decline carries words the owner would type", () => {
    expect(actVerbFor({ slug: "reviewer-decline" })).toBe(undefined);
  });
});

describe("tierWords", () => {
  it("names ownership only for a code owner", () => {
    expect((["named-code-owner", "team-history", "repo-history"] as const).map((tier) => tierWords({ tier }))).toEqual([
      "code owner",
      "who you asked for this team",
      "who you asked in this repository",
    ]);
  });
});
