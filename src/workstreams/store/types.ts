/**
 * The workstream register as the store holds it: one aggregate per workstream — its own milestones, its dated
 * entries and its links — beside one register-level document.
 *
 * Workstreams live in the store, a table with rows, not files; each
 * carries its own milestones, the last of which is its definition of done; a milestone is done only when a dated
 * entry links the proof; and ONE link table ties a workstream to queue cards, alignment cards, automations, pull
 * requests and Linear projects. The generic five-step bar is not in this model at all.
 *
 * Pure: types and the value lists the store's enums are built from, so the schema and the decoders read one list.
 */

/** The workstream variants the file register carried, each surviving the move. */
export const WORKSTREAM_KINDS = ["outcome", "standing", "linked", "local", "closing"] as const;

/** The two workspaces a workstream belongs to, as `src/handover/workspace.ts` names the roles. */
export const WORKSTREAM_WORKSPACES = ["team", "self"] as const;

/** The owner's four status words. */
export const WORKSTREAM_STATUSES = ["proven", "validating", "stalled", "discovery"] as const;

/** What kind of moment a dated entry is; the file register's timeline kinds, unchanged. */
export const WORKSTREAM_ENTRY_KINDS = [
  "raised",
  "discussion",
  "dm",
  "proposal",
  "pr",
  "pushback",
  "announce",
  "note",
] as const;

/**
 * What a link points at. `workstream` is another workstream this one bears on (the file register's `related`), so
 * "which workstreams relate" is the same one lookup as "which workstream is this automation in".
 */
export const WORKSTREAM_LINK_KINDS = [
  "queue_card",
  "alignment_card",
  "automation",
  "pull_request",
  "linear_project",
  "workstream",
] as const;

export type WorkstreamKind = (typeof WORKSTREAM_KINDS)[number];
/** @internal — named for the aggregate's fields below; nothing outside this file spells it */
export type WorkstreamWorkspace = (typeof WORKSTREAM_WORKSPACES)[number];
/** @internal — named for the aggregate's fields below; nothing outside this file spells it */
export type WorkstreamStatus = (typeof WORKSTREAM_STATUSES)[number];
/** @internal — named for the aggregate's fields below; nothing outside this file spells it */
export type WorkstreamEntryKind = (typeof WORKSTREAM_ENTRY_KINDS)[number];
export type WorkstreamLinkKind = (typeof WORKSTREAM_LINK_KINDS)[number];

/** One of a workstream's own milestones. The greatest `position` is its definition of done. */
export interface WorkstreamMilestone {
  /** Lower kebab, unique within the workstream. */
  readonly id: string;
  readonly name: string;
  /** Where the owner named it. */
  readonly anchor: string;
  /** Authored order, unique within the workstream; the last is the definition of done. */
  readonly position: number;
  /** The milestone ids it comes after, sorted. */
  readonly after: readonly string[];
}

/** One dated entry: a moment in the workstream's story, optionally moving or finishing one milestone. */
export interface WorkstreamEntry {
  /** A canonical UUID, the caller's, kept across rewrites. */
  readonly id: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly kind: WorkstreamEntryKind;
  readonly text: string;
  /** The link that proves it; required when it finishes a milestone. */
  readonly href: string | null;
  readonly milestoneId: string | null;
  /** Whether it finishes `milestoneId`. */
  readonly done: boolean;
  /** Story order, unique within the workstream; two entries may share a date. */
  readonly position: number;
}

/** One link from a workstream to something it owns or bears on. */
export interface WorkstreamLink {
  /** A canonical UUID, the caller's, kept across rewrites. */
  readonly id: string;
  readonly kind: WorkstreamLinkKind;
  /** The canonical identity for its kind (`./linkTarget.ts`). */
  readonly target: string;
  /** Why it is linked, in words, when the target alone does not say. */
  readonly label: string | null;
  /** The one milestone it serves, when it serves one. */
  readonly milestoneId: string | null;
}

/** One workstream as a writer proposes it: its row, its detail document and its three child collections. */
export interface WorkstreamAggregate {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkstreamKind;
  readonly workspace: WorkstreamWorkspace;
  readonly outcome: string | null;
  readonly status: WorkstreamStatus | null;
  /** Every other authored field of its kind, decoded by `./decode.ts` on every read and write. */
  readonly detail: Readonly<Record<string, unknown>>;
  readonly milestones: readonly WorkstreamMilestone[];
  readonly entries: readonly WorkstreamEntry[];
  readonly links: readonly WorkstreamLink[];
}

/** Where a workstream stands against its own milestones, derived and never stored. */
export interface WorkstreamProgress {
  readonly doneCount: number;
  readonly totalCount: number;
  /** Incomplete milestones whose every predecessor is done, in authored order. */
  readonly ready: readonly WorkstreamMilestone[];
  /** The first of `ready`, or `null` once complete. */
  readonly next: WorkstreamMilestone | null;
  /** Whether the definition of done (the last milestone) is done. */
  readonly complete: boolean;
}

/** A workstream as the store returned it. */
export interface StoredWorkstream extends WorkstreamAggregate {
  readonly revision: number;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
  /** `null` for `local` and `closing`, which carry no milestones. */
  readonly progress: WorkstreamProgress | null;
}

/** The register-level document: the words for each Slack conversation, the grouping and the initiatives. */
export interface WorkstreamRegisterMeta {
  readonly channels: Readonly<Record<string, string>>;
  readonly grouping: {
    readonly anchor: string;
    readonly builtFrom: string;
    readonly label: string;
    readonly why: string;
  };
  readonly initiatives: readonly { readonly id: string; readonly name: string }[];
}

/** The register-level document as the store returned it. */
export interface StoredWorkstreamMeta {
  readonly document: WorkstreamRegisterMeta;
  readonly revision: number;
  readonly updatedAtIso: string;
}

/** The whole register: an empty store reads `{ meta: null, workstreams: [] }`, never an error. */
export interface WorkstreamRegisterSnapshot {
  readonly meta: StoredWorkstreamMeta | null;
  readonly workstreams: readonly StoredWorkstream[];
}
