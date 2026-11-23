/**
 * Which conversations a listener acts on — `--channels <C1,…>`, `--dm-only`, or everything it is in.
 *
 * ## Why a listener can be scoped
 *
 * Proving the bot in the owner's own DM used to put it live on every channel it had been invited to, because
 * the only switch was the socket itself. MEASURED: a 23-minute dogfood arm captured a
 * colleague's real tag in `C0SYN000002` that Slack redelivered on connect, eighteen minutes after it was
 * posted, and put a queued reaction on it that nothing was ever going to answer. The standing
 * rule is to dogfood in the owner's private DM first, because that is the literal end-to-end test that tells
 * what is going to fail in public — which needs a listener that cannot answer in public.
 *
 * ## An out-of-scope tag leaves no trace in Slack
 *
 * The drop happens at the socket, before the responder whitelist (`./socket.ts`): no refusal reply, no
 * capture reaction, no ask-lifecycle row, no queue line and no emitted line, and it does not count as the one
 * tag `--once` waits for. A scope only ever NARROWS what the bot answers, so every failure here is silence in
 * a conversation the operator chose to exclude — never an answer somewhere they did not.
 *
 * `--dm-only` tests the typed {@link Mention.surface}, never the channel id's leading letter, for the reason
 * `./mention.ts` gives. A specific DM can be named instead with its `D…` id in `--channels`.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { Mention } from "./mention.js";

/** The conversations a listener acts on. `all` is the unscoped listener, byte-for-byte the old behaviour. */
export type ListenScope =
  | { readonly kind: "all" }
  | { readonly kind: "channels"; readonly channels: readonly string[] }
  | { readonly kind: "dm-only" };

/** The unscoped listener. */
export const UNSCOPED: ListenScope = { kind: "all" };

/** A Slack conversation id: a public or private channel (`C…`/`G…`) or a DM (`D…`). */
const CONVERSATION_ID = /^[CDG][A-Z0-9]+$/;

/**
 * Parse a comma-separated conversation-list flag, refusing the shapes that would silently mean something
 * else — the ONE such parse in this directory, used by `--channels` here and by `--thread-replies`
 * (`./threadReply.ts`), which accepts a narrower set of ids and says so in `accepts`.
 *
 * Shared rather than copied because a second copy would be a second set of refusal messages saying the same
 * thing in slightly different words, which is what `error-shape-threshold` counts and what a reader has to
 * reconcile. The flag NAME and what it accepts are values; the two failures are one shape each.
 *
 * @param accepts how the refusal names what this flag does take — e.g. `Slack conversation ids (C…, G… or D…)`
 * @param flag the flag's own spelling, so the refusal names the one the caller actually typed
 * @param id what a well-formed entry looks like for this flag
 * @param value the raw flag value
 * @returns the deduplicated ids in first-seen order, or every rejection
 */
export function parseConversationList({
  accepts,
  flag,
  id,
  value,
}: {
  accepts: string;
  flag: string;
  id: RegExp;
  value: unknown;
}): Result<readonly string[]> {
  const raw = typeof value === "string" ? value : "";
  const entries = [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
  // A valueless flag and a list of only commas are one mistake — no ids given — so they are one message.
  if (entries.length === 0) {
    return err([`${flag} requires a comma-separated list of conversation ids`]);
  }
  const malformed = entries.filter((entry) => !id.test(entry));
  if (malformed.length > 0) {
    return err([`${flag} takes ${accepts}, not ${malformed.join(", ")}`]);
  }
  return ok(entries);
}

/**
 * Resolve the two scope flags into one scope, refusing the shapes that would silently mean something else.
 *
 * @param channelsFlag the raw `--channels` value, `undefined` when the flag was not given
 * @param dmOnly whether `--dm-only` was given
 * @returns the scope, or every rejection
 */
export function parseListenScope({
  channelsFlag,
  dmOnly,
}: {
  channelsFlag: unknown;
  dmOnly: boolean;
}): Result<ListenScope> {
  if (channelsFlag === undefined) {
    return ok(dmOnly ? { kind: "dm-only" } : UNSCOPED);
  }
  if (dmOnly) {
    return err([
      "--channels and --dm-only are mutually exclusive: name a DM's D… id in --channels to scope to one DM and some channels",
    ]);
  }
  const channels = parseConversationList({
    accepts: "Slack conversation ids (C…, G… or D…)",
    flag: "--channels",
    id: CONVERSATION_ID,
    value: channelsFlag,
  });
  if (channels.isErr()) {
    return err(channels.error);
  }
  return ok({ channels: channels.value, kind: "channels" });
}

/**
 * Whether a parsed address falls inside the scope.
 *
 * @param scope the listener's scope
 * @param mention the address — a fresh tag before the responder whitelist, or a burst survivor handed off
 * @returns `true` when the listener acts on it
 */
export function mentionInScope({
  mention,
  scope,
}: {
  mention: Pick<Mention, "channel" | "surface">;
  scope: ListenScope;
}): boolean {
  switch (scope.kind) {
    case "all": {
      return true;
    }
    case "dm-only": {
      return mention.surface === "dm";
    }
    case "channels": {
      return scope.channels.includes(mention.channel);
    }
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

/**
 * The flags that reproduce a scope on a listener command line — what `listen arm` and a re-arm print.
 *
 * @param scope the scope to reproduce
 * @returns the arguments, empty for the unscoped listener
 */
export function scopeArgs({ scope }: { scope: ListenScope }): readonly string[] {
  switch (scope.kind) {
    case "all": {
      return [];
    }
    case "dm-only": {
      return ["--dm-only"];
    }
    case "channels": {
      return ["--channels", scope.channels.join(",")];
    }
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

/**
 * One human line naming the scope, for the listener's start narration and the out-of-scope drop.
 *
 * @param scope the scope to describe
 * @returns the description
 */
export function scopeLine({ scope }: { scope: ListenScope }): string {
  switch (scope.kind) {
    case "all": {
      return "every conversation the bot is in";
    }
    case "dm-only": {
      return "1:1 direct messages only (--dm-only)";
    }
    case "channels": {
      return `only ${scope.channels.join(", ")} (--channels)`;
    }
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

/**
 * Read a scope back off a JSON record, where an absent field is the unscoped listener every record written
 * before scoping existed describes.
 *
 * @param raw the record's `scope` field
 * @returns the scope, or `undefined` when the value is present but is not a scope
 */
export function scopeFromRecord({ raw }: { raw: unknown }): ListenScope | undefined {
  if (raw === undefined) {
    return UNSCOPED;
  }
  if (typeof raw !== "object" || raw === null || !("kind" in raw)) {
    return undefined;
  }
  if (raw.kind === "all" || raw.kind === "dm-only") {
    return { kind: raw.kind };
  }
  if (raw.kind !== "channels" || !("channels" in raw) || !Array.isArray(raw.channels)) {
    return undefined;
  }
  const channels: unknown[] = raw.channels;
  const valid = channels.filter(
    (channel): channel is string => typeof channel === "string" && CONVERSATION_ID.test(channel),
  );
  if (valid.length === 0 || valid.length !== channels.length) {
    return undefined;
  }
  return { channels: valid, kind: "channels" };
}
