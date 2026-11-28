import { describe, expect, it } from "vitest";
import { ATLAS_READ_HATCHES } from "../../../hatch/atlasReadHatches.js";
import { BRIEFING_RENDER_HATCHES } from "../../../hatch/briefingRenderHatches.js";
import { BUILT_CLI_HATCHES } from "../../../hatch/builtCliHatches.js";
import { CLAUDE_SESSION_HATCHES } from "../../../hatch/claudeSessionHatches.js";
import { CLAUDE_WATCH_HATCHES } from "../../../hatch/claudeWatchHatches.js";
import { COMMAND_SCOPE_HATCHES } from "../../../hatch/commandScopeHatches.js";
import { CONTENT_INTEGRITY_HATCHES } from "../../../hatch/contentIntegrityHatches.js";
import { DATA_PUBLICATION_HATCHES } from "../../../hatch/dataPublicationHatches.js";
import { DELIVERY_WORKFLOW_HATCHES } from "../../../hatch/deliveryWorkflowHatches.js";
import { GITHUB_MERGE_HATCHES } from "../../../hatch/githubMergeHatches.js";
import { HANDOVER_ENDING_HATCHES } from "../../../hatch/handoverEndingHatches.js";
import { HANDOVER_OWNER_ACTION_HATCHES } from "../../../hatch/handoverOwnerActionHatches.js";
import { LISTEN_CONNECTION_HATCHES } from "../../../hatch/listenConnectionHatches.js";
import { LOCAL_TOOL_HATCHES } from "../../../hatch/localToolHatches.js";
import { OUTBOUND_DELIVERY_HATCHES } from "../../../hatch/outboundDeliveryHatches.js";
import { OUTBOUND_MESSAGE_HATCHES } from "../../../hatch/outboundMessageHatches.js";
import { PROOF_PATH_HATCHES } from "../../../hatch/proofPathHatches.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";
import { REPOSITORY_CONTEXT_HATCHES } from "../../../hatch/repositoryContextHatches.js";
import { RESPONDER_HATCHES } from "../../../hatch/responderHatches.js";
import { RUN_INTEGRITY_HATCHES } from "../../../hatch/runIntegrityHatches.js";
import { SLACK_POST_HATCHES } from "../../../hatch/slackPostHatches.js";
import { STATE_LIFECYCLE_HATCHES } from "../../../hatch/stateLifecycleHatches.js";
import { STATE_SNAPSHOT_HATCHES } from "../../../hatch/stateSnapshotHatches.js";
import { SUPERVISOR_SEAT_HATCHES } from "../../../hatch/supervisorSeatHatches.js";
import { SUPERVISOR_TICK_HATCHES } from "../../../hatch/supervisorTickHatches.js";
import { TOOL_ADMISSION_HATCHES } from "../../../hatch/toolAdmissionHatches.js";
import { WORKFLOW_SEQUENCE_HATCHES } from "../../../hatch/workflowSequenceHatches.js";

/*
 * Every category file `../../../hatch/registry.ts` spreads in, and the two properties each one must keep: it
 * declares exactly its own rows in register order, and it sits in the one array the `escape-hatch` gate reads
 * contiguously, between the same two neighbours. Pinning BOTH neighbours pins every seam, so a category moved,
 * dropped or reordered in the spread list fails here. Row CONTENTS stay `registry.test.ts`'s subject.
 */
const CATEGORIES: readonly {
  readonly after: string;
  readonly before: string;
  readonly hatches: readonly { readonly id: string }[];
  readonly ids: readonly string[];
  readonly name: string;
}[] = [
  {
    after: "wall",
    before: "repeat-thread-reply",
    hatches: RESPONDER_HATCHES,
    ids: ["responder-allow-open"],
    name: "RESPONDER_HATCHES",
  },
  {
    after: "answer-first",
    before: "responder-allow-open",
    hatches: SLACK_POST_HATCHES,
    ids: ["wall", "untagged-bump", "high-stakes-undefended", "high-stakes-second-post", "channel-steered-draft"],
    name: "SLACK_POST_HATCHES",
  },
  {
    after: "restore-overwrites-storage",
    before: "channel-steered-draft",
    hatches: DELIVERY_WORKFLOW_HATCHES,
    ids: ["answer-first", "vulnerability-fix-topup-gate", "stack-adopt-register-only"],
    name: "DELIVERY_WORKFLOW_HATCHES",
  },
  {
    after: "unobserved-required-context",
    before: "stack-adopt-register-only",
    hatches: STATE_SNAPSHOT_HATCHES,
    ids: ["restore-overwrites-storage", "freeze-opens-new-history"],
    name: "STATE_SNAPSHOT_HATCHES",
  },
  {
    after: "voice-rules",
    before: "freeze-opens-new-history",
    hatches: GITHUB_MERGE_HATCHES,
    ids: [
      "unobserved-required-context",
      "reverts-main",
      "private-terms-unchecked",
      "unseen-review-threads",
      "off-seat-lap",
    ],
    name: "GITHUB_MERGE_HATCHES",
  },
  {
    after: "retired-linear-team",
    before: "off-seat-lap",
    hatches: OUTBOUND_MESSAGE_HATCHES,
    ids: [
      "voice-rules",
      "voice-briefing",
      "earns-its-place",
      "redundant-quote",
      "digest-before-topup",
      "public-drip",
      "unproven-render",
      "truncated-send",
      "bare-refs",
    ],
    name: "OUTBOUND_MESSAGE_HATCHES",
  },
  {
    after: "card-framing",
    before: "bare-refs",
    hatches: OUTBOUND_DELIVERY_HATCHES,
    ids: ["retired-linear-team", "uncited-controls", "unmeasured-figures"],
    name: "OUTBOUND_DELIVERY_HATCHES",
  },
  {
    after: "session-subagent",
    before: "unmeasured-figures",
    hatches: BRIEFING_RENDER_HATCHES,
    ids: ["card-framing", "stale-cards", "stale-snapshot"],
    name: "BRIEFING_RENDER_HATCHES",
  },
  {
    after: "page-external-local-asset",
    before: "stale-snapshot",
    hatches: LOCAL_TOOL_HATCHES,
    ids: ["session-subagent", "raw", "bot-live-write", "python", "adc-signin", "raw-bash", "artifact"],
    name: "LOCAL_TOOL_HATCHES",
  },
  {
    after: "datadog-site",
    before: "artifact",
    hatches: CONTENT_INTEGRITY_HATCHES,
    ids: ["page-external-local-asset", "unreviewed-page", "memory-write", "relay-words", "memory-corpus"],
    name: "CONTENT_INTEGRITY_HATCHES",
  },
  {
    after: "proof-path",
    before: "codex-scratch-shell-guard",
    hatches: TOOL_ADMISSION_HATCHES,
    ids: ["poll", "main-checkout-write", "main-checkout-branch-switch", "protected-path", "protect-remove"],
    name: "TOOL_ADMISSION_HATCHES",
  },
  {
    after: "proof-output-in-tree",
    before: "protect-remove",
    hatches: PROOF_PATH_HATCHES,
    ids: ["proof-path"],
    name: "PROOF_PATH_HATCHES",
  },
  {
    after: "uncovered-outcome",
    before: "page-lint",
    hatches: REPOSITORY_CONTEXT_HATCHES,
    ids: ["dirty-tree", "foreign-pr", "pr-replace", "pr-evidence-loss", "foreign-cli", "old-history-push"],
    name: "REPOSITORY_CONTEXT_HATCHES",
  },
  {
    after: "talk-file-credential",
    before: "old-history-push",
    hatches: SUPERVISOR_TICK_HATCHES,
    ids: [
      "uncovered-outcome",
      "undispatched-load",
      "idle-capacity",
      "unseated-recipe-failure",
      "unread-voice-words",
      "unpicked-steers",
      "approved-draft-held",
      "unseated-stopped-recipes",
      "no-work-claim",
      "unescalated-steer-risk",
      "unescalated-fleet-health",
    ],
    name: "SUPERVISOR_TICK_HATCHES",
  },
  {
    after: "unread-checks",
    before: "intake-witness-reuse",
    hatches: SUPERVISOR_SEAT_HATCHES,
    ids: ["off-fable-chair", "metered-chair", "unrouted-seat", "unread-owner-turns", "fable-worker"],
    name: "SUPERVISOR_SEAT_HATCHES",
  },
  {
    after: "unshaped-ask",
    before: "fable-worker",
    hatches: HANDOVER_ENDING_HATCHES,
    ids: [
      "unread-checks",
      "uncarded-page",
      "park-running-seat",
      "park-standing-session",
      "park-own-landing",
      "no-lessons",
    ],
    name: "HANDOVER_ENDING_HATCHES",
  },
  {
    after: "rerun",
    before: "no-lessons",
    hatches: HANDOVER_OWNER_ACTION_HATCHES,
    ids: [
      "unshaped-ask",
      "unaligned-card",
      "ruled-reask",
      "later-owner-words",
      "held-question-owner-words",
      "plan-sign-in-without-email",
      "fleet-sign-in-card",
      "unheld-draft",
      "undrawn-draft",
      "undrawn-ask-draft",
      "seat-hand-post",
      "unseen-hand-url",
      "judged-ending-swap",
      "unmerged-check-in",
    ],
    name: "HANDOVER_OWNER_ACTION_HATCHES",
  },
  {
    after: "multiple-socket-connections",
    before: "unmerged-check-in",
    hatches: RUN_INTEGRITY_HATCHES,
    ids: ["rerun", "unreviewed", "structural-probe", "no-run-gate"],
    name: "RUN_INTEGRITY_HATCHES",
  },
  {
    after: "codex-duplicate-pass",
    before: "no-run-gate",
    hatches: LISTEN_CONNECTION_HATCHES,
    ids: ["multiple-socket-connections"],
    name: "LISTEN_CONNECTION_HATCHES",
  },
  {
    after: "stale-build",
    before: "early-codex-reset",
    hatches: ATLAS_READ_HATCHES,
    ids: ["atlas-read-unproven-empty"],
    name: "ATLAS_READ_HATCHES",
  },
  {
    after: "spent-plan",
    before: "atlas-read-unproven-empty",
    hatches: BUILT_CLI_HATCHES,
    ids: ["stale-build"],
    name: "BUILT_CLI_HATCHES",
  },
  {
    after: "large-files",
    before: "stale-build",
    hatches: CLAUDE_SESSION_HATCHES,
    ids: [
      "spent-plan",
      "unreadable-plan",
      "boot-burst",
      "spawn-backoff",
      "foreign-worktree-holder",
      "rotation-copy-retired",
      "identity-reenroll",
      "claude-mint-authorize-host",
      "early-claude-reset",
    ],
    name: "CLAUDE_SESSION_HATCHES",
  },
  {
    after: "claude-watch-admission",
    before: "early-claude-reset",
    hatches: DATA_PUBLICATION_HATCHES,
    ids: ["large-files", "atlas-evidence-loss", "atlas-row-volume"],
    name: "DATA_PUBLICATION_HATCHES",
  },
  {
    after: "local-store-elsewhere",
    before: "atlas-row-volume",
    hatches: CLAUDE_WATCH_HATCHES,
    ids: ["claude-watch-admission"],
    name: "CLAUDE_WATCH_HATCHES",
  },
  {
    after: "disk-wide-scan",
    before: "claude-watch-admission",
    hatches: STATE_LIFECYCLE_HATCHES,
    ids: ["local-store-elsewhere", "stale-store", "unlanded-migration", "stale-journal-reader", "unrooted-brief-path"],
    name: "STATE_LIFECYCLE_HATCHES",
  },
  {
    after: "run-due-deadline",
    before: "unrooted-brief-path",
    hatches: COMMAND_SCOPE_HATCHES,
    ids: ["disk-wide-scan", "unbounded-search", "home-git-implicit", "whole-tree-check"],
    name: "COMMAND_SCOPE_HATCHES",
  },
  {
    after: "datadog-monitor-iac-managed",
    before: "whole-tree-check",
    hatches: WORKFLOW_SEQUENCE_HATCHES,
    ids: ["run-due-deadline", "review-after-clean", "review-thread-delta"],
    name: "WORKFLOW_SEQUENCE_HATCHES",
  },
];

const REGISTER_IDS = ESCAPE_HATCHES.map((hatch) => hatch.id);

describe("the escape-hatch register's category files", () => {
  it("declares a category for every file the register spreads in from this split", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    expect(CATEGORIES.map((category) => category.name)).toEqual([
      "RESPONDER_HATCHES",
      "SLACK_POST_HATCHES",
      "DELIVERY_WORKFLOW_HATCHES",
      "STATE_SNAPSHOT_HATCHES",
      "GITHUB_MERGE_HATCHES",
      "OUTBOUND_MESSAGE_HATCHES",
      "OUTBOUND_DELIVERY_HATCHES",
      "BRIEFING_RENDER_HATCHES",
      "LOCAL_TOOL_HATCHES",
      "CONTENT_INTEGRITY_HATCHES",
      "TOOL_ADMISSION_HATCHES",
      "PROOF_PATH_HATCHES",
      "REPOSITORY_CONTEXT_HATCHES",
      "SUPERVISOR_TICK_HATCHES",
      "SUPERVISOR_SEAT_HATCHES",
      "HANDOVER_ENDING_HATCHES",
      "HANDOVER_OWNER_ACTION_HATCHES",
      "RUN_INTEGRITY_HATCHES",
      "LISTEN_CONNECTION_HATCHES",
      "ATLAS_READ_HATCHES",
      "BUILT_CLI_HATCHES",
      "CLAUDE_SESSION_HATCHES",
      "DATA_PUBLICATION_HATCHES",
      "CLAUDE_WATCH_HATCHES",
      "STATE_LIFECYCLE_HATCHES",
      "COMMAND_SCOPE_HATCHES",
      "WORKFLOW_SEQUENCE_HATCHES",
    ]);
  });

  it.each(CATEGORIES)("$name declares exactly its rows, in register order", ({ hatches, ids }) => {
    expect(hatches.length).toBeGreaterThan(0);
    expect(hatches.map((hatch) => hatch.id)).toEqual(ids);
  });

  it.each(CATEGORIES)("$name is spread in contiguously between $before and $after", ({ after, before, ids }) => {
    const at = REGISTER_IDS.findIndex((id) => id === ids[0]);
    expect(REGISTER_IDS.slice(at - 1, at + ids.length + 1)).toEqual([before, ...ids, after]);
  });
});
