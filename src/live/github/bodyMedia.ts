/**
 * `github read --media-out`: the ordinary named-object read, plus the pictures and videos its body embeds.
 *
 * A private repository's attachment answers neither the API token nor its `user-attachments` URL; GitHub writes a
 * short-lived signed address for each one into `bodyHTML` instead. So this asks for the rendered body in a SECOND,
 * separate query — the ordinary read's document never carries a signed address into anything that gets printed —
 * and hands what `./media.ts` finds in it to the injected download.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import type { ProviderReadDocument, ProviderReadMedia } from "../providerRead.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import { GITHUB_ATTACHMENT_HOSTS, githubRenderedMedia } from "./media.js";
import type { GithubMediaDownload } from "./mediaDownload.js";
import { type GithubReadGraphql, parseGithubReadAddress, readGithubObject } from "./read.js";

/** The rendered body alone. Issue and pull request only: a discussion is refused before any call. */
const BODY_HTML_QUERY = `query SlopweaverReadBodyHtml($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issueOrPullRequest(number: $number) {
      ... on Issue { bodyHTML }
      ... on PullRequest { bodyHTML }
    }
  }
}`;

/** The rendered body's HTML out of a GraphQL answer, or undefined when it holds no string there. */
function bodyHtmlOf({ data }: { data: unknown }): string | undefined {
  const repository = isRecord(data) ? data["repository"] : undefined;
  const node = isRecord(repository) ? repository["issueOrPullRequest"] : undefined;
  const html = isRecord(node) ? node["bodyHTML"] : undefined;
  return typeof html === "string" ? html : undefined;
}

/**
 * Read one GitHub issue or pull request, then download the pictures and videos its body embeds.
 *
 * @param address the full GitHub object URL
 * @param graphql the safe-wrapped GraphQL seam both queries go through
 * @param limit the maximum items requested from each selected connection
 * @param nowIso the freshness clock
 * @param download fetches and writes the candidates the rendered body names
 * @returns the ordinary document with `media` added — empty when the body embeds none — or a named failure
 */
export async function readGithubObjectWithMedia({
  address,
  download,
  graphql,
  limit,
  nowIso,
}: {
  address: string;
  download: GithubMediaDownload;
  graphql: GithubReadGraphql;
  limit: number;
  nowIso: () => string;
}): Promise<Result<ProviderReadDocument, GithubLiveError>> {
  const parsed = parseGithubReadAddress({ address });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const target = parsed.value;
  if (target.kind === "discussion") {
    return err(GithubLiveErrors.mediaUnsupported({ kind: target.kind }));
  }
  const document = await readGithubObject({ address, graphql, limit, nowIso });
  if (document.isErr()) {
    return err(document.error);
  }
  const response = await graphql({
    query: BODY_HTML_QUERY,
    variables: { number: target.number, owner: target.owner, repo: target.repo },
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const html = bodyHtmlOf({ data: response.value });
  if (html === undefined) {
    return err(GithubLiveErrors.mediaUnreadable({ reason: `GitHub returned no rendered body for ${target.identity}` }));
  }
  const written = await download({ candidates: githubRenderedMedia({ allowedHosts: GITHUB_ATTACHMENT_HOSTS, html }) });
  return written.andThen((media: readonly ProviderReadMedia[]) => ok({ ...document.value, media }));
}
