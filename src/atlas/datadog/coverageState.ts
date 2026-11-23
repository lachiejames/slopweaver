/**
 * What one typed Datadog failure MEANS for a coverage cell: the state it earns, and the sentence that says
 * what would unblock it.
 *
 * Split out of `coverage.ts` along its own seam. That file builds cells — it decides a cell's reason, its
 * role, its evidence and its scope; this one answers a different question entirely, which is what a
 * `DatadogAtlasError` implies about whether the atlas can claim anything at all. The two changed for
 * unrelated reasons, and only one of them has to be exhaustive over the error union.
 *
 * ## The `never` default is the point
 *
 * Every branch is a `switch` over the union with a `default` assigning to a `never`-typed binding, so a new
 * member of `DatadogAtlasError` fails to COMPILE here rather than falling through to a state somebody
 * guessed at runtime. `error-handling.md` § "Consuming a typed error" is the rule; this is where the repo
 * pays for it.
 */
import type { AtlasCoverageState } from "../kit/contract.js";

import type { DatadogAtlasError } from "./errors.js";

/** The state a failure earns, beside the sentence saying what would change it. */
export interface DatadogFailureState {
  readonly state: AtlasCoverageState;
  readonly unblockedBy: string;
}

/**
 * The coverage state one failure kind earns, and what would unblock it.
 *
 * A `switch` over every variant with a `never` default, so a new member of the union fails to compile here
 * rather than falling through to a state somebody guessed at runtime.
 *
 * @returns the coverage state this failure earns, beside the sentence saying what would change it
 */
export function stateFor({ error }: { error: DatadogAtlasError }): DatadogFailureState {
  const reachable = reachableButUnbuilt({ error });
  if (reachable !== null) {
    return reachable;
  }
  return stateForCredentialOrTransport({ error });
}

/**
 * The two failures that mean the operation is REACHABLE and this build cannot yet use it.
 *
 * Split from the rest because they are the only ones that are not faults: nothing is broken, nothing is
 * forbidden and nothing is empty. Keeping them together is also what keeps their sibling switch inside the
 * function-length cap.
 *
 * @param error the failure this kind's read produced
 * @returns the state and remedy, or `null` when this is not one of the two
 */
function reachableButUnbuilt({ error }: { error: DatadogAtlasError }): DatadogFailureState | null {
  if (error.code === "MISSING_PARAMETER") {
    return {
      // `deferred`, never `unreadable`: the operation is reachable and this pass cannot yet build its
      // request. This is the same class as an identifier-taking operation, one parameter over, and it is a
      // backlog item rather than a defect.
      state: "deferred",
      unblockedBy:
        error.parameter === null
          ? "supply the query parameter Datadog's 400 says this operation requires; its body did not name which, so read it from Datadog's reference for this endpoint"
          : `supply the query parameter \`${error.parameter}\`, which Datadog itself named in its 400. The registry records each operation's paging parameters and not its REQUIRED ones, so closing this means recording those too`,
    };
  }
  if (error.code === "NOT_IMPLEMENTED") {
    return {
      state: "unavailable",
      unblockedBy:
        "nothing this repository can do: the pinned client declares this operation and this Datadog site does not serve it. Record it as a permanent bound of the site, and re-check it if the installation is ever re-pointed",
    };
  }
  return null;
}

/**
 * What unblocks each failure that earns `unreadable` with a fixed sentence. The two console codes are never
 * reached from an API read — they are the console walk refusing its own inputs — and sit here so the switch
 * below still names every member of the union.
 */
const UNREADABLE_REMEDIES = {
  BODY_SHAPE_CHANGED:
    "Datadog changed this operation's answer: compare the named fields with a live answer and the pinned specification, then regenerate its response boundary from a fresh census",
  CONSOLE_LIMIT_EMPTY: "re-run `slopweaver atlas datadog walk` with a --limit of at least 1, or without one at all",
  CONSOLE_REGISTRY_EMPTY: "declare the console's pages in src/atlas/datadog/consolePages.ts, then run the walk",
  TRANSPORT_FAILED: "re-run the sync; if it persists, the detail names what failed",
  UNEXPECTED_SHAPE:
    "Datadog answered with a shape this build does not admit — read the detail, then either widen the schema or record it as a provider change",
} as const satisfies Partial<Record<DatadogAtlasError["code"], string>>;

/**
 * Every other failure kind: a credential condition, a budget, a shape, a transport.
 *
 * A `switch` over every remaining variant with a `never` default, so a new member of the union fails to
 * compile here rather than falling through to a state somebody guessed at runtime.
 *
 * @param error the failure this kind's read produced
 * @returns the state it earned and what would unblock it
 */
function stateForCredentialOrTransport({ error }: { error: DatadogAtlasError }): DatadogFailureState {
  switch (error.code) {
    case "SURFACE_REFUSED":
      return {
        state: "invalid-configuration",
        unblockedBy:
          "the sync asked for a surface the closed registry does not admit — a defect in this repository rather than a provider condition, so fix the caller or regenerate the registry",
      };
    case "UNAUTHORISED":
      return {
        state: "not-configured",
        unblockedBy:
          "configure a valid API key and application key for this site, then run `slopweaver datadog verify`",
      };
    case "FORBIDDEN":
      return {
        state: "unavailable",
        unblockedBy:
          "this organisation cannot read this family. Grant the application key's owner the relevant Datadog permission, or accept it as a permanent boundary of what this atlas can claim",
      };
    // The two reachable-but-unbuilt kinds are answered by `reachableButUnbuilt` before this switch runs, and
    // are listed here so the exhaustiveness check below still sees every member of the union.
    case "MISSING_PARAMETER":
    case "NOT_IMPLEMENTED":
      return reachableButUnbuilt({ error })!;
    case "RATE_LIMITED":
      return {
        state: "deferred",
        unblockedBy:
          error.resetSeconds === null
            ? "re-run the sync once the endpoint family's budget has refilled; Datadog sent no reset header, so nothing here knows when that is"
            : `re-run the sync in ${String(error.resetSeconds)}s, when Datadog said this endpoint family's budget refills`,
      };
    case "UNEXPECTED_SHAPE":
    case "BODY_SHAPE_CHANGED":
    case "TRANSPORT_FAILED":
    case "CONSOLE_REGISTRY_EMPTY":
    case "CONSOLE_LIMIT_EMPTY":
      return { state: "unreadable", unblockedBy: UNREADABLE_REMEDIES[error.code] };
    default: {
      const exhaustive: never = error;
      return { state: "unreadable", unblockedBy: `unhandled failure: ${JSON.stringify(exhaustive)}` };
    }
  }
}
