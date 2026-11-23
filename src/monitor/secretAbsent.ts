/**
 * `secret-absent` — a live credential this install is missing while a row it goes with is stored.
 *
 * The incident it closes: the Google consent split added `google-admin-client-id` and
 * `google-admin-client-secret` beside the user-data pair already on disk. Nothing told the owner the new pair had to be
 * set, so the Admin door stayed shut until a public work answer needed it. `secrets status` would have shown the
 * gap, but only if somebody ran it, and it hides an `absent` row by default because an unconnected source is not
 * news (`src/cli/commands/secrets/statusCore.ts` § visibleRows). This monitor is what says so unasked.
 *
 * ## The criterion
 *
 * A register row (`src/secrets/registry.ts`) is a subject when ALL of these hold:
 *
 *  - it is `live` and `settable` — a retired name is dead weight, and a grant or a hand-installed file is not a
 *    paste: its `writtenBy` is a `connect` flow or prose;
 *  - it is not stored, and the register does not mark it `optional`;
 *  - at least one OTHER live row in its group IS stored, in any state. Its group is every row with the identical
 *    `platform` string, plus any row it names in `absentMattersWith`.
 *
 * **An absent row on a platform with nothing stored is silent, and that is the point.** A source this install
 * never connected is the ordinary state; carding every one would bury the card that matters. The sibling is the
 * evidence that the platform is in use here, so its missing row is a gap rather than a choice.
 *
 * **The platform string is matched exactly, never folded.** The per-door Google grants carry `Google (mail door)`
 * and the like; folding them onto `Google` would card every door the owner never connected whenever the client pair is
 * stored, and a grant's remedy is a `connect` flow, not a paste. A retired row is not evidence either: a
 * superseded client id still on disk says nothing about what this install uses now. A file the register does
 * not know is not a row at all.
 *
 * ## Why the step is the owner's
 *
 * Only the owner holds the value — they mint a key in the provider's console and provision it; the fleet never
 * does. So the card puts `slopweaver secrets set <name>` on the owner's pasteboard, and that command prompts for the value
 * without echoing it. Every live settable row's `writtenBy` is exactly that command, which
 * `unit/secrets/registry.test.ts` pins, so the literal is read off the register rather than rebuilt here.
 *
 * ## Residue, stated
 *
 * A split onto an entirely NEW platform string, with no stored member, stays silent — the same as an unconnected
 * source — until a row declares `absentMattersWith`. A partial Slack install (a bot token and no user token), an
 * admin-only Google install, or a Google install that only ever connected the user-data doors (the admin pair is
 * carded beside the client pair, which is exactly the incident's shape) would fire where the missing row is
 * genuinely unused; `optional` is the remedy for a row that is never needed. A token supplied ONLY through an
 * environment variable (`src/config.ts` reads several first) is carded as missing when a sibling file is stored —
 * this read sees the store, never the environment.
 *
 * Pure: the register and the stored names arrive already read.
 */
import type { CredentialSpec } from "../secrets/registry.js";

import type { MonitorReading, MonitorSubject } from "./types.js";

/**
 * Whether `other` is in `spec`'s group — the same platform string exactly, or a row `spec` declares its absence
 * matters with.
 *
 * @param spec the absent row being judged
 * @param other a candidate sibling
 * @returns true when a stored `other` makes `spec`'s absence a gap
 */
function inGroup({ spec, other }: { spec: CredentialSpec; other: CredentialSpec }): boolean {
  if (other.name === spec.name) {
    return false;
  }
  const linked = spec.absentMattersWith?.includes(other.name) === true;
  return other.platform === spec.platform || linked;
}

/**
 * The subject one missing row posts, when its group has a stored member.
 *
 * @param spec the absent row
 * @param live every live register row
 * @param storedNames the file names standing in the store
 * @returns the subject, or `undefined` when nothing it goes with is stored
 */
function missingSubject({
  spec,
  live,
  storedNames,
}: {
  spec: CredentialSpec;
  live: readonly CredentialSpec[];
  storedNames: ReadonlySet<string>;
}): MonitorSubject | undefined {
  const siblings = live
    .filter((other) => storedNames.has(other.name) && inGroup({ other, spec }))
    .map((other) => other.name);
  if (siblings.length === 0) {
    return undefined;
  }
  return {
    id: spec.name,
    // Every settable name is `[a-z0-9-]` and short, so it is its own step key (`mon-secret-<name>`).
    key: spec.name,
    label: `${spec.readVerbs} (stored beside it: ${siblings.join(", ")}) — ${spec.platform}: ${spec.what}`,
    literal: spec.writtenBy,
  };
}

/**
 * Judge the store against the register.
 *
 * @param specs the credential register — `CREDENTIALS` in production, a fixture in a test
 * @param storedNames the file names standing in `$SLOPWEAVER_HOME/secrets/`, never a value
 * @returns firing with one subject per missing row whose group has a stored member, else clear
 */
export function evaluateSecretAbsent({
  specs,
  storedNames,
}: {
  specs: readonly CredentialSpec[];
  storedNames: ReadonlySet<string>;
}): MonitorReading {
  const live = specs.filter((spec) => spec.lifecycle === "live");
  const subjects = live.flatMap((spec) => {
    if (!spec.settable || spec.optional === true || storedNames.has(spec.name)) {
      return [];
    }
    const subject = missingSubject({ live, spec, storedNames });
    if (subject === undefined) {
      return [];
    }
    return [subject];
  });
  if (subjects.length === 0) {
    return { monitorId: "secret-absent", state: "clear" };
  }
  return { monitorId: "secret-absent", state: "firing", subjects };
}
