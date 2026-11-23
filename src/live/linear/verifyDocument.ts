/**
 * What a Linear verification pass says: the live facts about one cited object, and the verdict document the
 * pass returns. Types only; the pass itself is `./verify.ts`.
 */

/** What the live provider says about one cited object, reduced to the fields a citation asserts. */
export interface LinearLiveFacts {
  readonly identifier: string;
  readonly title: string;
  readonly state: string | undefined;
  readonly owner: string | undefined;
  readonly archived: boolean;
}

/**
 * One field whose live value no longer agrees with the corpus.
 *
 * @internal — reached through {@link LinearVerification.drifts}; only `./verify.ts` names the shape.
 */
export interface LinearDrift {
  readonly field: "state" | "assignee" | "title" | "archived";
  readonly local: string;
  readonly live: string;
}

/**
 * A citation's verdict. `unverified` is its own outcome rather than an optimistic `confirmed`: a citation
 * nobody checked and a citation that checked out are different things, and only one of them is evidence.
 *
 * @internal — reached through {@link LinearVerification.status}; only `cli/commands/linear/queryDocument.ts`
 * names the union.
 */
export type LinearVerifyStatus = "confirmed" | "changed" | "gone" | "unverified";

/** The verdict on one cited object. */
export interface LinearVerification {
  readonly identifier: string;
  readonly status: LinearVerifyStatus;
  readonly drifts: readonly LinearDrift[];
  /** Why a citation is `unverified` — never set on any other status. */
  readonly reason?: string;
}

/** The whole verification pass: one verdict per citation, plus when it ran and what it cost. */
export interface LinearVerifyDocument {
  readonly verifiedAtIso: string;
  readonly requests: number;
  readonly verifications: readonly LinearVerification[];
}
