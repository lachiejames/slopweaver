/**
 * The door's vocabulary — the types every side-effecting action is described in on its way out. The door
 * (PR2) is the trust spine: it ships with NO real gates, only the pathway + the warn-first / override /
 * hold contract, so that when actions arrive (PR5+) they are gated by construction, never retrofitted.
 *
 * Kept deliberately boring + reusable: pure data, no I/O, no behaviour. `door.ts` decides, `ledger.ts`
 * records, `rawTools.ts` classifies the raw-bypass tools, `coverage.ts` proves no seam escapes.
 */

/** What a seam does to the world — the axis the door polices. Local-state (under $SLOPWEAVER_HOME) is the
 * product working normally; only EXTERNAL writes/sends are the thing the door must gate or hold. */
export type DoorEffect = "none" | "local-state" | "external-read" | "external-write";

/** The action being attempted: a Slopweaver verb, or a raw bypass tool the hook intercepts. */
type DoorAction =
  | { readonly kind: "verb"; readonly noun: string; readonly verb: string }
  | { readonly kind: "raw-tool"; readonly tool: string; readonly command: string };

/** The thing being acted on (a repo slug, a path, a message target …). Free-form, for the record + gates. */
export type DoorArtifact = Readonly<Record<string, unknown>>;

/**
 * Context the door + gates + ledger need. All fields REQUIRED so a call site states its intent explicitly
 * (an omitted `requiresApproval` can't silently read as "false"); `home` is `string | null` — null means
 * "the resolved default home", spelled out rather than an absent field.
 */
interface DoorMeta {
  readonly effect: DoorEffect;
  /**
   * Whether this request may only proceed on evidence the owner approved it. LOAD-BEARING, not a label:
   * `admitDoor` HOLDS a request declaring it whose gate list carries no gate built by
   * `../admit/approval.approvalGate`, so declaring it without one refuses the effect rather than describing
   * it. Approval is a property of the REQUEST rather than of the verb — the same verb is approved when the
   * caller shows the digest and refused when they do not — which is why it lives here and nowhere else.
   */
  readonly requiresApproval: boolean;
  readonly createsWorkItem: boolean;
  readonly home: string | null;
}

/**
 * A finding a caller accepted BY NAME, and the reason they gave for it.
 *
 * Written to the door ledger, which is the whole point: a guard that can be waived silently is a guard whose
 * waivers cannot be counted afterwards. Measured while adding the Codex pairing floor — `--acknowledge
 * <subject>` needed no reason and nothing about an acknowledgement reached the ledger at all, so every
 * waiver in this install's history is unattributable. Optional because only a subject that OPTS IN carries
 * one; the subjects that predate this keep exactly the line they always wrote.
 */
export interface DoorAcknowledgement {
  /**
   * The finding subject that was waived. A CLOSED set, not free text: an arbitrary string would let a caller
   * record a waiver for a finding no guard raises, which reads in the ledger exactly like a real one. Adding
   * a member here is the deliberate act of making a new subject waivable.
   */
  readonly subject: AcknowledgeableSubject;
  /** Why, in the caller's own words. Non-blank by the parser's obligation, never defaulted here. */
  readonly reason: string;
}

/**
 * The finding subjects a caller may record a waiver for.
 *
 * **What this cannot do, stated rather than left to be discovered.** It stops a fabricated SUBJECT; it cannot
 * stop a caller attaching a well-formed acknowledgement to a request whose guard raised nothing. The door is
 * pure data by design — it records what a caller decided and never re-derives it — so that half is a caller
 * invariant, held at each guard and tested there (`codexLoopAcknowledgement` in `../cli/commands/github/enqueueCore.js`
 * and `judgeCodexPairingFloor` in `../cli/commands/github/mergeAdminVerdicts.js`, both of which return `undefined`
 * unless the finding was actually raised AND is no longer standing). Found by a Codex review of this diff,
 * which asked what a typed caller outside those two paths could write. `unshown-items` holds it the same way:
 * `../outbound/assistant/citedAndShown.ts`'s `pictureJudgement` refuses a reason on a message that owed
 * no picture decision, so the reason only reaches a send whose question actually fired.
 *
 * @internal — named only through {@link DoorAcknowledgement}; a caller passes the literal.
 */
export type AcknowledgeableSubject =
  | "codex-loop-incomplete"
  | "ci-rollup-superseded"
  | "unshown-items"
  | "datadog-iac-managed"
  | "gcp-edit-existing"
  | "private-terms-unchecked";

/** One request through the door. `artifact` is required — pass `{}` when there's nothing to describe. */
export interface DoorRequest {
  readonly action: DoorAction;
  readonly artifact: DoorArtifact;
  readonly meta: DoorMeta;
  /**
   * Every finding this caller waived by name, when one was needed and given.
   *
   * A LIST, because `github enqueue`'s `--acknowledge` has always taken a comma-separated set of subjects
   * and one invocation genuinely waives more than one: a fleet pull request whose head no checkout on this
   * machine holds raises `codex-loop-incomplete`, and the same pull request's rollup pinned by a re-run of
   * `dev-gate` raises `ci-rollup-superseded`. While this was a single value the ledger recorded the first
   * and lost the second, which is a waiver count that is technically complete and actually misleading.
   * Absent rather than empty when nothing was waived, so a request that waived nothing writes the line it
   * always wrote.
   */
  readonly acknowledgements?: readonly DoorAcknowledgement[];
}

/** Fields every finding shares — structured so the agent can SELF-CORRECT (not prose-only). */
interface DoorFindingBase {
  readonly code: string;
  readonly summary: string;
  /** What to change to satisfy the gate. */
  readonly correction: string;
}

/**
 * A finding is a discriminated union so the warn/hold contract is enforced at the TYPE level: a `warn`
 * MUST carry an `override` token (so it is always self-correctable), and a `hold` has none (it is the
 * irreversible-harm core, never waivable by the per-action token). A gate cannot express "an
 * un-overridable warn" or "an overridable hold".
 */
export type DoorFinding =
  | (DoorFindingBase & {
      readonly severity: "warn";
      /** The per-action override token (e.g. `refresh.run:v1`) that, in `$SLOPWEAVER_DOOR_OVERRIDE`, waives this warn. */
      readonly override: string;
    })
  | (DoorFindingBase & { readonly severity: "hold" });

/** The door's verdict. `pass` lets the effect happen; `warn`/`hold` mean the caller MUST NOT perform it. */
export type DoorStatus = "pass" | "warn" | "hold";

/** A decision, plus the findings that produced it and any findings an override waived (for the record). */
export interface DoorDecision {
  readonly status: DoorStatus;
  readonly findings: readonly DoorFinding[];
  /** Findings that fired but were waived by an explicit override token (recorded, never silent). */
  readonly overridden: readonly DoorFinding[];
}

/** A gate: pure `request → findings`. The compose seam is EMPTY in PR2; PR9/PR14 fill it. */
export type DoorGate = (request: DoorRequest) => readonly DoorFinding[];
