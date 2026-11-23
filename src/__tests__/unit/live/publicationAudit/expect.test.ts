/**
 * `--expect <door>:<class>:<link>` names a finding a run must produce by class and address only, and is answered met or
 * missed by position. Synthetic addresses only.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parsePublicationExpectation, publicationExpectationsMet } from "../../../../live/publicationAudit/expect.js";
import type { PublicationFinding } from "../../../../live/publicationAudit/types.js";

const THREAD = "https://github.com/acme/widgets/pull/46";

describe("parsePublicationExpectation", () => {
  it("splits on the first two colons, so the link keeps its own scheme", () => {
    expect(unwrap(parsePublicationExpectation({ value: `github:private-term/money:${THREAD}` }))).toEqual({
      className: "private-term/money",
      door: "github",
      link: THREAD,
    });
  });

  it("refuses a value missing a part, an unknown door, an off-shape class and a non-https link, each by name", () => {
    expect(unwrapErr(parsePublicationExpectation({ value: "github:private-term/money" }))).toBe(
      "--expect takes <door>:<class>:<link>, e.g. github:private-term/money:<pull request address>",
    );
    expect(unwrapErr(parsePublicationExpectation({ value: `email:private-term/money:${THREAD}` }))).toBe(
      "--expect door must be one of github, slack, linear, notion",
    );
    expect(unwrapErr(parsePublicationExpectation({ value: `github:money:${THREAD}` }))).toBe(
      "--expect class must be installation-state/<kind>, hygiene/<label> or private-term/<class>",
    );
    expect(unwrapErr(parsePublicationExpectation({ value: "github:private-term/money:http://x" }))).toBe(
      "--expect link must be an https address",
    );
  });
});

describe("publicationExpectationsMet", () => {
  const finding = (over: Partial<PublicationFinding>): PublicationFinding => ({
    className: "installation-state/session-id",
    door: "github",
    fields: ["body"],
    findingId: "0123456789abcdef",
    link: THREAD,
    ...over,
  });
  const expected = { className: "installation-state/session-id", door: "github", link: THREAD } as const;

  it("is met by a finding on the thread or anchored inside it, and not by a neighbouring thread", () => {
    expect(
      publicationExpectationsMet({
        expectations: [expected, expected, expected],
        findings: [finding({ link: `${THREAD}#issuecomment-1001` })],
      }),
    ).toEqual([true, true, true]);
    expect(
      publicationExpectationsMet({ expectations: [expected], findings: [finding({ link: `${THREAD}7` })] }),
    ).toEqual([false]);
  });

  it("answers by position, missing a wrong class, a wrong door and a withheld link", () => {
    expect(
      publicationExpectationsMet({
        expectations: [expected, { ...expected, className: "private-term/money" }, { ...expected, door: "slack" }],
        findings: [finding({})],
      }),
    ).toEqual([true, false, false]);
    expect(publicationExpectationsMet({ expectations: [expected], findings: [finding({ link: null })] })).toEqual([
      false,
    ]);
  });

  it("answers nothing for no expectation", () => {
    expect(publicationExpectationsMet({ expectations: [], findings: [finding({})] })).toEqual([]);
  });
});
