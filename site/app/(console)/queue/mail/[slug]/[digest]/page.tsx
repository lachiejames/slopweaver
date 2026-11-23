import type { ReactElement } from "react";

import { MailPreviewPage } from "../../../../../../components/console/MailPreviewPage";

export const metadata = { title: "Mail preview" };

/**
 * One board row's mail, whole — the address a queue card prints beside its mail preview.
 *
 * The slug and the digest come off the path and are only ever LOOKED UP against the board: the page never
 * draws a mail the address carries, because the address carries none.
 *
 * @param params the row's slug and the digest its preview was drawn from
 * @returns the page
 */
export default async function MailPreviewRoute({
  params,
}: {
  params: Promise<{ slug: string; digest: string }>;
}): Promise<ReactElement> {
  const { slug, digest } = await params;
  return <MailPreviewPage digest={digest} slug={decodeURIComponent(slug)} />;
}
