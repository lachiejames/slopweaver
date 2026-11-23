/**
 * The alert-number half of `../../../../outbound/linkify/bareRefs.ts`.
 *
 * MEASURED, and the reason this file exists: a sentence closing a Dependabot alert by its number scanned to
 * `{kind:"githubRef",number:N}` and resolved to `https://github.com/o/r/issues/N` — a valid link node
 * pointing at an unrelated object, which no later gate inspects. A Dependabot alert number and a
 * pull-request number are both small integers in the same repository, so nothing downstream could catch it.
 *
 * These tests are the witness that the scanner now declines the reference instead of guessing which of two
 * objects was meant. The last case in each block proves the witness can FIRE: the same number with no alert
 * word in front of it still resolves exactly as it always did, so a green here is not green-by-inertia.
 */
import { describe, expect, it } from "vitest";

import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";
import { resolveBareRef, scanBareRefs } from "../../../../outbound/linkify/bareRefs.js";

// register-class: dependabot-alert-cited-as-a-pull-request-url (docs/recurring-failure-register/bindings.md)

const ONE_REPO: BareRefContext = {
  attested: [{ number: 16999, owner: "acme", repo: "widget" }],
  repos: [{ owner: "acme", repo: "widget" }],
};

describe("scanBareRefs on an alert number", () => {
  it("declines a reference introduced by the word alert", () => {
    expect(scanBareRefs({ context: ONE_REPO, text: "Closes Dependabot alert #583." })).toEqual([]);
  });

  it("declines one introduced by advisory", () => {
    expect(scanBareRefs({ context: ONE_REPO, text: "See advisory #640 for the range." })).toEqual([]);
  });

  it("declines one introduced by dependabot alone", () => {
    expect(scanBareRefs({ context: ONE_REPO, text: "dependabot #12 is still open" })).toEqual([]);
  });

  it("declines it whatever the case of the introducing word", () => {
    expect(scanBareRefs({ context: ONE_REPO, text: "ALERT #7" })).toEqual([]);
  });

  it("still finds an ordinary pull-request reference, so the guard is not swallowing everything", () => {
    expect(scanBareRefs({ context: ONE_REPO, text: "Follows #583." })).toEqual([
      { end: 12, kind: "githubRef", number: 583, owner: undefined, raw: "#583", repo: undefined, start: 8 },
    ]);
  });

  it("still finds a reference whose sentence merely mentions alerts elsewhere", () => {
    const spans = scanBareRefs({ context: ONE_REPO, text: "The alert list moved; see #583 for the fix." });
    expect(spans.map((span) => span.raw)).toEqual(["#583"]);
  });
});

describe("resolveBareRef on an ordinary reference", () => {
  it("still builds the issues URL, which is what makes the alert case worth declining", () => {
    const spans = scanBareRefs({ context: ONE_REPO, text: "Follows #583." });
    expect(resolveBareRef({ context: ONE_REPO, span: spans[0]! })).toEqual({
      label: "#583",
      url: "https://github.com/acme/widget/issues/583",
    });
  });
});
