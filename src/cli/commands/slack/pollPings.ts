/**
 * Who a `slack poll` notifies: the poll's optional `ping` list resolved to Slack mention tokens, or the whole
 * send refused. Split out of `./pollRun.ts`, whose write order is the part that stays there; resolving a ping
 * happens before the door and decides nothing about the order of irreversible steps.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import type { Result } from "../../../lib/result.js";
import type { PollArtifact } from "../../../outbound/slack/pollForm.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { resolvePings } from "./pollCore.js";

/** The two seams resolving a ping touches: the user-group directory and the identity roster. */
export interface PollPingDeps {
  /** User-group handle → id, for resolving an `@engineers`-style ping. */
  readonly userGroupIds: (args: { token: string }) => Promise<ReadonlyMap<string, string>>;
  /** Identity-map key → Slack user id, EXACT matches only, over one read of the store's roster row. */
  readonly resolvePeople: (args: {
    home: string;
    people: readonly string[];
  }) => Promise<Result<ReadonlyMap<string, string>, IdentityRosterError>>;
}

/**
 * Resolve a poll's pings, or refuse the whole send.
 *
 * A poll that names no ping notifies nobody, by design: a poll being trialled should ping nobody.
 *
 * REFUSED rather than degraded, because both ways of degrading are worse than not sending: a literal
 * `@engineers` left in the text notifies nobody while looking exactly like it did, and silently dropping an
 * unresolvable ping sends the poll to fewer people than were asked for with no sign of it.
 *
 * @param artifact the validated poll, whose `ping` is optional
 * @param deps the injected seams
 * @param home the state home holding the identity roster
 * @param token the Slack bot token, needed only to resolve a group handle
 * @returns the resolved mention tokens, or the refusals to print
 */
export async function resolvePollPings({
  artifact,
  deps,
  home,
  token,
}: {
  artifact: PollArtifact;
  deps: PollPingDeps;
  home: string;
  token: string | undefined;
}): Promise<{ readonly tokens: readonly string[] } | { readonly errors: readonly string[] }> {
  const requested = unsetFieldAsNull({ key: "ping", record: artifact });
  if (requested === null || requested.length === 0) {
    return { tokens: [] };
  }
  const needsGroups = requested.some((ping) => ping.kind === "group");
  if (needsGroups && token?.startsWith("xoxb-") !== true) {
    return { errors: ["resolving a `group` ping needs a Slack BOT token (xoxb-…)"] };
  }
  const groupIds = needsGroups && token !== undefined ? await deps.userGroupIds({ token }) : new Map<string, string>();
  const people = await deps.resolvePeople({
    home,
    people: requested.flatMap((ping) => (ping.kind === "person" ? [ping.person] : [])),
  });
  if (people.isErr()) {
    return { errors: [people.error.message] };
  }
  const { tokens, unresolved } = resolvePings({ groupIds, people: people.value, pings: requested });
  if (unresolved.length > 0) {
    return {
      errors: unresolved.map(
        (ping) => `cannot resolve the ${ping.kind} ping ${JSON.stringify(ping.label)} — nothing was posted`,
      ),
    };
  }
  return { tokens };
}
