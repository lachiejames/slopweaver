/**
 * Which Slack channels the owner's spoken words name, and what that means for a held draft — pure.
 *
 * MEASURED: walking a held bot draft parked for a programme channel, the owner said to send it to the security
 * channel instead, naming that channel aloud. Nothing between those words and the release read a channel out of them,
 * the chair re-cut it "same channel", and a seat released it into the programme channel in public. So a relay about a
 * held draft reads the channels the words name against the draft's own, and a different one becomes a destination
 * steer on the draft (`./draftRegister.ts`'s `steered` event) that a release outside it refuses
 * (`./draftSteerGate.ts`).
 *
 * ## The roster is the register's own channels
 *
 * There is no complete offline Slack channel directory on this machine: discovery reads names live and keeps none.
 * Every parked row carries its channel's id and, where the recording read could name it, its name, so the distinct
 * pairs across the register are an id-resolving roster that needs no network. MEASURED: 30 parked rows name the
 * security channel. Repro, with `CHANNEL` set to that channel's name:
 * `grep -c "\"channelName\":\"$CHANNEL\"" "$SLOPWEAVER_HOME/queue/slack-drafts.jsonl"`. The residue, stated: a channel
 * no draft was ever parked for is not recognised, so a steer to it is not recorded — the chair still reads the words
 * on the row.
 *
 * ## Recognition is exact, never fuzzy
 *
 * The words are lowercased and every character but a letter or digit becomes a space, so `#dev-alerts`, `Dev
 * alerts` and `dev-alerts channel` read alike. A name is recognised when its `-`/`_` parts appear as consecutive
 * words. A ONE-part name (`general`, `random`) is ordinary speech too, so it is recognised only written `#name` or
 * followed by the word `channel`.
 *
 * ## A URL in the words names no channel
 *
 * MEASURED: asking the voice to read a bot reply together, the owner pasted its permalink,
 * `…slack.com/archives/C0SYN000002/p…`, and the id inside it read as naming #dev-team, so a held draft was steered
 * off #team-design and its re-cut's real release refused. A link is something the owner points at, never where a
 * draft goes, so every URL is blanked before the words are read (`withoutUrls`), the channel name in a path such as
 * `github.com/…/dev-alerts/` included. A typed `<#C…>` mention is not a URL and still names its channel. Repro:
 * `grep -n '"heard":"[^"]*https://' "$SLOPWEAVER_HOME/queue/slack-drafts.jsonl"`.
 *
 * A steer already recorded that way is not rewritten: the fold passes over one whose whole words carry its channel only
 * as an id inside a Slack permalink ({@link channelSteerIsVoid}), so a re-cut releases into #team-design again. The
 * residue, stated: a link pasted on purpose to say where a draft goes ("post it where this thread is") steers
 * nothing; and a steer the old reading recorded off a channel NAME in a link path, or off an id in any link but a
 * Slack permalink, stays in force, the hold side.
 */
import type { DraftChannelSteer, SlackDraftChannel, SlackDraftItem } from "./draftRegister.js";

/** One channel the register knows by both id and name. */
export type RosterChannel = SlackDraftChannel;

/**
 * The channels the register can name: each parked row's channel id with the name its recording read, newest name per
 * id first-seen in newest-first order. An id no row ever named stands under the id itself, so a typed `<#C…>` still
 * names it; a recorded name for the same id always wins over that.
 *
 * @param items every folded row, newest first as the fold returns them
 * @returns one entry per channel id the register holds
 */
export function draftChannelRoster({ items }: { items: readonly SlackDraftItem[] }): readonly RosterChannel[] {
  const byId = new Map<string, RosterChannel>();
  for (const item of items) {
    const { channel, channelName } = item.draft;
    if (channelName === undefined || channelName === "" || byId.has(channel)) {
      continue;
    }
    byId.set(channel, { id: channel, name: channelName });
  }
  for (const item of items) {
    const { channel } = item.draft;
    if (!byId.has(channel)) {
      byId.set(channel, { id: channel, name: channel });
    }
  }
  return [...byId.values()];
}

/**
 * Every roster channel the owner's words name, in roster order, each once — by name, or by its Slack id as a typed
 * `<#C…>` mention carries it.
 *
 * @param words the owner's words, as heard or typed
 * @param roster the channels the register can name
 * @returns the channels named
 */
export function channelsNamedIn({
  roster,
  words,
}: {
  roster: readonly RosterChannel[];
  words: string;
}): readonly RosterChannel[] {
  return namedInText({ roster, text: withoutUrls({ text: words }) });
}

/**
 * Whether a recorded steer is VOID: its words are whole, not cut at the register's bound, they name none of its
 * recorded channels by NAME anywhere, and every place they carry one of its ids lies inside a Slack message permalink
 * ({@link SLACK_PERMALINK}). That is exactly the paste in this module's header,
 * `…slack.com/archives/C0SYN000002/p…&cid=C0SYN000002`, and nothing wider: the criterion is the incident's own shape
 * rather than a guess at where a link ends, which counterexamples showed can always be welded past.
 * Anything else stays in force: a name anywhere, a URL path's included; an id in any other link or none; a typed
 * `<#C…>` mention; words naming its channel no way at all (`dev-alertszoommtg://…`), since nothing says
 * why it was recorded; and a cut excerpt (ending `…`), since the naming words may sit past the cut. A false hold costs
 * a chair line, a false release is the public-channel incident in this module's header.
 *
 * @param steer the recorded steer, read against its own recorded channels rather than today's roster
 * @returns `true` when the fold must pass the steer over
 */
export function channelSteerIsVoid({ steer }: { steer: DraftChannelSteer }): boolean {
  const { channels, heard } = steer;
  if (heard.endsWith("…")) {
    return false;
  }
  const lowered = heard.toLowerCase();
  const tokens = wordTokens({ text: lowered });
  if (channels.some((channel) => namesChannel({ lowered, name: channel.name, tokens }))) {
    return false;
  }
  const spans = [...heard.matchAll(SLACK_PERMALINK)].map((match) => ({
    end: match.index + match[0].length,
    start: match.index,
  }));
  const ids = channels.flatMap((channel) => [
    ...heard.matchAll(new RegExp(`(?<![A-Za-z0-9])${channel.id}(?![A-Za-z0-9])`, "giu")),
  ]);
  return ids.length > 0 && ids.every((id) => spans.some((span) => id.index >= span.start && id.index < span.end));
}

/**
 * A Slack message permalink exactly: a workspace host (an `.enterprise` grid's included), `/archives/<id>`, an optional
 * `/p<digits>` and an optional query of the characters Slack writes there (`thread_ts=…&cid=…`). It stops at the first
 * other character, so a `)`, `,` or anything typed after it is outside.
 */
const SLACK_PERMALINK = /[a-z0-9-]+(?:\.enterprise)?\.slack\.com\/archives\/[A-Z0-9]+(?:\/p\d+)?(?:\?[\w.=&%-]*)?/giu;

/** Every roster channel a text names, by name or by id as a whole token, with no URL blanked. */
function namedInText({ roster, text }: { roster: readonly RosterChannel[]; text: string }): readonly RosterChannel[] {
  const lowered = text.toLowerCase();
  const tokens = wordTokens({ text: lowered });
  return roster.filter(
    (channel) =>
      namesChannel({ lowered, name: channel.name, tokens }) ||
      new RegExp(`(?<![A-Za-z0-9])${channel.id}(?![A-Za-z0-9])`, "iu").test(text),
  );
}

/** The words with every URL blanked to one space, by the criterion in this module's header. */
function withoutUrls({ text }: { text: string }): string {
  return text.replace(URL_RUN, (_url: string, scheme: string | undefined) => {
    if (scheme === undefined) {
      return " ";
    }
    const welded = WELDED_SCHEME.exec(scheme);
    if (welded === null) {
      return `${scheme} `;
    }
    return `${scheme.slice(0, welded.index)} `;
  });
}

/**
 * A URL as words carry one: any scheme (`ssh://` too), `www.` or a Slack workspace host (one label, an
 * `.enterprise` grid's included, so `alerts.acme.slack.com/` keeps the word a full stop welded), running to
 * whitespace, a Slack `<url|label>` edge so the typed label stays, or a quote or backtick, which a link never
 * carries unescaped, so `"https://…"#general` keeps the mention after it. The scheme is captured because
 * a paste on a call welds to the word ahead (`thinkhttps://…`), so the scheme run starts at that word.
 */
const URL_RUN = /(?:([a-z][a-z0-9+.-]*):\/\/|www\.|[a-z0-9-]+(?:\.enterprise)?\.slack\.com\/)[^\s<>|"'`“”‘’]*/giu;

/**
 * A scheme a pasted link carries, at the END of a scheme run: what precedes it is the word the paste welded to, kept,
 * so `dev-alertshttps://…` still names #dev-alerts. An unknown scheme's run is kept whole as words, since a
 * scheme is never where a link points: `general channel://…` still names #general. A `.`, `-` or `+`
 * ahead of the known scheme is read as punctuation, not as part of a longer scheme, since the two are the same
 * bytes and a false release is the worse error.
 */
const WELDED_SCHEME = /(?:https?|ftp|file|slack)$/iu;

/** What the owner's words mean for one held draft's destination. */
export type DraftChannelReading =
  /** The words named no channel other than the one the row is parked for. */
  | { readonly kind: "unmoved" }
  /** The words named channels other than the row's own: the release may go only into one of these. */
  | { readonly kind: "steered"; readonly channels: readonly RosterChannel[] };

/**
 * Read the owner's words against one held draft's own channel. Every named channel but the row's own is a destination
 * the owner asked for; two or more are kept as a set rather than one picked, so the release is held off the original
 * channel either way and the chair chooses between them.
 *
 * @param named the channels the words name ({@link channelsNamedIn})
 * @param current the channel id the row is parked for
 * @returns whether the words steer the row, and to which channels
 */
export function draftChannelReading({
  current,
  named,
}: {
  current: string;
  named: readonly RosterChannel[];
}): DraftChannelReading {
  const channels = named.filter((channel) => channel.id !== current);
  if (channels.length === 0) {
    return { kind: "unmoved" };
  }
  return { channels, kind: "steered" };
}

/** Lowercase letter-and-digit runs, in order. */
function wordTokens({ text }: { text: string }): readonly string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter((token) => token !== "");
}

/** Whether lowered words name one channel, by the criterion in this module's header. */
function namesChannel({
  lowered,
  name,
  tokens,
}: {
  lowered: string;
  name: string;
  tokens: readonly string[];
}): boolean {
  const parts = wordTokens({ text: name.toLowerCase() });
  if (parts.length === 0) {
    return false;
  }
  if (parts.length === 1) {
    return hashTagged({ lowered, name: name.toLowerCase() }) || followedBy({ parts, tokens, word: "channel" });
  }
  return startsOf({ parts, tokens }).length > 0;
}

/** Whether lowered words carry `#name` as a whole word — `#general`, never `#generally`. */
function hashTagged({ lowered, name }: { lowered: string; name: string }): boolean {
  let from = lowered.indexOf(`#${name}`);
  while (from !== -1) {
    const after = lowered.charAt(from + name.length + 1);
    if (!/[\p{L}\p{N}_-]/u.test(after)) {
      return true;
    }
    from = lowered.indexOf(`#${name}`, from + 1);
  }
  return false;
}

/** Every index at which `parts` appear as consecutive tokens. */
function startsOf({ parts, tokens }: { parts: readonly string[]; tokens: readonly string[] }): readonly number[] {
  const starts: number[] = [];
  for (let start = 0; start + parts.length <= tokens.length; start += 1) {
    if (parts.every((part, offset) => tokens[start + offset] === part)) {
      starts.push(start);
    }
  }
  return starts;
}

/** Whether `parts` appear consecutively and are directly followed by `word`. */
function followedBy({
  parts,
  tokens,
  word,
}: {
  parts: readonly string[];
  tokens: readonly string[];
  word: string;
}): boolean {
  return startsOf({ parts, tokens }).some((start) => tokens[start + parts.length] === word);
}
