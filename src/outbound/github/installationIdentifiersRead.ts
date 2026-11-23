/**
 * The installation's own identifiers for ONE GitHub write, read once at the verb's shell and handed to the PR gate,
 * or read by the write transport's privacy guard (`./writePrivacy.ts`) for the repository a request targets
 * (`../../hygiene/installationIdentifiers.ts` says what they forgive and why).
 *
 * Every value comes from the install's own state, never a constant and never git:
 *
 * - **which repositories keep the full refusal**: this build's own, derived from its checkout's `origin` by the
 *   organisation read, and {@link SOURCE_REPOSITORY}, the public source address. A target that is either gets no
 *   forgiveness at all.
 * - **Linear team keys**: every team a `slopweaver linear states --team <KEY>` read recorded under the home that
 *   Linear itself reported as belonging to the organisation's current Linear workspace, plus the derived silver
 *   directory's keys when that directory names exactly that workspace — a catalog or directory naming another
 *   workspace, or none, may be another token's or an earlier installation's, so it grants nothing. And every key the
 *   profile STATES in `linear.teamKeys`, which needs no Linear token and no ingestion — counted only while the
 *   organisation names a Linear workspace at all, since `linearWorkspace: null` says it has no Linear.
 * - **the Linear workspace label**: the organisation's `linearWorkspace`.
 * - **people**: the profile's own persona, `displayName` and `gitNamespace`, exactly as written. The derived person
 *   roster is NOT used: it holds every provider-directory member, guests included, with no field saying who belongs
 *   to the organisation.
 *
 * A read that fails narrows what is forgiven and is REPORTED, never silently swallowed: the shell prints each
 * `unread` line, and the gate then refuses exactly as strictly as it did before this existed. An unresolvable
 * self repository forgives nothing, because nothing then proves the target is not this build's own.
 */
import { type LinearReferenceFacts, linearReferenceFacts } from "../../cli/linearReferenceFacts.js";
import { type InstallationIdentifiers, installationIdentifiersOf } from "../../hygiene/installationIdentifiers.js";
import { SOURCE_REPOSITORY } from "../../hygiene/ownRepository.js";
import type { Organisation } from "../../organisation/core.js";
import { readOrganisation } from "../../organisation/read.js";
import type { Profile } from "../../profile.js";
import { readProfile } from "../../profileStore.js";
import { stateCatalogTeams } from "../linear/stateCatalog.js";

/** What one read produced: the identifiers to forgive, or none, and every input that could not be read. */
export interface InstallationIdentifiersRead {
  readonly identifiers: InstallationIdentifiers | undefined;
  readonly unread: readonly string[];
}

/** The reader a verb's deps carry, so a test hands in a plain function rather than reaching a store. */
export type InstallationIdentifiersReader = (args: {
  home: string;
  targetRepository: string;
}) => Promise<InstallationIdentifiersRead>;

/**
 * Assemble the identifiers for one target from inputs already read. Pure.
 *
 * @param targetRepository the pull request's `owner/repo`, in any case
 * @param organisation the organisation read, or undefined when it could not be read
 * @param catalogTeams the team keys the home's `linear states` catalogs recorded, each with the workspace the
 *   organisation named when it was recorded
 * @param silver the derived silver directory's Linear facts
 * @param profile the profile, or null when there is none or it could not be read: its people, and the team keys it
 *   states, those counted only while the organisation names a Linear workspace
 * @returns the identifiers, or undefined when the target keeps the full refusal or the self repository is unknown
 */
export function installationIdentifiersFor({
  targetRepository,
  organisation,
  catalogTeams,
  silver,
  profile,
}: {
  targetRepository: string;
  organisation: Organisation | undefined;
  catalogTeams: readonly { readonly teamKey: string; readonly workspace: string | undefined }[];
  silver: LinearReferenceFacts;
  profile: Profile | null;
}): InstallationIdentifiers | undefined {
  if (organisation === undefined) {
    return undefined;
  }
  const target = targetRepository.toLowerCase();
  if (target === organisation.selfRepository || target === SOURCE_REPOSITORY.toLowerCase()) {
    return undefined;
  }
  const workspace = organisation.linearWorkspace;
  const silverMatches = workspace !== null && silver.workspaceSlug === workspace;
  const silverKeys = silverMatches ? silver.teamKeys : [];
  const catalogKeys = catalogTeams.filter((team) => workspace !== null && team.workspace === workspace);
  const people = profile === null ? [] : [profile.displayName, profile.gitNamespace];
  const statedKeys = workspace !== null && profile !== null ? profile.linear.teamKeys : [];
  return installationIdentifiersOf({
    linearTeamKeys: [...catalogKeys.map((team) => team.teamKey), ...silverKeys, ...statedKeys],
    personNames: people,
    providerLocationLabels: workspace === null ? [] : [workspace],
  });
}

/**
 * Read the install's state and assemble the identifiers for one target.
 *
 * @param home the state home every input is read under
 * @param targetRepository the pull request's `owner/repo`
 * @returns the identifiers, or none, with a line for every input that could not be read
 */
export async function readInstallationIdentifiers({
  home,
  targetRepository,
}: {
  home: string;
  targetRepository: string;
}): Promise<InstallationIdentifiersRead> {
  const unread: string[] = [];
  const organisation = await readOrganisation({ home });
  if (organisation.isErr()) {
    unread.push(`the organisation (${organisation.error.code}: ${organisation.error.message})`);
  }
  const profile = readProfile({ home });
  if (profile.isErr()) {
    unread.push(`the profile (${profile.error.message})`);
  }
  const identifiers = installationIdentifiersFor({
    catalogTeams: stateCatalogTeams({ home }),
    organisation: organisation.isOk() ? organisation.value : undefined,
    profile: profile.isOk() ? profile.value : null,
    silver: linearReferenceFacts({ home }),
    targetRepository,
  });
  return { identifiers, unread };
}

/**
 * Read the identifiers for one target through a verb's injected reader, printing a note for each unread input.
 *
 * @param deps the verb's reader, and the sink its notes go to
 * @param home the state home every input is read under
 * @param targetRepository the pull request's `owner/repo`
 * @returns the identifiers to forgive, or undefined to forgive none
 */
export async function reportedInstallationIdentifiers({
  deps,
  home,
  targetRepository,
}: {
  deps: { installationIdentifiers: InstallationIdentifiersReader; out: (input: { line: string }) => void };
  home: string;
  targetRepository: string;
}): Promise<InstallationIdentifiers | undefined> {
  const read = await deps.installationIdentifiers({ home, targetRepository });
  for (const line of installationUnreadLines({ read })) {
    deps.out({ line });
  }
  return read.identifiers;
}

/**
 * The note a shell prints for each input the read could not reach, so a refusal that follows is explained.
 *
 * @param read what the read produced
 * @returns one line per unread input, none when every input was read
 */
export function installationUnreadLines({ read }: { read: InstallationIdentifiersRead }): readonly string[] {
  return read.unread.map(
    (what) => `note: could not read ${what}, so the PR gate forgives none of the installation's identifiers it names`,
  );
}
