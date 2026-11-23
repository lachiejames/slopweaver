/**
 * What the JumpCloud atlas declares about itself, including the two things it cannot yet do.
 *
 * ## Both surfaces are declared-unfilled TODAY, and that is deliberate
 *
 * A descriptor's `status` is static, which is the trap the adversarial pass ranked highest for this class:
 * a surface declared `filled` in source is filled on every install, including one where the sync has never
 * run or failed. So the literals below are the NEVER-SYNCED state and stay that way permanently; what a
 * reader actually gets is this descriptor projected through `surfaceFill.ts`, which derives each surface's
 * status from the install's own manifest. The `api` surface flips only when every applicable kind carries a
 * recorded success, and `driven-browser` only when a walk has recorded pages it actually reached.
 *
 * The sibling Slack atlas is the worked example of getting this wrong: it grades its browser surface synced
 * whenever pages-walked exceeds zero, while canon records it reached only a fraction of the destinations it
 * asked for. "Reported N, reached M" is the failure this file refuses to repeat.
 *
 * ## Why `excludes` is long
 *
 * `kit/contract.ts` requires it and says why: what an atlas deliberately does NOT hold is the fact a reader
 * needs most and the one nobody writes unless a type demands it. Every entry below is a decision with a
 * reason, not a limitation being apologised for.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { JUMPCLOUD_CONSOLE_KINDS } from "./consoleModel.js";
import { JUMPCLOUD_ATLAS_PLATFORM, JUMPCLOUD_KINDS, JUMPCLOUD_VISIBILITY_SCOPE } from "./model.js";

/** JumpCloud's atlas, as it declares itself. */
export const JUMPCLOUD_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "sixteen operations that are inventoried and never called — the full-disk-encryption recovery key, Apple MDM Recovery Lock passwords and lock PINs, Password Vault secret and MFA-code reads, Password Manager and privileged-access backup keys, Google EMM enrolment tokens, the administrator-reactivation GET that sends mail, the Apple MDM service-discovery validation that makes JumpCloud call out to the MDM server, the application user-import read that makes it call out to that application's own identity provider, and the Insights report-creation POST. See exclusions.ts; each row still appears in coverage so a reader learns the endpoint exists",
      ground: "secret-material",
    },
    {
      because:
        "secret-bearing FIELDS on endpoints that are legitimately synced — idpPrivateKey on applications and application templates, sharedSecret on RADIUS servers, apiKey and clientSecret on service accounts, authPassword and authToken on notification channels. An endpoint allowlist does not reach these; sensitiveFields.ts does",
      ground: "secret-material",
    },
    {
      because:
        "the value of any password, passphrase, private key, MFA seed or backup key, at any depth in any response, whether or not the endpoint carrying it was anticipated",
      ground: "secret-material",
    },
    {
      because:
        "every mutation. This atlas only ever reads: no command is run on a device, no policy or group membership is edited, no user is provisioned, and no MDM action is taken. The registry has no callable variant for a write, so this is unreachable rather than merely unused",
      ground: "never-acted",
    },
    {
      because:
        "six families of per-instant telemetry, catalogued as SHAPES rather than stored a row at a time under the owner's volume ruling: per-device System Insights observations, per-device policy-application results under both the `policyresults` kind and the `v2-policyresults-list` operation inside `policies`, device-asset HISTORY inside `assets`, Directory Insights events, and command results. `volume.ts` carries the verdict, the measurement and the §6 reasoning for each; `plan.ts` is what takes them out of the walk. The configuration each family is ABOUT — the devices, the policies an administrator authored, the device assets, the commands somebody wrote — is held in full",
      ground: "shape-index",
      volume: {
        basis: "measured",
        establishedBy:
          "wc -l ~/.slopweaver/atlas/jumpcloud/systeminsights.jsonl, and `slopweaver atlas jumpcloud coverage --kind commandresults` for the command-result family",
        magnitude:
          "the live System Insights row count of the published generation — the file the owner named — beside the live command-result row count the `commandresults` coverage cell reports",
        unboundedBecause:
          "every one of these families is emitted by the platform per collection cycle or per action taken, identified by an instant, and grows with fleet size times elapsed time rather than converging on a list",
      },
    },
  ],
  // The Directory API's reachable roots, then the console walk's own two kinds (`consoleModel.ts`).
  kinds: [...JUMPCLOUD_KINDS, ...JUMPCLOUD_CONSOLE_KINDS],
  platform: JUMPCLOUD_ATLAS_PLATFORM,
  question:
    "what devices, people, policies and access does this JumpCloud organisation hold, which policies are actually applied to which device, and who holds each device",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas jumpcloud sync",
  surfaces: [
    {
      denominator: {
        because:
          "JumpCloud publishes no catalogue of its `directory-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "directory-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "nothing has been published on THIS install yet — run `slopweaver atlas jumpcloud sync`. The literal here is the never-synced state and is never edited to say otherwise: a reader gets the status this install's own manifest earns, projected by `surfaceFill.ts`, which flips the surface to filled only when every applicable kind carries a recorded success",
    },
    {
      denominator: {
        because:
          "JumpCloud publishes no manifest of its administrator console's routes, so this surface is divided by the hand-declared page list in browserPages.ts rather than by what exists — a standing gap on every walk says so",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "admin-console",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "no console walk has been recorded on THIS install yet — run `slopweaver atlas jumpcloud walk` in a Chrome signed in to the JumpCloud admin console. The literal here is the never-walked state and is never edited to say otherwise: `surfaceFill.ts` flips the surface to filled only when the latest walk held every declared page, reached and photographed. A surface is filled by pages actually reached, never by a transport that could reach them",
    },
  ],
  visibilityScope: JUMPCLOUD_VISIBILITY_SCOPE,
};
