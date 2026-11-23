/**
 * Lazy manifest for the `linear` noun — slopweaver's second outbound surface.
 *
 * `issue`, `project` and `milestone` each carry `create`/`update` (`milestone` is create-only — see
 * `../commands/linear/milestoneCore.ts`) as sub-commands rather than as separate verbs, mirroring the
 * `slack poll` precedent. Each is its own write pattern (its own schema, ledger and door request) rather
 * than a shared one, extending exactly what `issue` already proved rather than inventing a second
 * architecture — see the handover doc this shipped from for why. `comment`, `relation` and `project-update` are
 * create-only nouns added the same way: their own schema, ledger and door request, no update arm (see
 * `../../corpus/linear/writeCreateOnly.ts`'s `commentApi` for why none has one).
 *
 * **`project` and `project-update` are different nouns, and the names are Linear's, not ours.**
 * `linear project update` EDITS a project; `linear project-update create` posts a status report to it.
 * Linear's own API has the same collision — the mutation `projectUpdate` is the project editor, while
 * `projectUpdateCreate` posts a report — so renaming one here would make this surface disagree with every
 * provider document a reader might check. `initiative` and `initiative-update` are split for the identical
 * reason, against the identical provider collision, and declared in `./linearInitiative.ts`. `document` creates and re-renders a long-form page from
 * a typed form; it is declared in `./linearDocument.ts` and spread in, for the file-size cap.
 *
 * `attach` is the one verb here that writes something nobody is notified about: it puts a local image, video
 * or PDF into Linear's own asset storage and prints the URL, which a later `comment`/`issue`/`project-update`
 * form embeds as a `media` block. It needs no browser and no cookies — MEASURED, Linear's
 * `mutation.fileUpload` reserves a presigned slot under the same API key every other verb here uses, so the
 * real-Chrome route `github attach` needs has no analogue on this provider.
 *
 * `states` is the one READ verb with a side effect on disk, and it is the point rather than a convenience:
 * the issue write door refuses a `stateId` it has no evidence came from a real read of the destination team,
 * and this verb is what supplies that evidence. See `../../outbound/linear/stateCatalog.ts`.
 *
 * `labels` lists the label ids a team can apply and `label create` adds one; both are declared in
 * `./linearLabel.ts` and spread in, for the file-size cap. `briefing build` writes an end-of-day briefing's
 * bundle and reaches no provider; it is declared in `./linearBriefing.ts`.
 *
 * Every write-capable verb declares `effect: "external-write"` + `doorRouted: true`, which the door-coverage
 * ratchet verifies, and `createsWorkItem` states — per verb — whether creating one is the kind of thing a
 * team notices unprompted: true for filing an issue or a new project, false for a milestone (scheduling
 * scaffolding inside a project a human already knows about) and for every update. The command module (and
 * with it the Linear client) loads only when the verb dispatches.
 */
import { LINEAR_ATTACH_USAGE } from "../commands/linear/attachUsage.js";
import { LINEAR_PROJECT_USAGE } from "../commands/linear/projectUsage.js";
import { LINEAR_TEAM_MEMBERSHIP_USAGE } from "../commands/linear/teamMembershipUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { linearBriefingManifest } from "./linearBriefing.js";
import { linearDocumentManifest } from "./linearDocument.js";
import { linearInitiativeManifest } from "./linearInitiative.js";
import { linearIssuesManifest } from "./linearIssues.js";
import { linearLabelManifest } from "./linearLabel.js";

const USAGE =
  "usage: slopweaver linear issue <create|update> --form <json|-> [--issue-id <uuid>] [--dry-run] " +
  "[--fields-only] [--move-team] [--rewrite-filed --expect-updated-at <iso>] " +
  "[--unasked --why <text> --said <text> --by-session <text>] [--mention-id <key=id,...>] [--json] [--home <dir>]\n" +
  "  create        file a new issue; the issue id is DERIVED from the intent, so a retry after a lost\n" +
  "                response reuses it instead of filing a second ticket\n" +
  "  update        replace the description from the form you supply; only issues slopweaver created, and\n" +
  "                refused if the description changed since it last wrote\n" +
  "  --fields-only change state/priority/labels WITHOUT sending a description, so prose cannot be lost\n" +
  "  --move-team   update only: send the form's teamId, which moves the issue to that team\n" +
  "  --rewrite-filed  update only: replace the body of an issue a PERSON filed, refused unless its updatedAt\n" +
  "                is still --expect-updated-at, the instant you read it at\n" +
  "  --unasked     an act taken without asking: refuses a closure, an assignee change or a mention, and\n" +
  "                records the write in the autonomy ledger with --why, --said and --by-session\n" +
  "  --mention-id  key=<linear-user-id> pairs, comma-separated: address an `@{key}` in the body by an id\n" +
  "                you verified live, for a key the identity roster cannot resolve\n" +
  "  --dry-run     print the exact description bytes and the resolved destination, and perform no effect";

const MILESTONE_USAGE =
  "usage: slopweaver linear milestone create --form <json|-> [--dry-run] [--json] [--home <dir>]\n" +
  "  create      file a new milestone against an existing project; the milestone id is DERIVED from the\n" +
  "              intent, so a retry after a lost response reuses it instead of filing a second milestone\n" +
  "  --dry-run   print the exact resolved fields and perform no effect";

const COMMENT_USAGE =
  "usage: slopweaver linear comment create --form <json|-> [--mention-id <key=id,...>] [--dry-run] " +
  "[--json] [--home <dir>]\n" +
  "  create        post one comment on an issue, or a document (inline at `quotedText`, or a reply under\n" +
  "                `parentId`); its id DERIVES from destination and body, so the same words post once\n" +
  "  --mention-id  key=<linear-user-id> pairs, comma-separated: address an `@{key}` in the body by an id\n" +
  "                you verified live, for a key the identity roster cannot resolve\n" +
  "  --dry-run     print the exact comment bytes and the destination (a document's anchor or a reply's\n" +
  "                thread checked by a read), and perform no effect";

const PROJECT_UPDATE_USAGE =
  "usage: slopweaver linear project-update create --form <json|-> [--dry-run] [--json] [--home <dir>]\n" +
  "  create      post one STATUS UPDATE on a project — the report everyone watching it is notified of,\n" +
  "              not an edit to the project itself (that is `linear project update`)\n" +
  "  --dry-run   print the exact update bytes, the destination and the declared health, and do nothing";

const RELATION_USAGE =
  "usage: slopweaver linear relation create --form <json|-> [--dry-run] [--json] [--home <dir>]\n" +
  "  create      assert one edge (blocks | duplicate | related) between two issues; the relation id is\n" +
  "              DERIVED from the two issues and the type, so the same edge cannot be asserted twice\n" +
  "  --dry-run   print the resolved edge and which way round it reads, and perform no effect";

const STATES_USAGE =
  "usage: slopweaver linear states --team <team-key> [--limit <1..250>] [--no-record] [--json] [--home <dir>]\n" +
  "  Reads one team's workflow states and assignable members live, and RECORDS what it saw so\n" +
  "  `linear issue` will accept a stateId from it — the write door refuses any state id it has not seen\n" +
  "  --team            the team's key as it appears in an issue identifier (the `ENG` in `ENG-42`)\n" +
  "  --limit           cap the states and members requested (default 100, maximum 250)\n" +
  "  --no-record       print the read without updating what the write door will accept\n" +
  "  --json            emit one machine-readable document\n" +
  "  --home            resolve the credential from this Slopweaver state home";

const READ_USAGE =
  "usage: slopweaver linear read <linear-id-or-url> [--limit <1..100>] " +
  "[--include comments,attachments,history] [--pdf] [--json] [--home <dir>]\n" +
  "  Reads one named object from the provider now; it does not search the workspace or consult history\n" +
  "  --limit           cap each selected activity connection (default 25, maximum 100)\n" +
  "  --include         ask for activity connections by name (a document has comments only); omitted means the object alone\n" +
  "  --pdf         open the Linear-hosted files this object addresses and carry what they SAY\n" +
  "  --json            emit one machine-readable document with freshness, coverage and residue\n" +
  "  --home            resolve the credential from this Slopweaver state home";

const SEARCH_USAGE =
  "usage: slopweaver linear search <term> [--limit <1..50>] [--json] [--home <dir>]\n" +
  "  Searches current Linear issues and projects by term through Linear's own search API\n" +
  "  --limit           cap the results returned per object kind (default 10, maximum 50)\n" +
  "  --json            emit one machine-readable document listing every match\n" +
  "  --home            resolve the credential from this Slopweaver state home";

const QUERY_USAGE =
  "usage: slopweaver linear query [--kind issue|project] [--assignee me|<handle>] [--state <name>] " +
  "[--state-type <type>] [--team <KEY>] [--project <name>] [--cycle <n>] [--label <a,b>] [--priority <0..4>] " +
  "[--updated-since <iso|Nd>] [--text <substring>] [--limit <1..100>] [--no-verify] [--json] [--corpus <dir>] " +
  "[--home <dir>]\n" +
  "  Answers a FACET question from the LOCAL corpus, then verifies the page it cites against live Linear\n" +
  "  --assignee        the assignee's Linear handle, or `me` for the owner's (a project's LEAD)\n" +
  "  --state-type      triage | backlog | unstarted | started | completed | canceled\n" +
  "  --label           comma-separated; a match carries EVERY one\n" +
  "  --updated-since   an ISO date, or `<n>d` for the last n days\n" +
  "  --no-verify       skip the live check and SAY SO, rather than implying the citations were checked\n" +
  "  --corpus          scan this bronze directory instead of the state home's Linear bronze";

export const linearManifest: Readonly<Record<string, VerbManifestEntry>> = {
  attach: lazy({
    load: () => import("../commands/linear/attachRun.js").then((m) => m.linearAttachCommand),
    meta: {
      // An asset in storage notifies nobody and creates nothing to triage. It becomes visible only when a
      // later comment, issue or project-update write — each gated in its own right — embeds the URL.
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear attach upload --file shot.png --dry-run",
      parseRejectIsIoFree: true,
      summary: "Upload one local image, video or PDF to Linear's own asset storage and print the media block",
      usage: LINEAR_ATTACH_USAGE,
    },
  }),
  ...linearBriefingManifest,
  comment: lazy({
    load: () => import("../commands/linear/commentRun.js").then((m) => m.linearCommentCommand),
    meta: {
      // A comment lands on a ticket the team already has, so it creates nothing anyone has to triage — but
      // it still notifies people, which is why it is an approval-gated external write like every other send.
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear comment create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "Post one comment on a Linear issue or document from a typed form — rendered by code, through the door",
      usage: COMMENT_USAGE,
    },
  }),
  ...linearDocumentManifest,
  ...linearInitiativeManifest,
  issue: lazy({
    load: () => import("../commands/linear/run.js").then((m) => m.linearIssueCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear issue create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "File a Linear issue from a typed form — rendered by code, through the door",
      usage: USAGE,
    },
  }),
  ...linearIssuesManifest,
  ...linearLabelManifest,
  milestone: lazy({
    load: () => import("../commands/linear/milestoneRun.js").then((m) => m.linearMilestoneCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear milestone create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "File a Linear project milestone from a typed form — rendered by code, through the door",
      usage: MILESTONE_USAGE,
    },
  }),
  project: lazy({
    load: () => import("../commands/linear/projectRun.js").then((m) => m.linearProjectCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear project create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "Create or update a Linear project from a typed form — rendered by code, through the door",
      usage: LINEAR_PROJECT_USAGE,
    },
  }),
  "project-update": lazy({
    load: () => import("../commands/linear/projectUpdateRun.js").then((m) => m.linearProjectUpdateCommand),
    meta: {
      // A status update creates nothing anyone has to triage — but every member watching the project is
      // notified, which is why it is approval-gated like every other send.
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear project-update create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "Post one Linear project status update from a typed form — rendered by code, through the door",
      usage: PROJECT_UPDATE_USAGE,
    },
  }),
  query: lazy({
    load: () => import("../commands/linear/queryRun.js").then((m) => m.linearQueryCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // `external-read` because the VERIFICATION leg reads the provider. The answer itself is local: the
      // scan runs, and the page renders, with no credential at all — it just says its citations are
      // unverified rather than implying they were checked.
      effect: "external-read",
      example: "slopweaver linear query --assignee me --state-type started --json",
      parseRejectIsIoFree: true,
      summary: "Query the LOCAL Linear corpus by facet, then verify the cited page against live Linear",
      usage: QUERY_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/providerRead/run.js").then((m) => m.linearReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver linear read AIL-123 --json",
      parseRejectIsIoFree: true,
      summary: "Read one current issue, project or document with explicit activity bounds",
      usage: READ_USAGE,
    },
  }),
  relation: lazy({
    load: () => import("../commands/linear/relationRun.js").then((m) => m.linearRelationCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear relation create --form - --dry-run",
      parseRejectIsIoFree: true,
      summary: "Assert one blocks/duplicate/related edge between two Linear issues, through the door",
      usage: RELATION_USAGE,
    },
  }),
  search: lazy({
    load: () => import("../commands/linear/searchRun.js").then((m) => m.linearSearchCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: 'slopweaver linear search "source routing" --json',
      parseRejectIsIoFree: true,
      summary: "Search current issues and projects by term through Linear's own search API",
      usage: SEARCH_USAGE,
    },
  }),
  states: lazy({
    load: () => import("../commands/linear/statesRun.js").then((m) => m.linearStatesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // `external-read` despite writing a local catalog: the EFFECT class describes what the verb does to
      // the outside world, and this one only reads it. What it writes is slopweaver's own state home, the
      // same as any cursor or ledger a read leaves behind.
      effect: "external-read",
      example: "slopweaver linear states --team ENG --json",
      parseRejectIsIoFree: true,
      summary: "Read one team's workflow states and members, and record the state ids the write door accepts",
      usage: STATES_USAGE,
    },
  }),
  "team-membership": lazy({
    load: () => import("../commands/linear/teamMembershipRun.js").then((m) => m.linearTeamMembershipCommand),
    meta: {
      // A membership creates nothing anyone has to triage, but it changes who a team's members see beside
      // them, so it is an external write through the door. Preview by default: `--apply` sends.
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear team-membership join --team ENG",
      parseRejectIsIoFree: true,
      summary: "Join or leave one Linear team as the token's own user — previewed unless --apply, through the door",
      usage: LINEAR_TEAM_MEMBERSHIP_USAGE,
    },
  }),
};
