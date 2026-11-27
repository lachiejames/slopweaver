/**
 * The types the `supervisor tick` harness in `harness.ts` hands the cases beside it: what one fake run recorded, and
 * the options a case passes to build one.
 */
import type { ChairGateEvidence } from "../../../../../../cli/commands/supervisor/chairGateRun.js";
import type { SupervisorTickDeps } from "../../../../../../cli/commands/supervisor/tickDeps.js";
import type { EscalationRead } from "../../../../../../supervisor/fleetHealthGate.js";
import type { SupervisorTickRow } from "../../../../../../supervisor/tickTypes.js";
import type { JudgedSteer } from "../../../../../../supervisor/unpickedSteerGate.js";
import type { UnreadWord } from "../../../../../../talk/unreadWords.js";

/** What one fake run recorded. */
export interface Fake {
  readonly deps: SupervisorTickDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly published: string[];
  readonly appended: SupervisorTickRow[];
  readonly renders: (readonly string[])[];
  /** The text of the `--your-list` file each render was handed, read while that render ran. */
  readonly renderedLists: string[];
  /** The first argv word of every child the close launched. */
  readonly launched: string[];
  /** Every child's whole argv, in launch order. */
  readonly children: (readonly string[])[];
  /** The `SLOPWEAVER_HOME` each child was handed, in launch order; `undefined` when it was handed no environment. */
  readonly childHomes: (string | undefined)[];
}

/** Every option of a fake run with its default applied; only the render seam may stay unset. */
export type FakeValues = Required<Omit<FakeOptions, "render">> & { render: SupervisorTickDeps["render"] | undefined };

/** What a case may change about one fake run; every field has a default in `fakeValues`. */
export interface FakeOptions {
  stopped?: string;
  stoppedHatch?: boolean;
  spawnFails?: boolean;
  evidence?: ChairGateEvidence;
  cadenceReads?: SupervisorTickDeps["cadenceReads"];
  gauge?: string;
  /** What the open's `session close-done --json` capture prints — nothing unless a case reads a sweep. */
  closeDone?: string;
  duringPublish?: () => void;
  duringRefresh?: () => void;
  publishFails?: boolean;
  gateRefuses?: boolean;
  ledger?: SupervisorTickRow[];
  voiceNeverMarked?: boolean;
  voiceWords?: readonly UnreadWord[];
  steers?: readonly JudgedSteer[];
  fleet?: EscalationRead;
  fleetHatch?: boolean;
  steer?: EscalationRead;
  steerHatch?: boolean;
  reconcile?: string;
  recipeHatch?: boolean;
  render?: SupervisorTickDeps["render"];
  refreshFails?: boolean;
  refreshTimesOut?: boolean;
}
