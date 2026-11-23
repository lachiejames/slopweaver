/**
 * The `audit` noun's manifest rows in `cli/manifests/audit.ts` quote their usage from a leaf module rather than from
 * the command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { AUDIT_HYGIENE_USAGE } from "../../../../cli/commands/audit/hygieneUsage.js";
import { AUDIT_PUBLICATIONS_USAGE } from "../../../../cli/commands/audit/publicationsUsage.js";
import { AUDIT_REFERENCES_USAGE } from "../../../../cli/commands/audit/referencesUsage.js";
import { auditManifest } from "../../../../cli/manifests/audit.js";

describe("auditManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(auditManifest["hygiene"]!.meta.usage).toBe(AUDIT_HYGIENE_USAGE);
    expect(auditManifest["references"]!.meta.usage).toBe(AUDIT_REFERENCES_USAGE);
    expect(auditManifest["publications"]!.meta.usage).toBe(AUDIT_PUBLICATIONS_USAGE);
  });
});
