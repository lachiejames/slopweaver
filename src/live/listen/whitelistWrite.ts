/**
 * The one real, deliberate write path for `responders.json` — `slopweaver responders add`/`remove`.
 *
 * `whitelistStore.ts`'s own header is emphatic that this file is never seeded, never templated, and never
 * falls back to anything: an absent list refuses everyone, including the owner, until a real file exists.
 * This module is that real file coming to exist — an explicit, one-identity-at-a-time edit, never a bulk
 * replace and never inferred from anything else. `docs/security/slack-command-boundary.md` frames widening the whitelist as
 * deliberate, threat-modelled work, "a security act rather than a preference" — which is why every write here requires a
 * stated `reason`, printed back rather than merely accepted, so the deliberateness is a fact this module
 * enforces rather than a convention an operator might skip.
 *
 * Refuses rather than silently overwrites when the CURRENT file is malformed — the same fail-loud posture
 * `loadResponderWhitelist` already takes on read; an edit that "fixed" a broken file by replacing it whole
 * would hide exactly the kind of mistake this whitelist exists to never make invisibly.
 */
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { loadResponderWhitelist } from "./whitelistStore.js";

/** One `responders.json` edit's outcome — the list before and after, so a caller can print exactly what changed. */
export type WhitelistEditResult =
  | { readonly kind: "written"; readonly before: readonly string[]; readonly after: readonly string[] }
  | { readonly kind: "unchanged"; readonly identities: readonly string[] }
  | { readonly kind: "refused"; readonly why: string };

/** Read the current list, refusing (never overwriting) an unreadable file. `absent` reads as an empty list. */
function currentIdentities({
  home,
}: {
  home: string;
}): { readonly identities: readonly string[] } | { readonly refused: string } {
  const whitelist = loadResponderWhitelist({ home });
  if (whitelist.kind === "unreadable") {
    return { refused: `responders.json exists but is unreadable (${whitelist.why}) — refusing to edit it blind` };
  }
  return { identities: whitelist.kind === "list" ? whitelist.identities : [] };
}

/** Write the whole list atomically and durably, creating its directory. */
function writeIdentities({ home, identities }: { home: string; identities: readonly string[] }): void {
  writeFileAtomic({
    contents: `${JSON.stringify(identities, null, 2)}\n`,
    path: stateHomePaths({ home }).respondersJson,
  });
}

/**
 * Add one Slack user id to the responder whitelist — the SAME list gating admission and reply. A no-op,
 * reported as such rather than silently, when the id is already present.
 *
 * @param home the resolved state home
 * @param userId the Slack user id to add
 * @returns the edit's outcome
 */
export function addResponder({ home, userId }: { home: string; userId: string }): WhitelistEditResult {
  const current = currentIdentities({ home });
  if ("refused" in current) {
    return { kind: "refused", why: current.refused };
  }
  if (current.identities.includes(userId)) {
    return { identities: current.identities, kind: "unchanged" };
  }
  const after = [...current.identities, userId];
  writeIdentities({ home, identities: after });
  return { after, before: current.identities, kind: "written" };
}

/**
 * Remove one Slack user id from the responder whitelist. A no-op, reported as such rather than silently,
 * when the id was never present.
 *
 * @param home the resolved state home
 * @param userId the Slack user id to remove
 * @returns the edit's outcome
 */
export function removeResponder({ home, userId }: { home: string; userId: string }): WhitelistEditResult {
  const current = currentIdentities({ home });
  if ("refused" in current) {
    return { kind: "refused", why: current.refused };
  }
  if (!current.identities.includes(userId)) {
    return { identities: current.identities, kind: "unchanged" };
  }
  const after = current.identities.filter((identity) => identity !== userId);
  writeIdentities({ home, identities: after });
  return { after, before: current.identities, kind: "written" };
}
