/**
 * The dependency-bot identities a reader recognises, every spelling GitHub uses for each — the generic Renovate
 * and Dependabot Apps, plus the organisation's own `dependencyBots` (`./core.ts`), which is the only place an
 * installation's self-hosted bot login is written. Pure.
 *
 * ## One App login, three spellings
 *
 * A GitHub App acts as an account whose REST `user.login` ends `[bot]` (`renovate[bot]`, what a CI event's
 * `pull_request.user.login` carries), whose GraphQL `author.login` is the bare login (`renovate`, typed a `Bot`),
 * and whose search qualifier is `author:app/<login>` — the bare `author:<login>` is a 422 through REST search and
 * an EMPTY list through GraphQL (`../live/github/supersedeReads.ts`). So each configured bare login becomes all
 * three, and a reader takes the spelling its own source uses rather than guessing which one it was handed.
 *
 * ## A configured bot is treated as Renovate-compatible
 *
 * The stored record is a flat list of bare App logins, so it cannot say which tool a bot runs. Every configured
 * bot but the public Dependabot is read as a self-hosted Renovate: a bump author, a description the fleet never rewrites, a table-shaped
 * body `pr-format` keeps allowing, and an author whose merges supersede its bumps. That is the only kind any
 * installation has needed; a custom bot that is NOT Renovate would need a discriminated schema
 * (`{ login, kind: "renovate" | "dependabot" }`) rather than a guess here.
 *
 * ## No organisation is a statement, an unreadable one is not
 *
 * {@link dependencyBotsOf} turns the organisation read into actors. An install with no organisation written —
 * or no store selected at all, which is the same fact one step earlier and what CI's throwaway home always is —
 * recognises the generic Renovate and Dependabot only, and says so in one note. Any other failure is a refusal:
 * an unreachable store, an unreadable row, or a row missing a field must never read as "this organisation has no
 * bot of its own".
 */
import { err, ok, type Result } from "../lib/result.js";

import type { Organisation } from "./core.js";
import type { OrganisationError } from "./errors.js";

/** The public Renovate App's bare login. */
const GENERIC_RENOVATE = "renovate";

/** The public Dependabot App's bare login. */
const GENERIC_DEPENDABOT = "dependabot";

/** Every spelling of every dependency bot a reader recognises, each list exact and free of duplicates. */
export interface DependencyBotActors {
  /** Every bump bot as GraphQL spells its author: the bare login, honoured only when GitHub typed it a `Bot`. */
  readonly bumpGraphqlAppLogins: readonly string[];
  /** Every bump bot as REST spells its author: `<login>[bot]`. */
  readonly bumpRestLogins: readonly string[];
  /** The Renovate bots among them, as GraphQL spells them. */
  readonly renovateGraphqlAppLogins: readonly string[];
  /** The Renovate bots among them, as REST and a CI event spell them. */
  readonly renovateRestLogins: readonly string[];
  /** The Renovate bots among them, as a search `author:` qualifier wants them: `app/<login>`. */
  readonly renovateSearchAuthors: readonly string[];
}

/** One list with every repeat after the first dropped, in first-seen order. */
function distinct({ values }: { values: readonly string[] }): readonly string[] {
  return [...new Set(values)];
}

/**
 * Every spelling of the generic Renovate and Dependabot Apps plus the organisation's own dependency bots.
 *
 * @param dependencyBots the organisation's own bare App logins — empty for the generic two alone
 * @returns each identity in the spelling every reader takes, generic first, deduplicated
 */
export function dependencyBotActors({ dependencyBots }: { dependencyBots: readonly string[] }): DependencyBotActors {
  const bump = distinct({ values: [GENERIC_DEPENDABOT, GENERIC_RENOVATE, ...dependencyBots] });
  // A configured bot is read as a self-hosted Renovate, except the public Dependabot named again, which stays itself.
  const ownRenovate = dependencyBots.filter((login) => login !== GENERIC_DEPENDABOT);
  const renovate = distinct({ values: [GENERIC_RENOVATE, ...ownRenovate] });
  return {
    bumpGraphqlAppLogins: bump,
    bumpRestLogins: bump.map((login) => `${login}[bot]`),
    renovateGraphqlAppLogins: renovate,
    renovateRestLogins: renovate.map((login) => `${login}[bot]`),
    renovateSearchAuthors: renovate.map((login) => `app/${login}`),
  };
}

/** The actors a reader runs with, and the one line it owes when they are the generic two alone by absence. */
export interface ResolvedDependencyBots {
  readonly bots: DependencyBotActors;
  /** Said once by the reader when no organisation is configured; `undefined` when the organisation was read. */
  readonly note: string | undefined;
}

/**
 * Whether an organisation read failed because nothing is configured, rather than because something is broken.
 *
 * `STORE_URL_MISSING` counts: a home with no store selected has written no organisation by construction, and it
 * is what every CI run's throwaway home is. An unreachable or stale store that IS selected does not.
 */
function nothingConfigured({ error }: { error: OrganisationError }): boolean {
  if (error.code === "ORG_NOT_CONFIGURED") {
    // Only NO ROW is absence. A row lacking a field — `dependencyBots` on a row written before the field existed —
    // is a record somebody has to write again, and reading it as "no bot of its own" would hide that.
    return error.missing === "organisation";
  }
  return error.code === "ORG_QUERY_FAILED" && error.cause.code === "STORE_URL_MISSING";
}

/**
 * The dependency-bot actors one organisation read implies.
 *
 * @param organisation the result of the one organisation read, taken at the caller's effectful edge
 * @returns the configured bots' actors; the generic two with a note naming why when nothing is configured; or
 *   the read's own refusal, unchanged, for any other failure
 */
export function dependencyBotsOf({
  organisation,
}: {
  organisation: Result<Organisation, OrganisationError>;
}): Result<ResolvedDependencyBots, OrganisationError> {
  if (organisation.isOk()) {
    return ok({ bots: dependencyBotActors({ dependencyBots: organisation.value.dependencyBots }), note: undefined });
  }
  if (!nothingConfigured({ error: organisation.error })) {
    return err(organisation.error);
  }
  return ok({
    bots: dependencyBotActors({ dependencyBots: [] }),
    note:
      "only the generic Renovate (renovate[bot]) and Dependabot (dependabot[bot]) are recognised as dependency " +
      `bots — ${organisation.error.message}`,
  });
}
