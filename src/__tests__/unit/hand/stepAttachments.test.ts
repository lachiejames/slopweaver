/*
 * A hand step's attachments, gathered: each piece spreads to nothing when absent, so a row with none reads back
 * as one written before the fields existed, and the first bad attachment's refusal is the one returned. The
 * `shot` piece's own cases are in `./shot.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { HandStepDraft } from "../../../hand/step.js";
import { checkedAttachments } from "../../../hand/stepAttachments.js";
import { unwrap } from "../../../lib/result.js";

const DRAFT: HandStepDraft = {
  id: "secops-desktop-oauth-client",
  postedBy: "workspace:5",
  postedIso: "2026-10-02T12:00:00.000Z",
  unblocks: "the SecOps atlas",
  what: "Make a Desktop sign-in client for SecOps and store its two values",
  witness: "slopweaver hand done secops-desktop-oauth-client --did stored",
};

describe("checkedAttachments", () => {
  it("spreads to nothing when a step carries no attachment", () => {
    expect(unwrap(checkedAttachments({ draft: DRAFT }))).toEqual({
      checklist: {},
      cites: {},
      details: {},
      quotes: {},
      shot: {},
    });
  });

  it("carries each list it is given as its own piece", () => {
    const pieces = unwrap(
      checkedAttachments({
        draft: {
          ...DRAFT,
          checklist: [{ action: "Click Create credentials" }],
          details: ["the old client was deleted on 1 Oct"],
        },
      }),
    );
    expect(pieces.checklist).toEqual({ checklist: [{ action: "Click Create credentials" }] });
    expect(pieces.cites).toEqual({});
    expect(pieces.details).toEqual({ details: ["the old client was deleted on 1 Oct"] });
  });

  it("refuses with the checklist's own refusal, naming its line", () => {
    const refused = checkedAttachments({ draft: { ...DRAFT, checklist: [{ action: "Click it. Then copy it." }] } });
    expect(refused._unsafeUnwrapErr().message).toBe(
      "checklist line 1 is more than one sentence — one instruction per line, so the owner ticks one thing",
    );
  });
});
