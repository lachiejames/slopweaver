/**
 * The KnowBe4 atlas's own paths, in a module of their own rather than in `atlasHome.ts`, which the
 * `file-size-ratchet` freezes at its recorded code-line count. `atlasHomeGoogle.ts` is the precedent.
 */
import { atlasPlatformPaths } from "./atlasHomeShared.js";
import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * Resolve the KnowBe4 atlas's paths: one kind file per Reporting API family, which
 * `src/atlas/knowbe4/model.ts` names and its store test pins key for key.
 *
 * @param atlasRoot `$home/atlas`, the root every platform hangs off
 * @returns this platform's atlas paths
 */
export function knowbe4AtlasHomePaths({ atlasRoot }: { atlasRoot: string }): AtlasPlatformPaths {
  return atlasPlatformPaths({
    atlasRoot,
    files: {
      account: "account.jsonl",
      group: "groups.jsonl",
      "group-member": "group-members.jsonl",
      "phishing-campaign": "phishing-campaigns.jsonl",
      "phishing-recipient": "phishing-recipients.jsonl",
      "phishing-security-test": "phishing-security-tests.jsonl",
      policy: "policies.jsonl",
      "store-purchase": "store-purchases.jsonl",
      "training-campaign": "training-campaigns.jsonl",
      "training-enrollment": "training-enrollments.jsonl",
      user: "users.jsonl",
    },
    platform: "knowbe4",
  });
}
