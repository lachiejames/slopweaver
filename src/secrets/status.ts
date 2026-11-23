/**
 * The READ side of the secrets store, as pure functions — the half that did not exist.
 *
 * `src/cli/manifests/secrets.ts` registered exactly one verb, `set`, so the owner's only view of their own
 * credential store was `ls`. This module turns a directory listing plus the register
 * (`src/secrets/registry.ts`) into rows the `secrets status` verb prints, and it NEVER touches a value: the
 * effectful shell reads a grant file's account, scope COUNT and expiry, and nothing else ever leaves the
 * file. There is no code path here through which a token can be rendered.
 *
 * ## The four states it surfaces unasked
 *
 * All four were found by hand and none was visible from the install:
 *
 *  - **`access-token-expired`** — a grant file whose cached `expiryMs` has passed. Named precisely, because
 *    the honest severity is low: `src/live/google/authClient.ts` refreshes the access token on the next
 *    call and persists the new one, so the GRANT is live until it is revoked. What was wrong was that
 *    nothing said so at all, not that the door was shut.
 *  - **`expiry-unrecorded`** — a grant file carrying no `expiryMs` key. It means the access-token cache has
 *    never been written back, so nothing can say when the cached token stops working.
 *  - **`dead`** — a file whose register row is `retired`: nothing in `src/` reads it. Dead weight, and the
 *    gate in `src/devLint/secretsRegistry.ts` fails if a reader ever appears.
 *  - **`off-allowlist`** — a file the register does not know at all. It was placed by hand, or written from
 *    another checkout whose register carries its row (the store is shared, the register is per checkout), so
 *    `secrets set` here would REFUSE to rewrite it and nothing here can say what it reaches.
 *
 * Two more fall out of the same read and are worth the same line: `absent` (declared, not stored) and
 * `loose-mode` (a store file the owner is not alone in being able to read). A third is the register's own
 * claim failing against the disk: `write-scope-on-read-only`, a grant the register declares read-only that
 * carries a scope not provably read-only. A fourth, `grant-unreadable`, is a stored grant-cache file that does
 * not parse as a grant: every writer of one records `account`, `grantedAtIso`, `scopes` and the credential its
 * door authenticates with (Google's `refreshToken`, Outlook's `msalCache` and `homeAccountId`), so a file without
 * them is one its door cannot use, and it used to read `ok`. A fifth, `empty`, is a single-line secret of zero
 * bytes, read off its size alone: every door trims the file and treats a blank value as absent. A label that
 * is only the register's assertion would print `read-only` beside a grant whose scopes on disk include a
 * write. A grant row's `mintScope` is therefore DERIVED from the scopes on
 * disk whenever a grant was read, and the register's value is only the fallback for a file not there to
 * read. An `absent` row beside a stored
 * row it goes with is not ordinary — a split added a row nobody set — and the `secret-absent` monitor
 * (`src/monitor/secretAbsent.ts`) cards it, while this report still leaves it to `--all`.
 *
 * Pure throughout — a `Date` is never constructed here and `nowMs` is a parameter, so a test states the
 * instant rather than racing the clock.
 */
import { CREDENTIALS, type CredentialSpec } from "./registry.js";

/** What the install can say about one credential's condition right now. */
export type CredentialState =
  /** Declared, stored, and nothing to report. */
  | "ok"
  /** Declared and not stored — the ordinary state of a source this install has not connected. */
  | "absent"
  /** A grant file whose cached access token has expired. The grant itself is live; the cache is stale. */
  | "access-token-expired"
  /** A grant file carrying no `expiryMs` at all, so nothing can say when its cached token stops working. */
  | "expiry-unrecorded"
  /** Stored, and nothing in `src/` reads it. */
  | "dead"
  /** Stored, and absent from the register entirely. */
  | "off-allowlist"
  /** Stored with a mode other than `0600`, so the owner is not alone in being able to read it. */
  | "loose-mode"
  /** A grant the register declares read-only that carries at least one scope not provably read-only. */
  | "write-scope-on-read-only"
  /** A stored grant file that does not parse as a grant, so its door cannot use it. */
  | "grant-unreadable"
  /** A stored single-line secret of zero bytes, which its door resolves as no credential at all. */
  | "empty";

/**
 * The token-free facts a grant file yields. A COUNT of scopes, plus the text of only those scopes that could
 * write — naming a write is the finding, and a scope URI is a public identifier rather than token material.
 */
export interface GrantObservation {
  /** The account the grant bound to. */
  readonly account: string;
  /** How many scopes were approved. */
  readonly scopeCount: number;
  /** The approved scopes that are not provably read-only (`notReadOnlyScopes`), empty for a read-only grant. */
  readonly writeScopes: readonly string[];
  /** When consent was granted, ISO-8601. */
  readonly grantedAtIso: string;
  /** The cached access token's expiry in epoch milliseconds — ABSENT when the file records none. */
  readonly expiryMs?: number;
}

/** One file actually standing in the store, described without its contents. */
export interface StoreObservation {
  /** The file name under `secrets/`. */
  readonly name: string;
  /** The permission bits as three octal digits (`"600"`), so a loose mode is legible rather than numeric. */
  readonly modeOctal: string;
  /** When it was last written, ISO-8601. */
  readonly modifiedIso: string;
  /** The token-free reading of a grant file; absent for a single-line secret, or when it would not parse. */
  readonly grant?: GrantObservation;
  /** Present, and `true`, only when the file is zero bytes — read off its size, never its contents. */
  readonly empty?: true;
}

/** One rendered row: the register's declaration, plus what the store says about it. */
export interface CredentialRow {
  readonly name: string;
  readonly platform: string;
  readonly what: string;
  readonly usedFor: string;
  readonly mintScope: string;
  readonly expiryKind: string;
  readonly readVerbs: string;
  readonly reader: string | null;
  readonly state: CredentialState;
  /** One line saying what the state means here and what to do about it. */
  readonly detail: string;
  readonly stored: boolean;
  readonly modeOctal?: string;
  readonly modifiedIso?: string;
  readonly account?: string;
  readonly expiryIso?: string;
}

/** The states that are findings rather than ordinary conditions — what `status` leads with, unasked. */
const FINDING_STATES: ReadonlySet<CredentialState> = new Set([
  "off-allowlist",
  "dead",
  "access-token-expired",
  "expiry-unrecorded",
  "loose-mode",
  "write-scope-on-read-only",
  "grant-unreadable",
  "empty",
]);

/**
 * Whether a state is a finding the report must lead with.
 *
 * @param state the computed state
 * @returns true when the state names something the owner has to decide about
 */
export function isFinding({ state }: { state: CredentialState }): boolean {
  return FINDING_STATES.has(state);
}

/** The expiry instant of a grant's cached access token, or `undefined` when the file records none. */
function expiryIsoOf({ grant }: { grant: GrantObservation | undefined }): string | undefined {
  if (grant?.expiryMs === undefined) {
    return undefined;
  }
  return new Date(grant.expiryMs).toISOString();
}

/**
 * Decide the single state of a DECLARED credential. The order is deliberate and is the rule rather than an
 * implementation detail: a missing file outranks every observation OF a file; a retired name outranks the
 * rest, because the only remedy is deletion and reporting its mode or its expiry would invite a fix nobody
 * should make; a loose mode outranks a stale cache, one being a posture problem and the other a note; a
 * write scope on a declared read-only grant is a posture problem too, so it outranks the cache as well; and
 * the two cache states are mutually exclusive by construction.
 *
 * @param spec the register's declaration
 * @param observed what the store holds, or `undefined` when the file is not there
 * @param nowMs the instant to judge an expiry against — a parameter so a test states it
 * @returns the one state to report
 */
export function credentialState({
  spec,
  observed,
  nowMs,
}: {
  spec: CredentialSpec;
  observed: StoreObservation | undefined;
  nowMs: number;
}): CredentialState {
  if (observed === undefined) {
    return "absent";
  }
  if (spec.lifecycle === "retired") {
    return "dead";
  }
  if (observed.modeOctal !== "600") {
    return "loose-mode";
  }
  if (spec.mintScope === "read-only" && observed.grant !== undefined && observed.grant.writeScopes.length > 0) {
    return "write-scope-on-read-only";
  }
  if (spec.expiry !== "grant-cache") {
    return observed.empty === true ? "empty" : "ok";
  }
  if (observed.grant === undefined) {
    return "grant-unreadable";
  }
  if (observed.grant.expiryMs === undefined) {
    return "expiry-unrecorded";
  }
  return observed.grant.expiryMs <= nowMs ? "access-token-expired" : "ok";
}

/**
 * The one line that says what a state means HERE and what the owner should do — written per state rather
 * than per credential, so a new register row cannot ship with no remedy.
 *
 * @param state the computed state
 * @param spec the declaration, for the verb that would fix it
 * @param grant the grant read off disk, whose write scopes the one state about them names
 * @returns the remedy line
 */
function stateDetail({
  state,
  spec,
  grant,
}: {
  state: CredentialState;
  spec: CredentialSpec | undefined;
  grant: GrantObservation | undefined;
}): string {
  switch (state) {
    case "write-scope-on-read-only":
      // `credentialState` reaches this state only for a declared spec over a grant it read, so both are there.
      return `declared read-only, and the grant on disk carries ${grant!.writeScopes.join(", ")} — re-mint it with \`${spec!.writtenBy}\` through a client that has never been shown a write scope`;
    case "ok":
      return "stored, 0600, nothing to report";
    case "absent":
      // `credentialState` reaches this state only for a declared spec, so it is there.
      return `not stored — ${spec!.writtenBy}`;
    case "access-token-expired":
      return "the CACHED access token has expired; the grant is live until revoked and the next call refreshes it";
    case "expiry-unrecorded":
      return "the grant records no expiry at all, so nothing can say when its cached token stops working";
    case "dead":
      return "nothing in src/ reads this — safe to delete";
    case "off-allowlist":
      return "not in the register: placed by hand, or written from a checkout whose register carries its row, so `secrets set` here would refuse to rewrite it and nothing here can say what it reaches";
    case "loose-mode":
      return "the owner is not alone in being able to read this — re-run its writer, or `chmod 600` it";
    case "grant-unreadable":
      // `credentialState` reaches this state only for a declared spec, so it is there.
      return `stored, but it does not parse as a grant, so its door cannot use it — re-mint it with \`${spec!.writtenBy}\``;
    case "empty":
      // `credentialState` reaches this state only for a declared spec, so it is there.
      return `stored, but zero bytes, so its door reads no credential — set it again with \`${spec!.writtenBy}\``;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/** The row an OFF-ALLOWLIST file gets: everything unknown, said as unknown rather than left blank. */
function strayRow({ observed }: { observed: StoreObservation }): CredentialRow {
  return {
    detail: stateDetail({ grant: undefined, spec: undefined, state: "off-allowlist" }),
    expiryKind: "unknown",
    mintScope: "unverified",
    modeOctal: observed.modeOctal,
    modifiedIso: observed.modifiedIso,
    name: observed.name,
    platform: "unknown",
    reader: null,
    readVerbs: "unknown",
    state: "off-allowlist",
    stored: true,
    usedFor: "unknown — the register has no row for this file",
    what: "unknown",
  };
}

/**
 * The `mintScope` a row prints: what the grant on disk proves when one was read, else the register's claim.
 * Only a grant is derivable — a single-line token's scopes live in somebody else's console.
 */
function derivedMintScope({ spec, grant }: { spec: CredentialSpec; grant: GrantObservation | undefined }): string {
  if (grant === undefined) {
    return spec.mintScope;
  }
  return grant.writeScopes.length > 0 ? "read-write" : "read-only";
}

/** The row a DECLARED credential gets, whether or not its file is on disk. */
function declaredRow({
  spec,
  observed,
  nowMs,
}: {
  spec: CredentialSpec;
  observed: StoreObservation | undefined;
  nowMs: number;
}): CredentialRow {
  const state = credentialState({ nowMs, observed, spec });
  const expiryIso = expiryIsoOf({ grant: observed?.grant });
  return {
    detail: stateDetail({ grant: observed?.grant, spec, state }),
    expiryKind: spec.expiry,
    mintScope: derivedMintScope({ grant: observed?.grant, spec }),
    name: spec.name,
    platform: spec.platform,
    reader: spec.reader,
    readVerbs: spec.readVerbs,
    state,
    stored: observed !== undefined,
    usedFor: spec.usedFor,
    what: spec.what,
    ...(observed === undefined ? {} : { modeOctal: observed.modeOctal, modifiedIso: observed.modifiedIso }),
    ...(observed?.grant === undefined ? {} : { account: observed.grant.account }),
    ...(expiryIso === undefined ? {} : { expiryIso }),
  };
}

/**
 * Every row `secrets status` prints: one per register entry, in the register's order, then one per stray
 * file in the store, in name order. A retired credential with no file on disk is kept here and hidden by
 * the DEFAULT report rather than dropped, because the two questions are different: the default report is
 * about this store, where a name nobody has a file for is noise the owner learns to skim past, while
 * `--all` is the only way to read the register ITSELF — and a retired name is exactly what a reader
 * checking whether a hand-placed file is still wanted has come to look up. `visibleRows`
 * (`src/cli/commands/secrets/statusCore.ts`) already excludes it without help, since an absent row is
 * neither stored nor a finding.
 *
 * @param observations what the store actually holds, in any order
 * @param nowMs the instant to judge an expiry against
 * @param specs the register to read; defaults to the shipped one, and is a parameter so a test states it
 * @returns the rows, findings included, in display order
 */
export function credentialRows({
  observations,
  nowMs,
  specs = CREDENTIALS,
}: {
  observations: readonly StoreObservation[];
  nowMs: number;
  specs?: readonly CredentialSpec[];
}): readonly CredentialRow[] {
  const stored = new Map(observations.map((entry) => [entry.name, entry]));
  const declared = specs.map((spec) => declaredRow({ nowMs, observed: stored.get(spec.name), spec }));
  const known = new Set(specs.map((spec) => spec.name));
  const strays = observations
    .filter((entry) => !known.has(entry.name))
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((observed) => strayRow({ observed }));
  return [...declared, ...strays];
}
