/**
 * Everything `supervisor tick` reaches outside the filesystem, as one injected shape, so a test drives the whole
 * verb — capture, render, publish, ledger and chair gate — with plain functions. Types only.
 */
import type { Result } from "#lib/result.js";

import type { LaneShapeRead } from "../../../plans/laneShape.js";
import type { ApprovedDraftRead } from "../../../supervisor/approvedDraftGate.js";
import type { EscalationRead } from "../../../supervisor/fleetHealthGate.js";
import type { SupervisorTickRow } from "../../../supervisor/tickTypes.js";
import type { UnpickedSteerRead } from "../../../supervisor/unpickedSteerGate.js";
import type { VoiceUnreadRead } from "../../../supervisor/voiceUnreadGate.js";
import type { BriefingCommandError } from "../briefing/errors.js";
import type { ChairGateEvidence } from "./chairGateRun.js";
import type { ScratchDeps } from "./scratchDeps.js";
import type { TickCadenceReads } from "./tickRecordCadence.js";
import type { OpenHatches } from "./tickRecordGates.js";

/** What one in-process render produced. */
export interface TickRenderOutcome {
  readonly exitCode: number;
  /** The typed refusal's code, absent on success and on a refusal that only ever existed as lines. */
  readonly refusalCode: BriefingCommandError["code"] | undefined;
  /**
   * Every page the render wrote, keyed by the path it named: the checked fragment at `--out` on success, and on a
   * refusal the refused page beside it, whose path the refusal's own line prints.
   */
  readonly pages: ReadonlyMap<string, string>;
  /** Every line the render printed to its diagnostic lane. */
  readonly diagnostics: readonly string[];
}

/** Everything `supervisor tick` touches outside itself. */
export interface SupervisorTickDeps {
  /** The capture's seams — child runner, clock, readings ledger, both output lanes. */
  readonly scratch: ScratchDeps;
  /** Render and check one form through `briefing render`, in process, capturing its page and its lines. */
  readonly render: (args: { argv: readonly string[]; formText: string }) => Promise<TickRenderOutcome>;
  /** Publish the checked fragment as the `fleet-briefing` page, freeze it, and write it into the store. */
  readonly publish: (args: { home: string; fragment: string; nowIso: string }) => Promise<Result<{ url: string }>>;
  /** Append one validated row to the tick ledger. */
  readonly appendTick: (args: { row: SupervisorTickRow; home: string }) => Result<string>;
  /** Whether the ledger already holds a row with this id — the resume after a crash between append and state. */
  readonly hasTick: (args: { home: string; tickId: string }) => Promise<boolean>;
  /** Run `commit` behind the chair gate, handing it what the gate read; the gate's refusal is its only side effect. */
  readonly gate: (args: {
    argv: readonly string[];
    commit: (pass: { evidence: ChairGateEvidence }) => Promise<number>;
  }) => Promise<number>;
  /**
   * What the hand-off cadence judges: a Claude chair's boot plans, Claude Code versions and loaded canon, or a Codex
   * chair's canon since its record took the chair.
   */
  readonly cadenceReads: TickCadenceReads;
  /** The seven tick-record hatches, each read once. */
  readonly hatches: () => OpenHatches;
  /** The owner's unread call words off the supervisor cursor, aged against the tick's own instant. */
  readonly readVoiceUnread: (args: { home: string; nowIso: string }) => VoiceUnreadRead;
  /** Every steer the owner spoke over a Queue card in the last week, with the Queue's own verdict on each. */
  readonly readUnpickedSteers: (args: { home: string; nowIso: string }) => Promise<UnpickedSteerRead>;
  /** The Slack draft register, folded, for the drafts the owner already approved. */
  readonly readApprovedDrafts: (args: { home: string }) => ApprovedDraftRead;
  /** One rehearsal pass of the fleet health monitor over the live register, judged at the tick's own instant. */
  readonly readFleetHealth: (args: { home: string; nowIso: string }) => Promise<EscalationRead>;
  /** The plan lanes at the tick's own instant, which decide whether filling idle capacity is still owed. */
  readonly readLanes: (args: { home: string; nowIso: string }) => Promise<LaneShapeRead>;
  /** Whether the `unescalated-fleet-health` hatch is open — its own seam, so no other hatch opens it. */
  readonly fleetHatchOpen: () => boolean;
  /** One rehearsal pass of `steer-at-risk` over the live register, judged at the tick's own instant. */
  readonly readSteerRisk: (args: { home: string; nowIso: string }) => Promise<EscalationRead>;
  /** Whether the `unescalated-steer-risk` hatch is open — its own seam, so no other hatch opens it. */
  readonly steerRiskHatchOpen: () => boolean;
  /** Whether the `unseated-stopped-recipes` hatch is open — its own seam, so no other hatch opens it. */
  readonly stoppedRecipesHatchOpen: () => boolean;
  /** Whether the `no-work-claim` hatch is open — its own seam, so no other hatch opens it. */
  readonly noWorkClaimHatchOpen: () => boolean;
  /** The standing sweep contract the next prompt names. */
  readonly contractPath: () => string;
  /** The state home when `--home` named none. */
  readonly defaultHome: () => string;
  /** The declared main checkout of the repository this process runs from, which a stopped set's repair is cut from. */
  readonly repairCheckout: (args: { home: string }) => Result<string>;
}
