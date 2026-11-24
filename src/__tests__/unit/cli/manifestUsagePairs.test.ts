/**
 * These verbs hand-copy their full `--help` text into their manifest, because the manifest is loaded EAGERLY
 * at CLI startup (to list every noun/verb, `--help` included) while the command module that also carries the
 * text is loaded LAZILY, only when the verb actually dispatches — often pulling in a real provider client
 * (`createDatadogClient`, an atlas sync/reset). Importing the command module's copy into the manifest would
 * eagerly load that client on every CLI invocation, defeating the whole point of `lazy()`, so the copy stays.
 *
 * Nothing previously compared the two copies: `helpTruth.test.ts` checks a manifest's usage against its own
 * parser's accepted FLAGS, and each command module's own test checks its flags against its own usage — but no
 * test ever checked one copy of the PROSE against the other. `github self-review`'s two copies had already
 * drifted (fixed alongside this test) before anything noticed.
 *
 * A verb whose usage lives in a `*Usage.ts` leaf beside its command module does not appear here: the manifest and
 * the command both import that one constant, so drift there is structurally impossible rather than merely tested.
 * Moving these into leaves the same way would retire this file.
 */
import { describe, expect, it } from "vitest";
import { CLOUDFLARE_RESET_USAGE } from "../../../cli/commands/cloudflare/resetRun.js";
import { CLOUDFLARE_SYNC_USAGE } from "../../../cli/commands/cloudflare/syncRun.js";
import { DATADOG_COMPARE_ENVS_USAGE } from "../../../cli/commands/datadog/compareEnvsCore.js";
import { DATADOG_HMI_USAGE } from "../../../cli/commands/datadog/hmiRun.js";
import { DATADOG_METRICS_USAGE } from "../../../cli/commands/datadog/metricsRun.js";
import { DATADOG_PROBE_USAGE } from "../../../cli/commands/datadog/probeRun.js";
import { DATADOG_RAW_USAGE } from "../../../cli/commands/datadog/rawRun.js";
import { DATADOG_SUBMIT_USAGE } from "../../../cli/commands/datadog/submitRun.js";
import { DATADOG_VERIFY_USAGE } from "../../../cli/commands/datadog/verifyRun.js";
import { DEV_BASELINE_BUMP_USAGE } from "../../../cli/commands/dev/baselineBumpCore.js";
import { IDENTITY_AVATARS_USAGE } from "../../../cli/commands/identity/identityAvatars.js";
import { IDENTITY_NARROW_USAGE } from "../../../cli/commands/identity/identityNarrow.js";
import {
  RESET_USAGE as CLOUDFLARE_MANIFEST_RESET_USAGE,
  SYNC_USAGE as CLOUDFLARE_MANIFEST_SYNC_USAGE,
} from "../../../cli/manifests/cloudflare.js";
import {
  COMPARE_ENVS_USAGE as DATADOG_MANIFEST_COMPARE_ENVS_USAGE,
  HMI_USAGE as DATADOG_MANIFEST_HMI_USAGE,
  METRICS_USAGE as DATADOG_MANIFEST_METRICS_USAGE,
  PROBE_USAGE as DATADOG_MANIFEST_PROBE_USAGE,
  RAW_USAGE as DATADOG_MANIFEST_RAW_USAGE,
  SUBMIT_USAGE as DATADOG_MANIFEST_SUBMIT_USAGE,
  VERIFY_USAGE as DATADOG_MANIFEST_VERIFY_USAGE,
} from "../../../cli/manifests/datadog.js";
import { devManifest } from "../../../cli/manifests/dev.js";
import { identityManifest } from "../../../cli/manifests/identity.js";

/** One verb whose usage text is duplicated between a manifest and its lazily-loaded command module. */
interface UsagePair {
  readonly verb: string;
  readonly manifestCopy: string;
  readonly commandCopy: string;
}

const PAIRS: readonly UsagePair[] = [
  { commandCopy: CLOUDFLARE_RESET_USAGE, manifestCopy: CLOUDFLARE_MANIFEST_RESET_USAGE, verb: "cloudflare reset" },
  { commandCopy: CLOUDFLARE_SYNC_USAGE, manifestCopy: CLOUDFLARE_MANIFEST_SYNC_USAGE, verb: "cloudflare sync" },
  {
    commandCopy: DATADOG_COMPARE_ENVS_USAGE,
    manifestCopy: DATADOG_MANIFEST_COMPARE_ENVS_USAGE,
    verb: "datadog compare-envs",
  },
  { commandCopy: DATADOG_HMI_USAGE, manifestCopy: DATADOG_MANIFEST_HMI_USAGE, verb: "datadog hmi" },
  { commandCopy: DATADOG_METRICS_USAGE, manifestCopy: DATADOG_MANIFEST_METRICS_USAGE, verb: "datadog metrics" },
  { commandCopy: DATADOG_PROBE_USAGE, manifestCopy: DATADOG_MANIFEST_PROBE_USAGE, verb: "datadog probe" },
  { commandCopy: DATADOG_RAW_USAGE, manifestCopy: DATADOG_MANIFEST_RAW_USAGE, verb: "datadog raw" },
  { commandCopy: DATADOG_SUBMIT_USAGE, manifestCopy: DATADOG_MANIFEST_SUBMIT_USAGE, verb: "datadog submit" },
  { commandCopy: DATADOG_VERIFY_USAGE, manifestCopy: DATADOG_MANIFEST_VERIFY_USAGE, verb: "datadog verify" },
  // `identity narrow` keeps a hand copy for the same reason: this manifest is eager, the command module is
  // not, and importing the constant there would load the whole identity tree on every CLI invocation.
  { commandCopy: IDENTITY_NARROW_USAGE, manifestCopy: identityManifest["narrow"]!.meta.usage, verb: "identity narrow" },
  {
    commandCopy: IDENTITY_AVATARS_USAGE,
    manifestCopy: identityManifest["avatars"]!.meta.usage,
    verb: "identity avatars",
  },
  // `dev baseline-bump`'s usage sits in its core module, which the metadata-only barrel may not import.
  {
    commandCopy: DEV_BASELINE_BUMP_USAGE,
    manifestCopy: devManifest["baseline-bump"]!.meta.usage,
    verb: "dev baseline-bump",
  },
];

describe("manifest usage text matches its command module's own copy", () => {
  it.each(PAIRS)("$verb", ({ commandCopy, manifestCopy }) => {
    expect(manifestCopy).toBe(commandCopy);
  });
});
