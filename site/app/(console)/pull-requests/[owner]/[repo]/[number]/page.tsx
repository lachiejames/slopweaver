import type { Metadata } from "next";
import type { ReactElement } from "react";

import { PAGE_BODY, PageHead } from "../../../../../../components/console/PageHead";
import { PullView } from "../../../../../../components/console/PullView";
import { pullAddressOfPath, pullTabOf } from "../../../../../../lib/pullAddress";

/**
 * The page's title: the pull request it is, `owner/repo#N` as its head reads, so a desktop tab opened on one takes
 * that name once it loads rather than every pull request's tab reading the same "Pull request".
 *
 * @param params the owner, repository and number off the path
 * @returns the metadata, "Pull request" for a path naming none
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
}): Promise<Metadata> {
  const address = pullAddressOfPath(await params);
  if (address === undefined) {
    return { title: "Pull request" };
  }
  return { title: `${address.repoSlug}#${String(address.number)}` };
}

/**
 * One pull request as GitHub draws it — conversation, reviews and diff — read live from GitHub when the page
 * opens, so a citation chip naming it never sends the owner out to github.com. Read-only: nothing on this page writes.
 *
 * @param params the owner, repository and number off the path, checked before any verb runs
 * @param searchParams `?tab=files` opens on the diff
 * @returns the page
 */
export default async function PullRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<ReactElement> {
  const { owner, repo, number } = await params;
  const { tab } = await searchParams;
  const address = pullAddressOfPath({ number, owner, repo });
  const sub = "one pull request, read live from GitHub, read-only";
  if (address === undefined) {
    return (
      <>
        <PageHead title="Pull request" sub={sub} />
        <div className={PAGE_BODY}>
          <p className="sw-tile-note">
            <b>NOT MEASURED</b>: {owner}/{repo}#{number} does not name a GitHub pull request
          </p>
        </div>
      </>
    );
  }
  let query: string | undefined;
  if (typeof tab === "string") {
    query = tab;
  }
  return (
    <>
      <PageHead title={`${address.repoSlug}#${String(address.number)}`} sub={sub} />
      <div className={PAGE_BODY}>
        <PullView url={address.url} initialTab={pullTabOf({ query })} />
      </div>
    </>
  );
}
