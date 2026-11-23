/*
 * Which branch a finding act's card looks its pull request up by, beside the module it tests rather than with the
 * act-row tests in `queueRowsAct/`, to keep those under the size ratchet.
 */

import { describe, expect, it } from "vitest";

import { actPullLookupBranch } from "../../lib/queueActRow";

const SLUG = "the-bot-s-own-posts-into-the-ada";
const PR = "https://github.com/lachiejames/slopweaver/pull/1118";

describe("actPullLookupBranch", () => {
  const finding = { kind: "open-internal-finding-pull-request", run: SLUG, subject: SLUG };

  it("looks a finding act up by its board row", () => {
    expect(actPullLookupBranch({ act: finding })).toBe(SLUG);
  });

  it("falls to the subject slug when the row records no run", () => {
    expect(actPullLookupBranch({ act: { ...finding, run: undefined } })).toBe(SLUG);
  });

  it("looks nothing up for an act that is not a finding", () => {
    expect(actPullLookupBranch({ act: { ...finding, kind: "press-merge-when-ready" } })).toBe(undefined);
  });

  it("looks nothing up by an address subject with no run", () => {
    expect(actPullLookupBranch({ act: { ...finding, run: undefined, subject: PR } })).toBe(undefined);
  });
});
