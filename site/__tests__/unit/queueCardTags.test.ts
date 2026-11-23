/*
 * Which board row a hand step's `postedBy` names. It is free text from `--by-session`, and a run posts either its bare
 * slug or `run:<slug>`: read verbatim, the prefixed form matched no row and the card read whole with no tags.
 */

import { describe, expect, it } from "vitest";

import { postingSlugOf } from "../../lib/queueCardTags";

describe("postingSlugOf", () => {
  it("reads a run's prefixed session name as its slug, and anything else verbatim", () => {
    expect(
      ["run:iso-policy-acceptance", "iso-policy-acceptance", "session:3a1e2cff", "unnamed-session", "run:"].map(
        (postedBy) => postingSlugOf({ postedBy }),
      ),
    ).toEqual(["iso-policy-acceptance", "iso-policy-acceptance", "session:3a1e2cff", "unnamed-session", ""]);
  });
});
