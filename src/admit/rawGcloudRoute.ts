/**
 * Which governed verb a blocked `gcloud` call should be pointed at, if any — the Google Cloud half of
 * `./rawTools.ts`'s routing, split out along the same seam as `./rawGhWriteRoute.ts` so the cover table and
 * the verb it names read together.
 */

import type { RouteCategory } from "./rawToolsRoute.js";

/**
 * `gcloud` command paths `slopweaver gcp` actually performs, each read as a prefix of the call's own words.
 *
 * MEASURED against `src/cli/commands/gcp/gcpCore.ts`'s action table, not assumed — the lesson
 * `GITHUB_COMMAND_COVERS` was corrected into: a hint naming a verb that cannot do the job actively
 * misdirects. `secrets list`, `logging read`, `projects add-iam-policy-binding` and every `auth` call are
 * absent on purpose: the door has no verb for any of them, so they keep the generic cloud hint.
 */
const GCLOUD_COMMAND_COVERS: readonly (readonly string[])[] = [
  ["run", "services", "describe"],
  ["run", "deploy"],
  ["secrets", "describe"],
  ["secrets", "create"],
  ["secrets", "add-iam-policy-binding"],
  ["secrets", "versions", "list"],
  ["secrets", "versions", "describe"],
  ["secrets", "versions", "add"],
  ["secrets", "versions", "disable"],
  ["secrets", "versions", "access"],
  ["iam", "service-accounts", "describe"],
  ["iam", "service-accounts", "create"],
  ["services", "enable"],
  ["artifacts", "repositories", "describe"],
  ["artifacts", "repositories", "create"],
];

/** The groups a covered path opens on — where the command's own words start after any leading global flag. */
const COVERED_GROUPS = new Set(GCLOUD_COMMAND_COVERS.map((path) => path[0]!));

/**
 * Classify a blocked `gcloud` call by whether `slopweaver gcp` covers it.
 *
 * A word is any token not opening on `-`, so a flag's VALUE written before the group (`--project x run …`) is
 * skipped by starting at the first word that is a covered group. A flag placed BETWEEN a group's words
 * (`run --region r services describe`) reads as uncovered — the conservative miss, since it only costs the
 * pointer, never the block.
 *
 * @param tokens the `gcloud …` tokens, env prefix already stripped
 * @returns `gcp-governed` when the call is one `slopweaver gcp` performs, else the generic `cloud-cli`
 */
export function gcloudCategory({ tokens }: { tokens: readonly string[] }): RouteCategory {
  const words = tokens.slice(1).filter((token) => !token.startsWith("-"));
  const start = words.findIndex((word) => COVERED_GROUPS.has(word));
  if (start === -1) {
    return "cloud-cli";
  }
  const path = words.slice(start);
  const covered = GCLOUD_COMMAND_COVERS.some((cover) => cover.every((word, index) => path[index] === word));
  return covered ? "gcp-governed" : "cloud-cli";
}
