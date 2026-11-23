/**
 * Which nouns of this build READ A SOURCE, and the rule that every one of them must be routable.
 *
 * ## Why a declared partition rather than a criterion computed off the manifest
 *
 * The obvious mechanical criterion is `CommandMeta.effect === "external-read"`, and it does not work in
 * either direction. MEASURED on this build: 80 verb entries declare `external-read`, and they
 * include `worktree list`, `cmux processes` and `github checks` — things no routing judgement consults —
 * while `slack read-thread`, `slack read-file`, `store cite`, `store read`, `store query`, `knowledge recall` and
 * `identity resolve` are `local-state` or `none` and are exactly the readers this file exists to keep
 * routable. `effect` answers "what does this do to the world", which is a different question from "is this
 * somewhere an investigation goes to find something out".
 *
 * So the classification is DECLARED — here for a noun no integration owns, and on the integration's manifest
 * (`noun`) for one it does. What stops it becoming a list somebody forgets is that it is TOTAL:
 * every noun in `NOUN_GROUPS` lands in exactly one of the two lists below, the not-a-source side carries a
 * REASON, and `unit/canon/sourceNouns.test.ts` fails on a noun in neither, a noun in both, and a
 * source-reading noun no capability row reaches. A new noun therefore cannot land unclassified, and
 * classifying one is a single line — which is the whole difference from the failure this closes, where a
 * source became routable only when somebody remembered to hand-author a row into an install's own
 * `capability-profile.json`. `./atlasCapability.ts` carries the measurement; the atlas half of the problem
 * is derived rather than declared, and this file is what holds the rest of it down.
 *
 * ## What "reached by a row" means, and why it is not just the argv
 *
 * Several rows name a cheap SCOPE command and put the real reading verbs in `coverage.detail` — the pattern
 * `drive`, `gmail`, `calendar` and `browser` established, because a verb taking a URL or a search
 * expression cannot have a natural-language question substituted into it. `github-live` runs
 * `slopweaver connect github --check` and names `slopweaver github read|search` in its coverage. A check
 * that read only the argv would call the `github` noun unroutable while a reading session is being told
 * exactly how to reach it, so {@link nounsReachedBy} reads the row's whole text.
 */
import { registeredIntegrations } from "../integrations/registry.js";
import { integrationNounsOf } from "../integrations/routing.js";
import type { SourceCapability } from "./profile.js";

/** One noun that reads no source a routing judgement would consult, and why it does not. */
export interface NotASourceNoun {
  readonly noun: string;
  /** One clause: what this noun does instead, or which noun answers the reading question for it. */
  readonly reason: string;
}

/** The integrations' own halves of the partition, each noun being a manifest's id and declared on that manifest. */
const INTEGRATION_NOUNS = integrationNounsOf({ manifests: registeredIntegrations() });

/** The source-reading nouns no integration owns. */
const LOCAL_SOURCE_READING_NOUNS: readonly string[] = [
  "atlas",
  "audit",
  "browser",
  "catalog",
  "connect",
  "fleet",
  "handover",
  "identity",
  "knowledge",
  "queue",
  "spend",
  "store",
  "transcripts",
];

/**
 * The nouns a routing judgement may be sent to, each of which MUST be reached by some capability row, sorted.
 *
 * `connect` is on this list because a preflight is genuinely how a session learns whether a provider leg
 * can answer at all, and four rows run it as their scope command.
 */
export const SOURCE_READING_NOUNS: readonly string[] = [
  ...LOCAL_SOURCE_READING_NOUNS,
  ...INTEGRATION_NOUNS.sourceReading,
].toSorted();

/**
 * The not-a-source nouns no integration owns, with the reason each is not a source.
 *
 * Three shapes recur and are worth naming once rather than in every row: a noun that WRITES (to a provider,
 * to a page, to a ledger), a noun that is fleet MACHINERY (it runs the system rather than telling you
 * something about the world), and a noun whose reads are already answered through another noun's row — an
 * atlas sync is the clearest case, since `atlas <platform>` is what reads what it wrote.
 */
const LOCAL_NOT_A_SOURCE_NOUNS: readonly NotASourceNoun[] = [
  {
    noun: "access-review",
    reason: "joins four atlases into the ISO access-review report; `atlas <platform>` is the read of each",
  },
  {
    noun: "alias",
    reason: "provisions the mailboxes a plan signs up on; `atlas cloudflare` is the read of what the zone holds",
  },
  { noun: "autonomy", reason: "writes and reads the fleet's own act ledger, not a source about the world" },
  { noun: "briefing", reason: "renders the fleet-briefing page from a form; the state it renders has its own rows" },
  { noun: "checkout", reason: "keeps the main checkouts current — machinery, and it reads no source" },
  { noun: "claude", reason: "gauges the owner's own plan budgets, which is fleet housekeeping" },
  { noun: "console", reason: "runs the console's own read verbs in one process; each verb's register is its own row" },
  { noun: "cmux", reason: "spawns and closes visible sessions; what they are doing is the board's row" },
  { noun: "codex", reason: "the second brain's plan and review passes, not a source" },
  { noun: "compact", reason: "merges bronze window files; the corpus it compacts is the `corpus` row" },
  { noun: "cycle", reason: "proposes cycle hygiene from Linear state the `linear` row already reaches" },
  { noun: "derive", reason: "builds the directory and graph; `identity` is the row that reads them" },
  { noun: "desktop", reason: "builds and installs the desktop app on this Mac; it reads no source" },
  { noun: "dev", reason: "the repository's own PR gate" },
  { noun: "distil", reason: "writes gold from the corpus; the corpus is the `corpus` row" },
  { noun: "doctor", reason: "environment preflight for this install" },
  { noun: "events", reason: "the supervisor stream's own publications — fleet machinery" },
  { noun: "fresh-cut", reason: "writes and verifies a single-commit copy of this repository's own tree" },
  {
    noun: "gcp",
    reason:
      "the door a seat's Google Cloud writes go through, and the single-resource describes they plan from; no capability row routes an investigation to it yet",
  },
  {
    noun: "google",
    reason: "whether this machine's Google Cloud credential works — a prerequisite check, not a source",
  },
  {
    noun: "gold",
    reason: "records what a silver or bronze merge still owes; the pull request it names is the `github` row",
  },
  { noun: "grant", reason: "records and performs a journalled grant; it is an authority path, not a source" },
  {
    noun: "hand",
    reason:
      "records the steps only the owner's hands can take and surfaces them; what each one unblocks is its own row",
  },
  { noun: "hatch", reason: "takes and reads a journalled escape hatch" },
  {
    noun: "home",
    reason:
      "takes the rebuildable bytes out of this machine's own state home; every file it reads is one the fleet wrote",
  },
  {
    noun: "incident",
    reason: "judges incident channels from the stored channel list and posts a hand note; the channel is `slack`",
  },
  { noun: "init", reason: "scaffolds the state home" },
  { noun: "listen", reason: "answers Slack tags; the reading it does goes through the `slack` row" },
  { noun: "machine", reason: "gauges of the host this runs on — fleet housekeeping" },
  { noun: "memory", reason: "checks a Claude auto-memory corpus for defects; `knowledge` is the register" },
  {
    noun: "monitor",
    reason: "watches this machine's own ledgers and fires a hand card; each condition's subject has its own row",
  },
  { noun: "onboard", reason: "renders the cold-start plan and the Slack app manifest" },
  { noun: "org", reason: "writes and shows which organisation this install works for — configuration, never a source" },
  {
    noun: "org-health",
    reason: "snapshots the incident channel for the `org-health` monitor; reading a Slack channel is the `slack` row",
  },
  { noun: "page", reason: "publishes the page a session ends in" },
  { noun: "pane", reason: "serves the local screen from fleet state the `fleet` row already reaches" },
  {
    noun: "pdf",
    reason:
      "extracts the text of a file a provider's door already put on disk; the provider that served it is " +
      "the source row, and the `attachments` row names both halves",
  },
  { noun: "perf", reason: "gauges what the fleet itself is costing — fleet housekeeping, like the machine gauges" },
  {
    noun: "plans",
    reason:
      "holds the register of destinations a session can be seated on — fleet housekeeping, like `claude`, " +
      "and what each plan can still spend is the `claude` gauge's row",
  },
  { noun: "policy", reason: "renders and reviews a policy change; `atlas vanta` is the read" },
  { noun: "profile", reason: "curates what is known about the owner and their colleagues; `identity` is the roster" },
  {
    noun: "private-terms",
    reason: "keeps the owner's private words and the review a held write waits on; it reads no source",
  },
  { noun: "proof", reason: "captures golden-proof evidence for a pull-request description" },
  { noun: "proposal", reason: "composes and publishes a proposal; `notion` is where it lands" },
  { noun: "protect", reason: "keeps the owner's register of paths no session may write or read; it reads no source" },
  { noun: "reading", reason: "keeps the last document a slow verb printed, for a page to show; the verb is the read" },
  { noun: "automation", reason: "the automations — which are due, claimed once, run here or seated as a session" },
  { noun: "reflect", reason: "reads how this system behaved; `transcripts` is the row over that record" },
  { noun: "ruling", reason: "keeps the owner's register of standing rulings by category; it reads no source" },
  { noun: "refresh", reason: "ingests into bronze; the corpus it feeds is the `corpus` row" },
  { noun: "responders", reason: "writes the list gating who may address the bot" },
  { noun: "route", reason: "plans which sources to consult — it is the planner, never one of them" },
  { noun: "secrets", reason: "persists connector tokens under the state home" },
  { noun: "seed", reason: "seeds a synthetic demo corpus" },
  { noun: "session", reason: "the supervisor's own ledger of chats it knows about" },
  { noun: "session-start", reason: "ranks what is waiting on the owner, from rows the board already carries" },
  { noun: "slice", reason: "pins a subset of a source and proves nothing was lost" },
  { noun: "sop", reason: "composes and publishes an SOP; `notion` is where it lands" },
  { noun: "subset", reason: "slices the corpus into a smaller home for a fast loop" },
  { noun: "supervisor", reason: "the supervisor role's own rendered prompt and state caps" },
  { noun: "sweep", reason: "classifies and prunes the board's own rows; `handover` is the read over them" },
  {
    noun: "talk",
    reason:
      "the console voice's own verbs — a voice session, bounded reads of THIS checkout and the board, and a relay of the steer the owner talked through",
  },
  { noun: "turn", reason: "answers one Slack mention; it CONSUMES this whole roster rather than being on it" },
  {
    noun: "value",
    reason:
      "samples the fleet's own finished asks for the owner's word on each; the board and ledgers are what it reads",
  },
  { noun: "velocity", reason: "a pace read off git and the local ledgers — fleet housekeeping" },
  { noun: "vulnerability-fix", reason: "the vulnerability-fix flywheel; `github` reaches the alerts it works from" },
  { noun: "wait", reason: "the one wait contract, as a verb" },
  {
    noun: "witness",
    reason:
      "boots and settles the visible worker that checks another bot's claim, and revises its own post; its worker reads the sources",
  },
  {
    noun: "workstreams",
    reason: "keeps the owner's outcomes and their cited timelines for the console page; a register the owner writes",
  },
  { noun: "worktree", reason: "creates, inspects and retires worktrees" },
  { noun: "write", reason: "changes state at a provider — a write path by construction" },
];

/** Every other noun, with the reason it is not a source, sorted by noun. */
export const NOT_A_SOURCE_NOUNS: readonly NotASourceNoun[] = [
  ...LOCAL_NOT_A_SOURCE_NOUNS,
  ...INTEGRATION_NOUNS.notASource,
].toSorted((left, right) => left.noun.localeCompare(right.noun));

/** Every `slopweaver <noun>` invocation a row's argv or its own prose spells out. */
const INVOCATION = /(?<![\w-])slopweaver ([a-z][a-z0-9-]*)(?![\w-])/g;

/**
 * Every noun the capability table tells a reading session how to reach.
 *
 * The row's whole text is read, not just its argv — see this file's header on the scope-command pattern.
 *
 * @param capabilities the declared table, before any materialisation replaces the `slopweaver` token
 * @returns the nouns named, deduplicated
 */
export function nounsReachedBy({ capabilities }: { capabilities: readonly SourceCapability[] }): ReadonlySet<string> {
  const reached = new Set<string>();
  for (const capability of capabilities) {
    const text = [capability.command.join(" "), capability.coverage.detail, capability.what].join(" ");
    for (const match of text.matchAll(INVOCATION)) {
      reached.add(match[1]!);
    }
  }
  return reached;
}

/**
 * The nouns this build has that neither list classifies — the drift the partition exists to refuse.
 *
 * @param nouns every noun the verb registry declares
 * @returns the unclassified nouns, sorted
 */
export function unclassifiedNouns({ nouns }: { nouns: readonly string[] }): readonly string[] {
  const declared = new Set([...SOURCE_READING_NOUNS, ...NOT_A_SOURCE_NOUNS.map((row) => row.noun)]);
  return nouns.filter((noun) => !declared.has(noun)).toSorted();
}

/**
 * The nouns both lists claim, and the nouns neither list's own build still has.
 *
 * @param nouns every noun the verb registry declares
 * @returns the nouns classified twice, and the classified nouns this build no longer registers
 */
export function misclassifiedNouns({ nouns }: { nouns: readonly string[] }): {
  readonly both: readonly string[];
  readonly gone: readonly string[];
} {
  const sources = new Set(SOURCE_READING_NOUNS);
  const registered = new Set(nouns);
  const classified = [...SOURCE_READING_NOUNS, ...NOT_A_SOURCE_NOUNS.map((row) => row.noun)];
  return {
    both: NOT_A_SOURCE_NOUNS.filter((row) => sources.has(row.noun))
      .map((row) => row.noun)
      .toSorted(),
    gone: classified.filter((noun) => !registered.has(noun)).toSorted(),
  };
}

/**
 * The source-reading nouns no capability row reaches — a source this build has and cannot route to.
 *
 * @param capabilities the declared table, atlas rows already derived
 * @returns the unroutable source nouns, sorted
 */
export function unroutableSourceNouns({
  capabilities,
}: {
  capabilities: readonly SourceCapability[];
}): readonly string[] {
  const reached = nounsReachedBy({ capabilities });
  return SOURCE_READING_NOUNS.filter((noun) => !reached.has(noun)).toSorted();
}

/**
 * Every `` `<word>` row `` reference a reason makes, in the order the reasons declare them.
 *
 * Split out from {@link unresolvedRowReferences} so the matcher is provable on its own: the criterion is
 * the BACKTICKED word immediately before the literal word `row`, which is how every reference above is
 * written, and a reason mentioning a row any other way is deliberately outside it rather than guessed at.
 *
 * @returns every referenced word, in the order the reasons declare them and with duplicates kept
 * @internal
 */
export function rowReferencesIn({ reasons }: { reasons: readonly string[] }): readonly string[] {
  return reasons.flatMap((reason) => [...reason.matchAll(/`([a-z0-9-]+)` row/g)].map((match) => match[1]!));
}

/**
 * The row ids a not-a-source reason POINTS AT that no capability row answers to.
 *
 * A reason on the not-a-source side earns its place by naming where the reading question goes instead, and
 * that name is the one part of it a machine can check. MEASURED on this file the day the check was written:
 * of six `` `<id>` row `` references, `corpus` matched a row id exactly, `fleet`, `github`, `linear` and
 * `slack` matched `fleet-status`, `github-live`, `linear-live` and `slack-live` by prefix, and
 * `attachments` matched NOTHING — canon promising a row that had never been written, which is what sent a
 * reader looking for a leg that did not exist. Repro: `grep -oE '\`[a-z0-9-]+\` row' src/route/sourceNouns.ts`.
 *
 * So resolution is exact OR hyphen-boundary prefix, and that calibration is the rule rather than a
 * convenience. Demanding an exact id would redden four references a reader resolves instantly, which is a
 * gate that gets reworded away instead of obeyed; accepting any substring would let `attach` resolve to
 * nothing useful. This is the one member of the stale-claim class that is a NAME, and a name is checkable.
 *
 * @param reasons the not-a-source reasons to read, defaulting to this file's own declared partition
 * @param capabilities the table whose ids a reference must land on
 * @returns the referenced words that resolve to no row, sorted
 */
export function unresolvedRowReferences({
  capabilities,
  reasons = NOT_A_SOURCE_NOUNS.map((row) => row.reason),
}: {
  capabilities: readonly SourceCapability[];
  reasons?: readonly string[];
}): readonly string[] {
  const ids = capabilities.map((capability) => capability.id);
  const resolves = ({ word }: { word: string }): boolean => ids.some((id) => id === word || id.startsWith(`${word}-`));
  return rowReferencesIn({ reasons })
    .filter((word) => !resolves({ word }))
    .toSorted();
}
