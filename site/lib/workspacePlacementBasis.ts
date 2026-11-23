/**
 * The two workspaces a console row can belong to, the evidence that names one and the placement it makes — the types
 * every placement reader shares. The reading itself is `./workspacePlacement.ts`.
 */

import type { QuotedRead } from "./quotedReason";

/**
 * The two workspaces a row can belong to, as a record states one (`workspace: team|self`) — ROLES, never names:
 * `team` is the organisation's work, `self` this installation's own. `src/handover/workspace.ts` holds the same two.
 */
export type Workspace = "team" | "self";

/** What kind of structured value a piece of evidence was read from. */
export type WorkspaceSource =
  | "stated"
  | "joined-stated"
  | "repository"
  | "slack-workspace"
  | "linear-workspace"
  | "vanta-workspace"
  | "installation-state"
  | "act-kind"
  | "board-row";

/** One structured value and the workspace it names. */
export interface WorkspaceEvidence {
  readonly source: WorkspaceSource;
  readonly workspace: Workspace;
  /** The exact value read — the repository slug, the permalink's host, the joined slug — so a finding can say it. */
  readonly value: string;
}

/** Where a row belongs: one workspace, none, or both. */
export type WorkspacePlacement =
  | {
      readonly kind: "placed";
      readonly workspace: Workspace;
      readonly by: readonly WorkspaceEvidence[];
      /** Evidence naming the other workspace that a stated workspace settled — present only when there was some. */
      readonly overruled?: readonly WorkspaceEvidence[];
    }
  | {
      readonly kind: "unplaced";
      /** The console's own words: what left it unplaced, never a read's raw reason (steer 7). */
      readonly why: string;
      /**
       * The read whose failure left it unplaced, its reason exactly as the read gave it, drawn as a warning mark beside
       * the finding with its raw folded — never set inside `why`, which the finding's hover draws whole.
       */
      readonly warning?: QuotedRead;
    }
  | { readonly kind: "conflict"; readonly evidence: readonly WorkspaceEvidence[] };

/**
 * Whether a string is one of the two workspaces — the guard a `workspace:` value passes before it is trusted.
 *
 * @returns true for `team` or `self`
 */
export function isWorkspace(value: unknown): value is Workspace {
  return value === "team" || value === "self";
}
