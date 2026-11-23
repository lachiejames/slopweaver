/** The shapes the `reseatPass` fake world is built from and hands back. */
import type { SeatBootPlan } from "../../../../../../claude/seatBoot.js";
import type { ReseatDeps } from "../../../../../../cli/commands/cmux/reseatPass.js";
import type { CmuxClient, CmuxProcess } from "../../../../../../cmux/client.js";

/** The resolved state every seam of one world reads and mutates. */
export interface WorldState {
  readonly screens: ReadonlyMap<string, string>;
  readonly stops: boolean;
  readonly afterStop: readonly CmuxProcess[];
  readonly boots: ReadonlyMap<string, SeatBootPlan>;
  readonly journal: string[];
  readonly lockedBy: ReadonlySet<string>;
  readonly lockJournal: string[];
  readonly pids: ReadonlyMap<string, number>;
  readonly sessions: ReadonlyMap<string, string>;
  readonly relaunched: Set<string>;
}

/** A fake world: the client and every dep but the client. */
export interface WorldHarness {
  readonly client: CmuxClient;
  readonly deps: Omit<ReseatDeps, "client">;
}
