/**
 * The `proposal` noun's register rows quote their value lists from `commands/proposal/registerUsage.ts`, a
 * leaf, rather than from `registerCore.ts`, so enumerating the surface never loads a command. That the manifest
 * imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that each list is still joined
 * from the register's own enums and still reaches the usage line that advertises it.
 */
import { describe, expect, it } from "vitest";

import {
  DRAFT_USAGE,
  INTAKE_USAGE,
  LINT_USAGE,
  TEASER_USAGE,
} from "../../../../cli/commands/proposal/draftingUsage.js";
import {
  FEEDBACK_KIND_LIST,
  REGISTER_STATUS_LIST,
  SETTABLE_STATUS_LIST,
} from "../../../../cli/commands/proposal/registerUsage.js";
import {
  ANSWER_FEEDBACK_USAGE,
  AUDIENCE_USAGE,
  DECIDE_USAGE,
  FEEDBACK_USAGE,
  FOLLOW_UP_USAGE,
  LIST_USAGE,
  RECORD_FEEDBACK_USAGE,
  SHOW_USAGE,
  STATUS_USAGE,
  SUPERSEDE_USAGE,
} from "../../../../cli/commands/proposal/registerVerbUsage.js";
import { proposalManifest } from "../../../../cli/manifests/proposal.js";
import {
  REGISTER_FEEDBACK_KINDS,
  REGISTER_STATUSES,
  SETTABLE_REGISTER_STATUSES,
} from "../../../../outbound/proposal/register/events.js";

describe("proposalManifest", () => {
  it("joins each value list from the register's own enums", () => {
    expect(REGISTER_STATUS_LIST).toBe(REGISTER_STATUSES.join("|"));
    expect(SETTABLE_STATUS_LIST).toBe(SETTABLE_REGISTER_STATUSES.join("|"));
    expect(FEEDBACK_KIND_LIST).toBe(REGISTER_FEEDBACK_KINDS.join("|"));
  });

  it("quotes each list in the usage line of the verb that accepts it", () => {
    expect(proposalManifest["list"]!.meta.usage).toContain(`[--status <${REGISTER_STATUS_LIST}>]`);
    expect(proposalManifest["status"]!.meta.usage).toContain(`<slug> <${SETTABLE_STATUS_LIST}> --why`);
    expect(proposalManifest["record-feedback"]!.meta.usage).toContain(`--kind <${FEEDBACK_KIND_LIST}>`);
    expect(proposalManifest["feedback"]!.meta.usage).toContain(`[--kind <${FEEDBACK_KIND_LIST}>]`);
  });

  it("serves each drafting verb's usage from the drafting leaf", () => {
    expect(proposalManifest["draft"]!.meta.usage).toBe(DRAFT_USAGE);
    expect(proposalManifest["lint"]!.meta.usage).toBe(LINT_USAGE);
    expect(proposalManifest["intake"]!.meta.usage).toBe(INTAKE_USAGE);
    expect(proposalManifest["teaser"]!.meta.usage).toBe(TEASER_USAGE);
  });

  it("serves each register verb's usage from the register-verb leaf", () => {
    expect(proposalManifest["answer-feedback"]!.meta.usage).toBe(ANSWER_FEEDBACK_USAGE);
    expect(proposalManifest["audience"]!.meta.usage).toBe(AUDIENCE_USAGE);
    expect(proposalManifest["decide"]!.meta.usage).toBe(DECIDE_USAGE);
    expect(proposalManifest["feedback"]!.meta.usage).toBe(FEEDBACK_USAGE);
    expect(proposalManifest["follow-up"]!.meta.usage).toBe(FOLLOW_UP_USAGE);
    expect(proposalManifest["list"]!.meta.usage).toBe(LIST_USAGE);
    expect(proposalManifest["record-feedback"]!.meta.usage).toBe(RECORD_FEEDBACK_USAGE);
    expect(proposalManifest["show"]!.meta.usage).toBe(SHOW_USAGE);
    expect(proposalManifest["status"]!.meta.usage).toBe(STATUS_USAGE);
    expect(proposalManifest["supersede"]!.meta.usage).toBe(SUPERSEDE_USAGE);
  });
});
