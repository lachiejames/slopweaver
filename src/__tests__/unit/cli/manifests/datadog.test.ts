/**
 * The `datadog` noun's manifest rows in `cli/manifests/datadog.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  CATALOGUE_USAGE,
  DATADOG_ALERT_DIGEST_USAGE,
  DATADOG_SHOT_USAGE,
  investigateUsage,
} from "../../../../cli/commands/datadog/usage.js";
import { datadogManifest } from "../../../../cli/manifests/datadog.js";

describe("datadogManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(datadogManifest["logs"]!.meta.usage).toBe(investigateUsage({ product: "logs" }));
    expect(datadogManifest["apm"]!.meta.usage).toBe(investigateUsage({ product: "apm" }));
    expect(datadogManifest["rum"]!.meta.usage).toBe(investigateUsage({ product: "rum" }));
    expect(datadogManifest["ci"]!.meta.usage).toBe(investigateUsage({ product: "ci" }));
    expect(datadogManifest["tests"]!.meta.usage).toBe(investigateUsage({ product: "tests" }));
    expect(datadogManifest["dbm"]!.meta.usage).toBe(investigateUsage({ product: "dbm" }));
    expect(datadogManifest["profiles"]!.meta.usage).toBe(investigateUsage({ product: "profiles" }));
    expect(datadogManifest["alert-digest"]!.meta.usage).toBe(DATADOG_ALERT_DIGEST_USAGE);
    expect(datadogManifest["catalogue"]!.meta.usage).toBe(CATALOGUE_USAGE);
    expect(datadogManifest["shot"]!.meta.usage).toBe(DATADOG_SHOT_USAGE);
  });
});
