/**
 * The above-the-fold gate for a Linear write that is its summary and nothing else — a comment, a project update,
 * an initiative update — so it has no fold to widen the check onto. One wrapper for the three verbs that share it.
 */
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { AboveFoldCell } from "../../../outbound/voice/aboveFold.js";
import { aboveFoldGateRefused } from "../../aboveFoldDoor.js";
import { resolveHome } from "../../optionParsers.js";

/**
 * Whether a summary-only Linear write's above-the-fold cells refuse it.
 *
 * @param cells the write's above-the-fold cells
 * @param args the parsed invocation, for the dry-run flag and the named home
 * @param deps the environment reader, output sink and door ledger the gate records a refusal through
 * @returns true when the write must refuse
 */
export async function summaryAboveFoldRefused({
  args,
  cells,
  deps,
}: {
  args: { readonly dryRun: boolean; readonly home: string | undefined };
  cells: readonly AboveFoldCell[];
  deps: {
    readonly doorLedger: DoorLedgerPort;
    readonly env: (args: { name: string }) => string | undefined;
    readonly out: (line: string) => void;
  };
}): Promise<boolean> {
  return aboveFoldGateRefused({
    belowFoldCells: [],
    cells,
    dryRun: args.dryRun,
    env: deps.env,
    home: resolveHome({ named: args.home }),
    ledger: deps.doorLedger,
    out: ({ line }) => {
      deps.out(line);
    },
    surface: "linear",
  });
}
