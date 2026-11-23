/**
 * The Slack teaser form.
 *
 * ONE message is the whole point: the owner's ruling is that a proposal goes out as a single
 * top-level post, never a split sequence, so `renderTeaser` merges the link and the authored teaser into one
 * message rather than two. `dripArtifactSchema` is imported directly so these tests prove the merged output
 * actually clears the real send door's sole-message cap, not just that `renderTeaser` ran without throwing.
 */
import { describe, expect, it } from "vitest";
import { PROPOSAL_FORM_EXAMPLE } from "../../../../cli/commands/proposal/formExample.js";
import { dripArtifactSchema } from "../../../../outbound/artifact/asMeSchema.js";
import { TEASER_MAX_WORDS } from "../../../../outbound/proposal/schema.js";
import { LINK_LABEL_MAX, renderTeaser } from "../../../../outbound/proposal/teaser.js";

const URL = "https://app.notion.com/p/a-proposal-0000000000000000000000000000a006";

/** The production `dripArtifactSchema` bounds, matching `profile.ts`'s defaults exactly. */
const SEND_DOOR_BOUNDS = { maxMessages: 8, messageVisibleMax: 300, soleMessageVisibleMax: 1000 };

describe("renderTeaser", () => {
  it("emits exactly ONE message — the owner's ruling forbids a split sequence", () => {
    const teaser = renderTeaser({ form: PROPOSAL_FORM_EXAMPLE, proposalUrl: URL });
    expect(teaser.messages.length).toBe(1);
  });

  it("leads with the proposal link, then the authored teaser, in the same message", () => {
    const teaser = renderTeaser({ form: PROPOSAL_FORM_EXAMPLE, proposalUrl: URL });
    expect(teaser.messages[0]!.runs).toEqual([
      { label: "Make a nightly failure reproducible before we chase it", type: "link", url: URL },
      { text: `: ${PROPOSAL_FORM_EXAMPLE.slackTeaser}`, type: "text" },
    ]);
  });

  it("declares the as-me drip kind the Slack lane expects", () => {
    expect(renderTeaser({ form: PROPOSAL_FORM_EXAMPLE, proposalUrl: URL }).kind).toBe("drip");
  });

  it("falls back to a fixed label when the title exceeds Slack's own cap", () => {
    const long = { ...PROPOSAL_FORM_EXAMPLE, title: "t".repeat(LINK_LABEL_MAX + 1) };
    expect(renderTeaser({ form: long, proposalUrl: URL }).messages[0]!.runs[0]).toEqual({
      label: "the proposal",
      type: "link",
      url: URL,
    });
  });

  it("keeps a title exactly at the cap", () => {
    const exact = { ...PROPOSAL_FORM_EXAMPLE, title: "t".repeat(LINK_LABEL_MAX) };
    expect(renderTeaser({ form: exact, proposalUrl: URL }).messages[0]!.runs[0]).toEqual({
      label: "t".repeat(LINK_LABEL_MAX),
      type: "link",
      url: URL,
    });
  });

  it("keeps the link run first even with a title at the label cap and a teaser at the word cap", () => {
    const wide = {
      ...PROPOSAL_FORM_EXAMPLE,
      slackTeaser: Array.from({ length: TEASER_MAX_WORDS }, () => "word").join(" "),
      title: "t".repeat(LINK_LABEL_MAX),
    };
    const run = renderTeaser({ form: wide, proposalUrl: URL }).messages[0]!.runs[0]!;
    expect(run.type).toBe("link");
  });

  it("clears the real send door at the teaser's own word ceiling, with a link label at Slack's own cap", () => {
    // The defect this file exists to close: a teaser at TEASER_MAX_WORDS used to produce a message the send
    // door always refused. This proves the merged single message the door actually receives now validates.
    const atCap = {
      ...PROPOSAL_FORM_EXAMPLE,
      slackTeaser: Array.from({ length: TEASER_MAX_WORDS }, () => "word").join(" "),
      title: "t".repeat(LINK_LABEL_MAX),
    };
    const teaser = renderTeaser({ form: atCap, proposalUrl: URL });
    const parsed = dripArtifactSchema(SEND_DOOR_BOUNDS).safeParse(teaser);
    expect(parsed.success).toBe(true);
  });

  it("stays a single message even for a proposal well under the word cap", () => {
    const teaser = renderTeaser({ form: PROPOSAL_FORM_EXAMPLE, proposalUrl: URL });
    const parsed = dripArtifactSchema(SEND_DOOR_BOUNDS).safeParse(teaser);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.messages.length).toBe(1);
  });
});
