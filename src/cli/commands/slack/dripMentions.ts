/**
 * Who an as-me send ADDRESSES — the people and user groups it mentions — and resolving them, or refusing the send.
 *
 * Split out of `./dripCore.ts` under the file-size ratchet, along the seam the two halves already had: `dripCore`
 * plans and reports a drip, and this module answers who the drip names. Pure bar the injected roster lookup,
 * which reads the store's identity roster.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { asMeSequences } from "../../../outbound/artifact/runs.js";
import { scanRawMarkup } from "../../../outbound/artifact/typedRuns.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import {
  groupRefusals,
  type MentionResolution,
  mentionRefusals,
  staleRosterRefusals,
} from "../../../outbound/slack/mentionIndex.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";

/**
 * Every distinct person the send mentions, in first-appearance order. Pure.
 *
 * **The plain-body lane is included, and that is a correction rather than an extension.** This function
 * used to return `[]` for `{"kind":"plain"}`, on the reasoning that a `<@U…>` the operator typed by hand
 * "is already a Slack mention and needs no resolution". The first half is true and the second does not
 * follow: an id nobody holds is *syntactically* a mention and semantically nothing — Slack renders the id
 * at the reader and notifies nobody. Measured on this tree: a `--body` carrying two `<@U…>`
 * tokens, one of them fabricated, dry-ran as `mentions: 0 resolved` and would have posted, while the same
 * fabricated id in the typed lane was refused by name. The escape hatch opts out of the WIDTH and NEWLINE
 * bounds (`../../../outbound/artifact/asMeSchema.ts`'s `plainArtifactSchema` says so, and only those); it was
 * never meant to opt out of "the person you addressed exists".
 *
 * A bare NAME in a plain body is still text, and still nothing this resolves — guessing there would be the
 * fuzzy matching this repo refuses everywhere else. Only explicit `<@…>` markup is read, and it is read
 * with the same scanner the typed lane converts with (`scanRawMarkup`), so the two lanes cannot drift on
 * what counts as a mention.
 *
 * @param artifact the validated drip, one-card post, or the plain-body escape hatch
 * @returns the identity-map keys to resolve, deduplicated, in first-appearance order
 */
export function dripMentionedPeople({ artifact }: { artifact: AsMeArtifact }): readonly string[] {
  if (artifact.kind === "plain") {
    return distinct({
      keys: scanRawMarkup({ text: artifact.text })
        .filter((span) => span.kind === "user")
        .map((span) => span.slackId),
    });
  }
  return distinct({
    keys: asMeSequences({ artifact }).flatMap((sequence) =>
      sequence.runs.filter((run) => run.type === "mention").map((run) => run.person),
    ),
  });
}

/**
 * The USER GROUPS an as-me send addresses, over every shape the lane accepts.
 *
 * The `plain` escape hatch contributes the `S…` id out of a raw `<!subteam^S…>` for the same reason its
 * person arm contributes a raw `<@U…>`'s id: the markup is already in the bytes about to be posted, and
 * Slack does not refuse an unknown subteam — it stores it and shows the reader the raw token.
 *
 * @param artifact the validated drip, one-card post, or plain-body escape hatch
 * @returns each addressed group handle or id, once
 */
export function dripAddressedGroups({ artifact }: { artifact: AsMeArtifact }): readonly string[] {
  if (artifact.kind === "plain") {
    return distinct({
      keys: scanRawMarkup({ text: artifact.text })
        .filter((span) => span.kind === "usergroup")
        .map((span) => span.groupId),
    });
  }
  return distinct({
    keys: asMeSequences({ artifact }).flatMap((sequence) =>
      sequence.runs.filter((run) => run.type === "group").map((run) => run.handle),
    ),
  });
}

/** The keys with every repeat after the first dropped, order preserved. */
function distinct({ keys }: { keys: readonly string[] }): readonly string[] {
  return [...new Set(keys)];
}

/**
 * Resolve every person an as-me send mentions, or refuse the whole send — the drip-lane twin of
 * `./lifecycleRunGuards.ts`'s `resolveArtifactMentions` (the bot-card lane's own version of this check).
 *
 * Takes the ARTIFACT rather than the already-extracted keys, for two reasons that are really one. Every
 * caller was writing the same three steps (extract, resolve, refuse) and one of them — `slack edit --as
 * me` — had its own inlined copy that drifted. And the refusal for an unresolvable key is not the same
 * sentence in both lanes: a typed `mention` run names a key the composer chose and can change, while a raw
 * `<@U…>` in a `--body` is an id already sitting in the bytes about to be posted. Only something holding
 * the artifact can tell those apart, so this holds it.
 *
 * @param artifact the validated drip, one-card post, or plain-body escape hatch
 * @param resolveMentions the injected roster lookup
 * @param home the state home holding the rosters
 * @param conversationMembers the Slack ids in the conversation the message posts into, when the caller read them
 * @returns every mention resolved, or every refusal — the roster store's own among them
 */
export async function resolveDripMentions({
  artifact,
  resolveMentions,
  home,
  conversationMembers,
}: {
  artifact: AsMeArtifact;
  resolveMentions: (args: {
    people: readonly string[];
    groups: readonly string[];
    home: string;
    conversationMembers?: ReadonlySet<string> | undefined;
  }) => Promise<Result<MentionResolution, IdentityRosterError>>;
  home: string;
  conversationMembers?: ReadonlySet<string> | undefined;
}): Promise<Result<MentionResolution>> {
  const people = dripMentionedPeople({ artifact });
  const groups = dripAddressedGroups({ artifact });
  const resolved = await resolveMentions({ conversationMembers, groups, home, people });
  if (resolved.isErr()) {
    return err([resolved.error.message]);
  }
  const resolution = resolved.value;
  const missing = people.filter((person) => !resolution.resolved.has(person));
  if (missing.length > 0) {
    return err(
      artifact.kind === "plain"
        ? rawMentionRefusals({ missing, resolution })
        : mentionRefusals({ missing, resolution }),
    );
  }
  const groupsRefused = groupRefusals({ resolution });
  if (groupsRefused.length > 0) {
    return err(groupsRefused);
  }
  const stale = staleRosterRefusals({ people, resolution });
  if (stale.length > 0) {
    return err(stale);
  }
  return ok(resolution);
}

/**
 * The refusal for a raw `<@U…>` in a `--body` that names nobody.
 *
 * A separate sentence from {@link mentionRefusals} because the remedy and the CONSEQUENCE both differ. In
 * the typed lane the key is a composer's choice and an unresolved one never reaches Slack. Here the id is
 * already in the bytes, and Slack does not refuse an unknown one — it stores it, shows the reader the raw
 * token and notifies nobody, which is precisely the silent failure the bump gate
 * (`../../../outbound/slack/asMeBumpGate.ts`) exists to prevent and could not see: a fabricated id
 * satisfies its `<@U…>` pattern exactly as a real one does.
 *
 * @param missing the ids that resolved to nobody
 * @param resolution the resolution they came from, for the roster's own numbers
 * @returns one refusal line per unknown id
 */
function rawMentionRefusals({
  missing,
  resolution,
}: {
  missing: readonly string[];
  resolution: MentionResolution;
}): readonly string[] {
  return missing.map(
    (id) =>
      `the body writes \`<@${id}>\` as a mention, but nothing knows that id — neither the ` +
      `${String(resolution.roster.addressableKeys)} addressable keys (canonical person id, Slack id, Slack ` +
      "handle, `@handle`, or email) nor the member index. Slack does not refuse an unknown id: it stores " +
      "the message, shows the reader the raw token and notifies nobody. Check the id, or confirm it in " +
      "the identity roster (slopweaver identity roster replace) so a layer can vouch for it.",
  );
}
