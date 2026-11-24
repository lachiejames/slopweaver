/**
 * The plain names and purposes `./purpose.ts` reads an automation by: every atlas platform, every verb a verb-run
 * row runs, and every recipe kind. Registers whose length IS their content, kept apart from the logic that reads
 * them; the atlas names are derived from the integration registry, and the compiler fails on any kind.
 */
import { atlasNamesOf, integrations } from "../integrations/registry.js";
import type { RegisteredRecipeKind } from "../live/automation/kinds.js";
import type { AutomationPurpose } from "./purpose.js";

/**
 * An atlas platform's plain name, keyed by the registry's platform name.
 *
 * DERIVED from each integration manifest that has an atlas — its `name`, keyed by its atlas's platform — so a new
 * atlas is named by its manifest and there is no second list here to forget it in.
 */
export const ATLAS_NAMES: Readonly<Record<string, string>> = atlasNamesOf({ manifests: integrations() });

/** A verb-run row's purpose, keyed by `<noun> <verb>`. */
export const VERB_PURPOSES: Readonly<Record<string, Pick<AutomationPurpose, "name" | "forWhat" | "whenBroken">>> = {
  "compact run": {
    forWhat: "Merges each source's overlapping history files into one, so the history stays small and quick to search.",
    name: "History compaction",
    whenBroken: null,
  },
  "vulnerability-fix topup": {
    forWhat:
      "Raises a batch of fix pull requests for the open Dependabot security alerts nobody is fixing yet, opening a visible session per batch.",
    name: "Security fix top-up",
    whenBroken: "No new batch of security fixes is opened.",
  },
  "cycle reconcile": {
    forWhat:
      "Proposes which of your current-cycle Linear tickets to close and which projects are overdue an update; changes nothing.",
    name: "Cycle reconcile",
    whenBroken: null,
  },
  "github bump-drive": {
    forWhat: "Moves every open dependency bump one step closer to landing, and puts the stuck ones on the board.",
    name: "Dependency bump driver",
    whenBroken: "Ready dependency bumps wait for a hand to queue them.",
  },
  "calendar prep-due": {
    forWhat: "Puts each meeting you will talk in on the board, for a session to brief before it starts.",
    name: "Meeting prep",
    whenBroken: "You walk into a meeting with no brief.",
  },
  "gmail clear-meeting-notes": {
    forWhat: "Archives each Gemini meeting-notes email once its transcript is safely in the history.",
    name: "Meeting notes clean-up",
    whenBroken: "Meeting-notes emails stay in your inbox.",
  },
  "gmail triage": {
    forWhat: "Groups your inbox by sender so the noise can be cleared.",
    name: "Inbox triage",
    whenBroken: null,
  },
  "memory hygiene": {
    forWhat: "Checks the stored Claude memories for stale or duplicated entries and proposes what to prune.",
    name: "Memory hygiene",
    whenBroken: null,
  },
  "monitor check": {
    forWhat: "Runs the local monitors once and raises a floating note for anything that just went wrong.",
    name: "Local monitor pass",
    whenBroken: "A monitor it runs cannot raise a note while it is down.",
  },
  "reflect brief": {
    forWhat: "Ranks the day's friction from the local ledgers into at most five things worth fixing.",
    name: "Self-improvement brief",
    whenBroken: null,
  },
  "session compaction": {
    forWhat: "Measures what auto-compaction cost the fleet over the week.",
    name: "Compaction cost report",
    whenBroken: null,
  },
  "session spend": {
    forWhat: "Measures the fleet's token draw by seat and model, and prices each drain it can fix.",
    name: "Token pass",
    whenBroken: null,
  },
  "slack awaiting": {
    forWhat: "Finds the Slack threads where your ask has had no reply for two business days or more.",
    name: "Thread chase",
    whenBroken: null,
  },
  "slack owed": {
    forWhat: "Finds the Slack threads where someone else has the last word after you.",
    name: "Owed replies",
    whenBroken: null,
  },
  "store backup": {
    forWhat: "Backs up the local store.",
    name: "Store backup",
    whenBroken: "No new backup is taken, so a restore goes back to the last good one.",
  },
  "store import-fleet": {
    forWhat: "Copies the board, run journals and ledgers into the store, so they are searchable and backed up.",
    name: "Store import",
    whenBroken: "The store, and so its backups, miss board and run history since it last ran.",
  },
  "store rehearse": {
    forWhat: "Restores the newest backup into a throwaway database and checks it against the live store.",
    name: "Restore rehearsal",
    whenBroken: "Nothing has proven a backup restores since it last ran.",
  },
  "sweep board": {
    forWhat: "Checks every board row against its evidence — shipped, orphaned or superseded — deleting nothing.",
    name: "Board sweep",
    whenBroken: null,
  },
  "worktree prune": {
    forWhat: "Removes worktrees that are clean, backed up and cold.",
    name: "Worktree clean-up",
    whenBroken: null,
  },
};

/**
 * Each registered kind's plain name and the ONE sentence saying what it is and what the owner gets from it — the line an
 * Automations card opens on. Total over {@link RegisteredRecipeKind}, so a new kind fails to compile until it says.
 *
 * A card that opens on the procedure never tells the owner what the row is. A kind's registry `summary` is an
 * engineer's line about the procedure ("card the owner's Gmail inbox onto their Queue by sender group"), so it is
 * never this sentence. A more specific purpose — a corpus
 * source, an atlas, a known verb, an investigation's own question — still wins over the kind's.
 */
export const KIND_PURPOSES: Readonly<
  Record<RegisteredRecipeKind, Pick<AutomationPurpose, "name" | "forWhat" | "whenBroken">>
> = {
  "alert-summary": {
    forWhat: "Watches one monitored surface and gives you a single card on what it found.",
    name: "Alert summary",
    whenBroken: null,
  },
  "alignment-briefing": {
    forWhat: "Gives you a weekday-morning page and Queue card on what your manager will look for by end of day.",
    name: "Alignment briefing",
    whenBroken: "Your morning starts with no goal line for the day.",
  },
  "bump-fix": {
    forWhat: "Opens a session you can watch that gets red or stale dependency bumps green, so they land without you.",
    name: "Red bump fixer",
    whenBroken: "Red dependency bumps stay red until somebody picks them up.",
  },
  "call-assessment": {
    forWhat:
      "Reads each call once a day and sorts what you said into public, internal, personal or restricted, word for word, writing down what it learned.",
    name: "Call reader",
    whenBroken: "What you said on calls stays unsorted, so none of it can ever be shown beyond you.",
  },
  "datadog-alert-digest": {
    forWhat: "Gives you one card counting the Datadog alerts that fired and which of them need triage.",
    name: "Datadog alert digest",
    whenBroken: null,
  },
  "error-tracking-batch": {
    forWhat: "Opens a session you can watch that raises fix pull requests for the top Error Tracking issues.",
    name: "Error tracking batch",
    whenBroken: null,
  },
  "fleet-ceiling-report": {
    forWhat:
      "Tells you each morning whether the fleet left Claude plan capacity unused, and asks you on the Queue when more could have run.",
    name: "Fleet ceiling report",
    whenBroken: "Nothing tells you when the fleet ran below what the plans could carry.",
  },
  "hygiene-sweep": {
    forWhat: "Gives a session you can watch a daily packet of your open pull requests to land or unstick.",
    name: "Pull request hygiene sweep",
    whenBroken: "Your open pull requests wait for you to notice they are stuck.",
  },
  "inbox-triage": {
    forWhat: "Turns your Gmail inbox into Queue cards saying what to archive, reply to or send.",
    name: "Inbox triage",
    whenBroken: "Your inbox fills up unsorted.",
  },
  investigate: {
    forWhat: "Asks the bot one question on a schedule and gives you its answer.",
    name: "Scheduled investigation",
    whenBroken: null,
  },
  "linear-briefing": {
    forWhat:
      "Gives you an end-of-day page and Queue card of every Linear update you should make, applied only on your yes.",
    name: "Linear briefing",
    whenBroken: "Linear drifts from what actually happened until you update it by hand.",
  },
  "metrics-push": {
    forWhat: "Sends a number this install already measures to your metrics, so its dashboard stays current.",
    name: "Metrics push",
    whenBroken: null,
  },
  "owed-reply": {
    forWhat: "Drafts a reply for your yes to each followed Slack thread whose last word asks you something.",
    name: "Owed replies",
    whenBroken: "A question to you waits until you happen to see it.",
  },
  resync: {
    forWhat: "Brings one source's local copy up to date, so the bot answers from current history.",
    name: "Resync",
    whenBroken: null,
  },
  "thread-chase": {
    forWhat: "Drafts a chase for your yes on each Slack thread where your ask has gone two business days unanswered.",
    name: "Thread chase",
    whenBroken: "An unanswered ask of yours stays unanswered.",
  },
  "verb-run": {
    forWhat: "Runs one Slopweaver command on a schedule.",
    name: "Scheduled command",
    whenBroken: null,
  },
};
