/**
 * The board row a postmortem opportunity registers — its slug, the one-line brief the seat reads, and the
 * `handover register` argv that writes it.
 *
 * Every now and then a Queue card asks the owner whether to send a reply so they can go to the meeting. So the
 * supervisor registers this row off
 * `slopweaver incident postmortems`, seats it, and the seat ends in one card — never a model launched from here
 * (rule 2).
 *
 * The slug is `postmortem-<channel id lowered>`, NEVER under `incident-`: `../orgHealth/investigation.ts` reads every
 * live `incident-` row as the fleet investigating an open incident, so a postmortem row there would tell `org-health
 * status` the fleet is looking into an incident the moment it reopened.
 *
 * Pure: an incident in, words out.
 */
import type { StatedWorkspace } from "../handover/workspace.js";

/** What every postmortem row's slug opens with. */
const POSTMORTEM_ROW_PREFIX = "postmortem-";

/**
 * The words `registerAskRow` slices off before it parses, as `./row.ts`'s `REGISTER_PROCESS_ARGV` explains.
 */
const REGISTER_PROCESS_ARGV = ["node", "slopweaver", "handover", "register"] as const;

/** The incident a postmortem row is about, as the org-health snapshot names it. */
export interface PostmortemRowIncident {
  readonly ref: string;
  readonly title: string;
  readonly channelId: string;
  readonly homepageUrl: string;
}

/**
 * The board slug for a postmortem opportunity: `postmortem-<channel id lowered>`.
 *
 * @param channelId the incident channel's id
 * @returns the slug, letters, digits and `-` only
 */
export function postmortemRowSlug({ channelId }: { channelId: string }): string {
  return `${POSTMORTEM_ROW_PREFIX}${channelId.toLowerCase()}`;
}

/**
 * The seat's brief — one line, naming the incident, its channel and page, the skill that is the procedure, and the
 * line nothing crosses. The title goes in as incident.io wrote it: the candidate read prints the register command
 * through `../lib/shellCommandLine.ts`, which quotes it.
 *
 * @param incident the resolved incident
 * @returns the ask text
 */
export function postmortemAskText({ incident }: { incident: PostmortemRowIncident }): string {
  return (
    `Put a postmortem card in front of the owner for ${incident.ref} (${incident.title}), channel ${incident.channelId}, ` +
    `${incident.homepageUrl}, by the incident skill's postmortem section (/slopweaver:incident): publish a briefing ` +
    "page so the owner knows what the room is talking about, park a reply in the incident channel tagging whoever runs the " +
    "postmortem asking to be added to it, dry-run slopweaver incident postmortem and hand the form to the chair. " +
    "Nothing is sent before the owner's yes."
  );
}

/**
 * Whose work a postmortem row is: the organisation's, since the incident is on its incident channel.
 *
 * @param incident the resolved incident
 * @returns the statement `handover register --workspace` takes
 */
function postmortemWorkspace({ incident }: { incident: Pick<PostmortemRowIncident, "ref"> }): StatedWorkspace {
  return {
    because: `a postmortem for ${incident.ref}, an incident on the organisation's incident channel`,
    workspace: "team",
  };
}

/**
 * The whole process argv `registerAskRow` writes a postmortem row from — a DISPATCH row at p2: a chance to listen and
 * learn, below a live incident's p1.
 *
 * @param incident the resolved incident
 * @param nowIso when the read saw it — the row's asked time
 * @param checkout the declared main checkout the seat's worktree is cut from
 * @param home the state home the row lands in
 * @returns the argv, opening with the four words `registerAskRow` slices off
 */
export function postmortemRegisterArgv({
  incident,
  nowIso,
  checkout,
  home,
}: {
  incident: PostmortemRowIncident;
  nowIso: string;
  checkout: string;
  home: string;
}): readonly string[] {
  return [
    ...REGISTER_PROCESS_ARGV,
    ...postmortemRegisterFlags({ incident }),
    "--asked-iso",
    nowIso,
    "--repo",
    checkout,
    "--home",
    home,
  ];
}

/**
 * The `handover register` flags that make a postmortem row, the part the candidate read prints for the chair.
 *
 * @param incident the resolved incident
 * @returns the flags, ask text included
 */
export function postmortemRegisterFlags({ incident }: { incident: PostmortemRowIncident }): readonly string[] {
  const stated = postmortemWorkspace({ incident });
  return [
    "--ask",
    postmortemAskText({ incident }),
    "--dispatch",
    "--slug",
    postmortemRowSlug({ channelId: incident.channelId }),
    "--priority",
    "p2",
    // A TAGGED registration journals the row under the board lock and refuses a second one for the slug.
    "--tag",
    "context=work",
    "--workspace",
    stated.workspace,
    "--workspace-because",
    stated.because,
  ];
}
