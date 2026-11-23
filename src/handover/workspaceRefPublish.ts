/**
 * Publishing a run's own `workspace:N` ref onto its cmux sidebar row on every successful lifecycle verb (`start`,
 * `ask`, `withdraw`, `amend`, `finish`, `abandon`) — the one sidebar write the handover lifecycle still makes.
 *
 * The supervisor addresses a session as `workspace:266` and briefs the owner in that vocabulary, so the token has
 * to appear on the row it names. `cmux spawn` already writes it from the ref cmux hands back
 * at creation; this covers the two cases a spawn cannot: a run started in a workspace nobody spawned, and a
 * workspace whose ref cmux has reassigned since. The second is why every lifecycle verb refreshes it, not only
 * `start`: a ref cmux reassigns mid-run would otherwise leave the row naming another seat.
 *
 * **No status lane, checklist or progress bar is published, here or anywhere.** The owner reads none of them and
 * depends on Queue cards and floating notes for a seat's state (a sidebar checklist
 * and status are a waste of tokens to produce). The ref pill is an identifier, not state.
 *
 * **A publish failure NEVER fails the lifecycle verb.** The run journal is the source of truth; turning a cosmetic
 * write into a refused lifecycle verb would destroy real work over a decoration.
 */
import { logger } from "#lib/logger.js";
import {
  type CmuxCli,
  readCallerWorkspaceRef,
  setStatusPill,
  WORKSPACE_REF_STATUS_ICON,
  WORKSPACE_REF_STATUS_KEY,
  WORKSPACE_REF_STATUS_PRIORITY,
} from "../cmux/sidebar.js";

/**
 * Whether this process is running inside a cmux workspace at all.
 *
 * A `handover start` typed at a plain terminal has no sidebar to publish to, and shelling `cmux` there would
 * print failure lines on every start — noise that would train a reader to ignore the diagnostics that DO matter.
 * cmux exports this into every surface it opens, so its absence is a reliable "there is nothing to publish to"
 * rather than a guess.
 *
 * **A test never publishes, whatever the environment says.** Caught by reading a real push gate's output: a
 * suite that runs a real `handover start` INHERITS this session's `CMUX_WORKSPACE_ID`, so it went and wrote to
 * the developer's own live sidebar. A test process reaching out and mutating the machine it runs on is the
 * defect, and vitest sets `VITEST` in every worker.
 *
 * @param env the environment to read
 * @returns whether a cmux workspace owns this process AND this process may publish to it
 */
export function insideCmuxWorkspace({ env }: { env: Readonly<Record<string, string | undefined>> }): boolean {
  if (env["VITEST"] !== undefined) {
    return false;
  }
  const workspaceId = env["CMUX_WORKSPACE_ID"];
  return workspaceId !== undefined && workspaceId.trim().length > 0;
}

/**
 * Publish the caller's own `workspace:N` ref as a pill on its sidebar row.
 *
 * Never throws and never returns a failure: a write that fails is REPORTED on stderr and skipped.
 *
 * @param cli the cmux seam
 * @param verb the lifecycle verb publishing it, for the diagnostic line
 * @param env the environment, read only to tell whether there is a cmux workspace to publish to at all
 */
export function publishRunWorkspaceRef({
  cli,
  verb,
  env = process.env,
}: {
  cli: CmuxCli;
  verb: string;
  env?: Readonly<Record<string, string | undefined>>;
}): void {
  if (!insideCmuxWorkspace({ env })) {
    return;
  }
  const report = ({ what, message }: { what: string; message: string }): void => {
    logger.error({ msg: `${verb}: the run is recorded, but its cmux ${what} could not be published: ${message}` });
  };
  const ref = readCallerWorkspaceRef({ cli });
  if (ref.isErr()) {
    report({ message: ref.error.message, what: "workspace ref" });
    return;
  }
  const pill = setStatusPill({
    cli,
    icon: WORKSPACE_REF_STATUS_ICON,
    key: WORKSPACE_REF_STATUS_KEY,
    priority: WORKSPACE_REF_STATUS_PRIORITY,
    value: ref.value,
  });
  if (pill.isErr()) {
    report({ message: pill.error.message, what: "workspace ref pill" });
  }
}
