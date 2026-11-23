/**
 * The `--attach-upload` flag of `handover rule`: either verdict reads, anything else is refused by name, absent
 * decides nothing, and each recorded verdict announces which way it turns attach upload.
 */
import { describe, expect, it } from "vitest";

import {
  attachUploadAnnouncement,
  attachUploadPlan,
  RuleAttachUploadErrors,
} from "../../../../../cli/commands/handover/ruleAttachUpload.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("attachUploadPlan", () => {
  it("reads either verdict, trimmed, and decides nothing when the flag is absent", () => {
    expect([
      unwrap(attachUploadPlan({ values: { "attach-upload": "permitted" } })),
      unwrap(attachUploadPlan({ values: { "attach-upload": " refused " } })),
      unwrap(attachUploadPlan({ values: {} })),
    ]).toEqual([{ verdict: "permitted" }, { verdict: "refused" }, undefined]);
  });

  it("refuses a value that is no verdict, naming both", () => {
    const refused = unwrapErr(attachUploadPlan({ values: { "attach-upload": "yes" } }));
    expect([refused, refused.message]).toEqual([
      RuleAttachUploadErrors.verdictUnknown({ declared: "yes" }),
      '--attach-upload "yes" is not a verdict — pass permitted or refused',
    ]);
  });
});

describe("attachUploadAnnouncement", () => {
  it("says PERMITS for a permit and REFUSES for a refusal", () => {
    expect([
      attachUploadAnnouncement({ attachUpload: { verdict: "permitted" } }),
      attachUploadAnnouncement({ attachUpload: { verdict: "refused" } }),
    ]).toEqual([
      "  it PERMITS `github attach upload` on this install, every picture check still applying, until a later " +
        "--attach-upload refused ruling closes it",
      "  it REFUSES `github attach upload` on this install: no picture or recording leaves this machine through it " +
        "until a later --attach-upload permitted ruling",
    ]);
  });
});
