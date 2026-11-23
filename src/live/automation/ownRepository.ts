/**
 * WHICH repository this install's own-repository rows drive: the one declared main checkout whose `origin` repository
 * is named `slopweaver`, whatever its owner, read wherever the process stands.
 *
 * **Never the running checkout**: `automation due` and `register-standing` may run anywhere, and a row's subject must
 * not depend on that. **Never a fallback to `SOURCE_REPOSITORY`**: a valid-looking slug GitHub cannot resolve reads as
 * zero open pull requests, which is the defect (`./standingOwnRepositoryRows.ts`). So a home that resolves none, or
 * two, declares neither row and says so.
 *
 * **Each `origin` is read once.** The slug the selection matched on IS the answer, so a second read can neither
 * disagree with it nor time out alone; that second read once made a loaded test run flake. The reader is a seam
 * (`originOf`), threaded through every caller, so a unit test drives the resolution without git.
 *
 * **Residue, stated rather than discovered**: `checkoutForRepoName` drops a checkout whose `origin` read fails, its 3s
 * bound (`src/config.ts`) included, as it does for every caller. On a machine slow enough to time one out, a home
 * declaring two `slopweaver` checkouts can resolve to the one that answered: a real declared origin, never a
 * compiled-in slug, and the next unhurried pass reads the home as ambiguous again.
 */
import { SOURCE_REPOSITORY } from "../../hygiene/ownRepository.js";
import { ok, type Result } from "../../lib/result.js";
import { type CheckoutNameError, checkoutForRepoName, originSlugOf } from "../checkout/checkoutForRepo.js";
import { type OwnRepositoryStoreError, readOwnRepositories } from "./ownRepositoryStore.js";

/** The name a declared checkout's `origin` carries when it is this repository. */
const OWN_REPOSITORY_NAME = "slopweaver";

/** Why no single repository is this install's own. */
export type OwnRepositoryResolutionError = CheckoutNameError;

/** What this install declares about its own repository — the one value `due`, `register-standing` and `retire` share. */
export type OwnRepositoryDeclaration =
  | {
      readonly kind: "resolved";
      /** The canonical lower-case `owner/name` the rows drive. */
      readonly repository: string;
      /** Every address an earlier build or pass may have written into the rows. */
      readonly supersededRepositories: readonly string[];
    }
  | { readonly kind: "unresolved"; readonly error: OwnRepositoryResolutionError };

/** A declaration that resolved or could not, as a report carries it. */
type ComposedOwnRepositoryState =
  | { readonly kind: "resolved"; readonly repository: string }
  | { readonly kind: "unresolved"; readonly code: OwnRepositoryResolutionError["code"]; readonly message: string };

/** What a report says about the own repository, `automation due --json` included: which, why none, or an unread history. */
export type OwnRepositoryState =
  ComposedOwnRepositoryState | { readonly kind: "history-unreadable"; readonly message: string };

/**
 * Reduce a declaration to what a report says about it.
 *
 * @param ownRepository the declaration the rows were composed with
 * @returns the state to report
 */
export function ownRepositoryStateOf({
  ownRepository,
}: {
  readonly ownRepository: OwnRepositoryDeclaration;
}): ComposedOwnRepositoryState {
  if (ownRepository.kind === "resolved") {
    return { kind: "resolved", repository: ownRepository.repository };
  }
  return { code: ownRepository.error.code, kind: "unresolved", message: ownRepository.error.message };
}

/**
 * The one line saying the two rows are undeclared and why.
 *
 * @param state the unresolved state
 * @returns the line to print, without a verb's prefix
 */
export function ownRepositoryUnresolvedLine({
  state,
}: {
  readonly state: Extract<OwnRepositoryState, { readonly kind: "unresolved" }>;
}): string {
  return (
    "OWN REPOSITORY UNRESOLVED — bump-drive-slopweaver and bump-fix-slopweaver are not declared on this install, " +
    `and a stored copy of either still fires as written, compared with nothing: ${state.message}`
  );
}

/**
 * Resolve this install's own repository from its declared checkouts. Each checkout's `origin` is read ONCE: the slug the
 * selection matched on is the slug returned, so no second read can disagree with the first or time out alone.
 *
 * @param home the state home whose profile declares the main checkouts
 * @param originOf one checkout's own `origin` slug, injectable so a unit test needs no git
 * @returns the canonical lower-case `owner/name`, or why no single one resolves
 */
export function resolveOwnRepository({
  home,
  originOf = originSlugOf,
}: {
  readonly home: string;
  readonly originOf?: (args: { cwd: string }) => string | undefined;
}): Result<string, OwnRepositoryResolutionError> {
  const read = new Map<string, string | undefined>();
  const recorded = ({ cwd }: { cwd: string }): string | undefined => {
    const slug = originOf({ cwd });
    read.set(cwd, slug);
    return slug;
  };
  return checkoutForRepoName({ home, name: OWN_REPOSITORY_NAME, originOf: recorded }).map(
    // The selection matched on this checkout's slug, so it was read and was not `undefined`.
    (checkout) => read.get(checkout)!.toLowerCase(),
  );
}

/**
 * Read one home's declaration: the current address, and every address its rows may still hold. A resolution failure is
 * a STATE, since a fresh home still declares every other row, and it is answered first: an unresolved home compares
 * nothing against the history, so a bad one must not hide that its stored rows still fire. On a resolved home an
 * unreadable history is an error, since read as empty it would leave a moved row reading as somebody's edit.
 *
 * @param home the state home to read
 * @param originOf one checkout's own `origin` slug, injectable so a unit test needs no git
 * @returns the declaration, or why the history could not be read
 */
export function ownRepositoryDeclaration({
  home,
  originOf = originSlugOf,
}: {
  readonly home: string;
  readonly originOf?: (args: { cwd: string }) => string | undefined;
}): Result<OwnRepositoryDeclaration, OwnRepositoryStoreError> {
  const resolved = resolveOwnRepository({ home, originOf });
  if (resolved.isErr()) {
    return ok({ error: resolved.error, kind: "unresolved" });
  }
  return readOwnRepositories({ home }).map((recorded): OwnRepositoryDeclaration => ({
    kind: "resolved",
    repository: resolved.value,
    // The compiled-in address is what every install written before this declaration holds.
    supersededRepositories: [SOURCE_REPOSITORY, ...recorded],
  }));
}
