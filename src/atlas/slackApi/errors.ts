/**
 * The typed refusals the Slack atlas authors: a generation that would straddle an `@slack/web-api` major, two
 * different things claiming one entity id, and a walk document that is not JSON at all.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to `src/atlas/slackApi/`. Every one of
 * these leaves the directory through a kit seam or a CLI printer typed `readonly string[]` — the publish
 * guard, the merge fold, the walk-document parse — so each is built here and turned into lines by
 * {@link slackAtlasErrorLines} at the `err(...)` that authors it.
 *
 * No field carries a workspace id or a token. A page's provider id is a path that can name the team, and a
 * JSON parser's reason can quote the document, so both reach the rendered TEXT exactly as before and neither
 * is stored as a field; the parse failure keeps only the file it read.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** A refusal said in one sentence. */
interface Sentence<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A refusal said over several lines, each printed on its own. */
interface Lines<C extends string> extends Sentence<C> {
  readonly reasons: readonly string[];
}

/**
 * Every refusal the Slack atlas authors.
 * @internal
 */
export type SlackAtlasError =
  Lines<"SDK_MAJOR_CROSSED"> | Lines<"IDENTITY_CLASH"> | (Sentence<"SESSION_NOT_JSON"> & { readonly source: string });

/** A several-line refusal, whose `message` joins its lines the way a one-line display reads them. */
function lines<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Lines<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How each refusal is raised — the one place its words live, so a test built from it catches a drift. */
export const SlackAtlasErrors = {
  identityClash: ({
    observed,
    stored,
  }: {
    observed: { id: string; kind: string; providerId: string };
    stored: { kind: string; providerId: string };
  }): SlackAtlasError =>
    lines({
      code: "IDENTITY_CLASH",
      reasons: [
        `entity ${observed.id} is stored as ${stored.kind}/${stored.providerId} and this run saw ${observed.kind}/${observed.providerId}`,
        "refusing to merge — two different things sharing one identity is how an atlas starts reporting a thing that never existed",
      ],
    }),
  sdkMajorCrossed: ({ after, before, remedy }: { after: string; before: string; remedy: string }): SlackAtlasError =>
    lines({
      code: "SDK_MAJOR_CROSSED",
      reasons: [
        `this generation was published from @slack/web-api ${before} and this build reads ${after}`,
        "a major bump renames and removes methods, so accumulating across one would mark the old major's methods stale — which reads as Slack having removed them",
        remedy,
      ],
    }),
  sessionNotJson: ({ cause, source }: { cause: unknown; source: string }): SlackAtlasError => ({
    code: "SESSION_NOT_JSON",
    message: `${source} is not valid JSON: ${errorMessage({ error: cause })}`,
    source,
  }),
} as const;

/**
 * The lines a {@link SlackAtlasError} prints: each of a several-line refusal's reasons on its own line, as
 * the `readonly string[]` it replaced did, and a one-sentence refusal as its message.
 *
 * @param error the Slack atlas refusal being printed
 * @returns one line per reason, in the order they are read
 */
export function slackAtlasErrorLines({ error }: { error: SlackAtlasError }): readonly string[] {
  if (error.code === "SDK_MAJOR_CROSSED" || error.code === "IDENTITY_CLASH") {
    return error.reasons;
  }
  return [error.message];
}
