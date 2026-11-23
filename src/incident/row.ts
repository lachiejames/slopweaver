/**
 * The board row a live incident channel registers — its slug, the one-line brief the investigating seat reads, and
 * the `handover register` argv that writes it.
 *
 * Detection writes a ROW and never launches a model (rule 2): the row is a DISPATCH row, work the session the chair
 * opens picks up, so the chair boots its one Opus seat with `cmux spawn <slug> --model opus` and nothing here spawns
 * anything. The brief names the channel by id, because a channel can be renamed and the id is what every Slack read
 * and every later revision of the note keys on.
 *
 * Pure: a channel in, words out.
 */
import { slackWorkspace, workspaceRegisterArgv } from "../handover/workspace.js";
import type { Organisation } from "../organisation/core.js";
import type { IncidentChannel } from "./channel.js";

/** What every incident row's slug opens with, so the board groups them and a reader knows one at a glance. */
const INCIDENT_SLUG_PREFIX = "incident-";

/**
 * The board slug for an incident channel: `incident-<channel id lowered>`, and nothing else.
 *
 * The slug IS the row's identity, because `handover register` creates the doc exclusively on its pathname under the
 * board lock — so a slug made only of the immutable id makes "one row per channel" the board's own guarantee, even
 * for two sweeps racing. A slug carrying the channel's NAME let two overlapping sweeps that saw it before and after
 * a rename each create a row. The ask text names the channel for the reader.
 *
 * @param channel the incident channel
 * @returns the slug, letters, digits and `-` only
 */
export function incidentRowSlug({ channel }: { channel: Pick<IncidentChannel, "id"> }): string {
  return `${INCIDENT_SLUG_PREFIX}${channel.id.toLowerCase()}`;
}

/**
 * The seat's brief — one line, since `handover register` collapses whitespace — naming the channel, its reference,
 * the skill that is the whole procedure, and the two lines no investigation crosses.
 *
 * @param channel the incident channel
 * @param permalink the channel's own link, `https://<workspace>.slack.com/archives/<id>`
 * @returns the ask text
 */
export function incidentAskText({
  channel,
  permalink,
}: {
  channel: Pick<IncidentChannel, "id" | "name" | "topic">;
  permalink: string;
}): string {
  const reference = channel.topic === undefined ? "" : ` (${channel.topic})`;
  return (
    `Investigate the live incident #${channel.name}${reference}, channel ${channel.id}, ${permalink}, ` +
    "unasked, by the incident skill (/slopweaver:incident): read the channel, Datadog, the deploy and PR " +
    "timeline, support and the bug-report channels through the doors; name the stakeholders; end in ONE floating " +
    "note via `slopweaver incident note` asking whether to share. Nothing is posted and no PR is opened before " +
    "the owner's yes."
  );
}

/**
 * The words `registerAskRow` skips before it parses: it takes a whole process argv, as `handover register` itself
 * receives one, and slices these four off. A flag list handed to it without them loses `--ask` and its value,
 * `--dispatch` and `--slug` to that slice and is refused as usage.
 */
const REGISTER_PROCESS_ARGV = ["node", "slopweaver", "handover", "register"] as const;

/**
 * The whole process argv `registerAskRow` writes the incident's dispatch row from.
 *
 * @param channel the incident channel
 * @param permalink the channel's own link
 * @param nowIso when the sweep saw it — the row's asked time
 * @param checkout the declared main checkout the seat's worktree is cut from
 * @param home the state home the row lands in
 * @param organisation the organisation whose Slack hosts say whether the channel is the team's
 * @returns the argv, opening with the four words `registerAskRow` slices off
 */
export function incidentRegisterArgv({
  channel,
  permalink,
  nowIso,
  checkout,
  home,
  organisation,
}: {
  channel: Pick<IncidentChannel, "id" | "name" | "topic">;
  permalink: string;
  nowIso: string;
  checkout: string;
  home: string;
  organisation: Organisation;
}): readonly string[] {
  return [
    ...REGISTER_PROCESS_ARGV,
    "--ask",
    incidentAskText({ channel, permalink }),
    // Work the seat the chair opens picks up, nothing the owner decides — so a DISPATCH row, as `automation seat`'s is.
    "--dispatch",
    "--slug",
    incidentRowSlug({ channel }),
    // A live incident outranks routine work on the board, and is still below a p0 the owner set by hand.
    "--priority",
    "p1",
    // Acme work, so the console places it there. And a TAGGED registration is what makes the board refuse a
    // second row for this slug: it journals the row inside the board lock and checks the slug's journal and archive
    // under that same lock, while an untagged one checks only the live path. A row moved to the archive by hand
    // after a sweep's pre-check is therefore still refused.
    "--tag",
    "context=work",
    // Read off the channel's own host, as the console reads a permalink: a channel in any other Slack states none.
    ...workspaceRegisterArgv({ stated: slackWorkspace({ organisation, permalink, what: "a live incident" }) }),
    "--asked-iso",
    nowIso,
    "--repo",
    checkout,
    "--home",
    home,
  ];
}

/** One DNS label: letters, digits and inner hyphens, never a hyphen at either end, at most 63 characters. */
const WORKSPACE_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";

/**
 * Whether a board row's ask is the one `incidentAskText` writes for this channel — how a re-sweep, or the sweep that
 * lost a create race, recognises its own row. It matches the whole phrase the ask carries, the id followed by that
 * id's own Slack permalink (`https://<workspace>[.enterprise].slack.com/archives/<id>`) and `unasked,`, so prose that merely
 * mentions "channel <id>," or links some other host's `/archives/<id>` in a hand-made doc at the same slug is an
 * occupant refused by name, never mistaken for the row. The workspace part must be a valid DNS
 * label, so `https://-.slack.com` is no permalink either.
 *
 * @param ask the existing row's ask text
 * @param channelId the channel the sweep is registering
 * @returns true when the ask is this channel's incident row
 */
export function askNamesChannel({ ask, channelId }: { ask: string; channelId: string }): boolean {
  const id = channelId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `channel ${id}, https://${WORKSPACE_LABEL}(?:\\.enterprise)?\\.slack\\.com/archives/${id}, unasked,`,
    "u",
  ).test(ask);
}
