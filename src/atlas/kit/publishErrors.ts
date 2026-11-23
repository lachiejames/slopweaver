/**
 * The typed failures publication and its guards author — the compare-and-swap, the stamped-generation
 * refusals, the evidence-loss and sensitivity gates, both locks, the two-phase swap and the duplicate-id
 * refusals a merge raises before anything is published.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to the publish half of `src/atlas/kit/`;
 * the store, the sidecars and the walks keep their own. `publishAtlas`, the locks, the merges and the
 * sensitivity gate keep their `readonly string[]` contract for the dozens of platforms that call them, so
 * each maps once through {@link atlasPublishErrorLines} at its own export — one line per problem, exactly as
 * the lists it replaced printed them.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "../../lib/errorMessage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A rename that threw, naming the destination it was installing. */
interface InstallStep<C extends string> extends Plain<C> {
  readonly path: string;
  readonly cause: unknown;
}

/** One sensitivity finding the gate refused, as the refusal names it. */
interface RefusedFinding {
  readonly path: string;
  readonly reason: string;
  readonly witness: string;
}

/** Every failure the publish half of the atlas kit authors. */
export type AtlasPublishError =
  | Listed<"GENERATION_UNREADABLE">
  | (Plain<"GENERATION_MOVED"> & { readonly platform: string })
  | Listed<"CLOCKS_DISAGREE">
  | Listed<"KINDS_INCOHERENT">
  | Listed<"PUBLISH_GUARD_REFUSED">
  | Listed<"EVIDENCE_LOSS_REFUSED">
  | Listed<"GENERATION_INVALID">
  | Listed<"MANDATORY_KINDS_OWED">
  | Listed<"ROWS_VOLUMINOUS">
  | (Listed<"EVIDENCE_WOULD_BE_LOST"> & { readonly platform: string; readonly emptied: boolean })
  | (Plain<"LEASE_FOREIGN"> & {
      readonly leasePlatform: string;
      readonly leaseHome: string;
      readonly platform: string;
      readonly home: string;
    })
  | (Listed<"PUBLISH_LOCK_HELD"> & { readonly platform: string; readonly holder: string })
  | Listed<"STAGE_FAILED">
  | InstallStep<"PREVIOUS_NOT_PARKED">
  | InstallStep<"INSTALL_FAILED">
  | Listed<"INSTALL_ABORTED">
  | (Listed<"SENSITIVE_VALUE_REFUSED"> & { readonly label: string })
  | (Listed<"ENTITY_IDS_DUPLICATED"> & { readonly ids: readonly string[] })
  | (Plain<"GAP_IDS_DUPLICATED"> & { readonly ids: readonly string[] });

/** The codes whose problems end in the one "not published" line every stamped-generation refusal carries. */
type UnpublishedCode =
  | "GENERATION_UNREADABLE"
  | "CLOCKS_DISAGREE"
  | "KINDS_INCOHERENT"
  | "PUBLISH_GUARD_REFUSED"
  | "GENERATION_INVALID"
  | "MANDATORY_KINDS_OWED"
  | "ROWS_VOLUMINOUS";

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** A stamped-generation refusal: the problems found, then the line saying nothing was published. */
function unpublished({ code, problems }: { code: UnpublishedCode; problems: readonly string[] }): AtlasPublishError {
  return listed({ code, reasons: [...problems, "nothing was written — this generation is not published"] });
}

/** The last line of every swap refusal whose previous generation is whole, so no caller infers what survived. */
function untouched(): string {
  return "nothing was installed — the published generation is untouched";
}

/** The sorted, de-duplicated ids a duplicate refusal names. */
function distinctSorted({ ids }: { ids: readonly string[] }): string {
  return [...new Set(ids)].toSorted().join(", ");
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const AtlasPublishErrors = {
  clocksDisagree: ({ problems }: { problems: readonly string[] }): AtlasPublishError =>
    unpublished({ code: "CLOCKS_DISAGREE", problems }),
  entityIdsDuplicated: ({ ids }: { ids: readonly string[] }): AtlasPublishError => ({
    ids,
    ...listed({
      code: "ENTITY_IDS_DUPLICATED",
      reasons: [
        `this run produced the same entity id twice: ${distinctSorted({ ids })}`,
        "refusing to merge — one read producing two records for one thing is how a count double-counts",
      ],
    }),
  }),
  evidenceLossRefused: ({
    hatchLines,
    refusal,
  }: {
    hatchLines: readonly string[];
    refusal: AtlasPublishError;
  }): AtlasPublishError =>
    listed({ code: "EVIDENCE_LOSS_REFUSED", reasons: [...atlasPublishErrorLines({ error: refusal }), ...hatchLines] }),
  evidenceWouldBeLost: ({
    emptied,
    lost,
    platform,
  }: {
    emptied: boolean;
    lost: readonly string[];
    platform: string;
  }): AtlasPublishError => {
    const headline = emptied
      ? `this ${platform} publish would empty a kind the store already holds, so it is refused:`
      : `this ${platform} run FAILED and would publish less than the store already holds, so it is refused:`;
    const trailer =
      "nothing was written — the record that worked still stands. Fix what the run reported and run it again";
    return {
      emptied,
      platform,
      ...listed({ code: "EVIDENCE_WOULD_BE_LOST", reasons: [headline, ...lost, trailer] }),
    };
  },
  gapIdsDuplicated: ({ ids }: { ids: readonly string[] }): AtlasPublishError => ({
    code: "GAP_IDS_DUPLICATED",
    ids,
    message: `this run reported the same gap twice: ${distinctSorted({ ids })}`,
  }),
  generationInvalid: ({ problems }: { problems: readonly string[] }): AtlasPublishError =>
    unpublished({ code: "GENERATION_INVALID", problems }),
  generationMoved: ({ platform }: { platform: string }): AtlasPublishError => ({
    code: "GENERATION_MOVED",
    message:
      `another writer published a ${platform} generation while this one was being built, so publishing ` +
      "now would discard what it wrote — nothing was written, and running the verb again will read the " +
      "newer generation and merge onto it",
    platform,
  }),
  generationUnreadable: ({ reasons }: { reasons: readonly string[] }): AtlasPublishError =>
    unpublished({ code: "GENERATION_UNREADABLE", problems: reasons }),
  installAborted: ({
    cause,
    rollbackFailures,
  }: {
    cause: AtlasPublishError;
    rollbackFailures: readonly string[];
  }): AtlasPublishError => {
    const tail = rollbackFailures.length > 0 ? rollbackFailures : [untouched()];
    return listed({ code: "INSTALL_ABORTED", reasons: [cause.message, ...tail] });
  },
  installFailed: ({ cause, path }: { cause: unknown; path: string }): AtlasPublishError => ({
    cause,
    code: "INSTALL_FAILED",
    message: `cannot install ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  kindsIncoherent: ({ problems }: { problems: readonly string[] }): AtlasPublishError =>
    unpublished({ code: "KINDS_INCOHERENT", problems }),
  leaseForeign: ({
    home,
    leaseHome,
    leasePlatform,
    platform,
  }: {
    home: string;
    leaseHome: string;
    leasePlatform: string;
    platform: string;
  }): AtlasPublishError => ({
    code: "LEASE_FOREIGN",
    home,
    leaseHome,
    leasePlatform,
    message:
      `the mutation lease offered was taken for ${leasePlatform} under ${leaseHome}, not for ${platform} ` +
      `under ${home} — a lease proves ONE atlas's lock is held and can never stand in for another's, so ` +
      "nothing was written",
    platform,
  }),
  mandatoryKindsOwed: ({ problems }: { problems: readonly string[] }): AtlasPublishError =>
    unpublished({ code: "MANDATORY_KINDS_OWED", problems }),
  previousNotParked: ({ cause, path }: { cause: unknown; path: string }): AtlasPublishError => ({
    cause,
    code: "PREVIOUS_NOT_PARKED",
    message: `cannot install ${path}: the previous generation could not be moved aside: ${errorMessage({ error: cause })}`,
    path,
  }),
  publishGuardRefused: ({ problems }: { problems: readonly string[] }): AtlasPublishError =>
    unpublished({ code: "PUBLISH_GUARD_REFUSED", problems }),
  publishLockHeld: ({ holder, platform }: { holder: string; platform: string }): AtlasPublishError => ({
    holder,
    platform,
    ...listed({
      code: "PUBLISH_LOCK_HELD",
      reasons: [
        `another process is publishing the ${platform} atlas: ${holder}`,
        "nothing was written — run the verb again once it has finished",
      ],
    }),
  }),
  rowsVoluminous: ({ problems }: { problems: readonly string[] }): AtlasPublishError =>
    unpublished({ code: "ROWS_VOLUMINOUS", problems }),
  sensitiveValueRefused: ({
    findings,
    label,
  }: {
    findings: readonly RefusedFinding[];
    label: string;
  }): AtlasPublishError => ({
    label,
    ...listed({
      code: "SENSITIVE_VALUE_REFUSED",
      reasons: [
        `refusing to write ${label}: the sensitivity gate found ${String(findings.length)} thing(s) that must never reach this atlas`,
        ...findings.map((finding) => `  ${finding.path}: ${finding.reason} [witness ${finding.witness}]`),
        "nothing was written — the value itself is deliberately not printed above",
      ],
    }),
  }),
  stageFailed: ({ reasons }: { reasons: readonly string[] }): AtlasPublishError =>
    listed({ code: "STAGE_FAILED", reasons: [...reasons, untouched()] }),
} as const;

/**
 * The lines an {@link AtlasPublishError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function atlasPublishErrorLines({ error }: { error: AtlasPublishError }): readonly string[] {
  if (
    error.code === "GENERATION_MOVED" ||
    error.code === "LEASE_FOREIGN" ||
    error.code === "PREVIOUS_NOT_PARKED" ||
    error.code === "INSTALL_FAILED" ||
    error.code === "GAP_IDS_DUPLICATED"
  ) {
    return [error.message];
  }
  return error.reasons;
}
