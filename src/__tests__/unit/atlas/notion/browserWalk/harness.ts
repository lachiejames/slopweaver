/*
 * What the Notion browser-walk test files share: an in-memory artifact writer, the probe's own answer, and a
 * lookup of one page's observation by its surface name. Pure; nothing here touches a disk.
 */
import { NOTION_WEB_ORIGIN } from "../../../../../atlas/notion/browserPages.js";
import type { NotionArtifactWriter, NotionPageObservation } from "../../../../../atlas/notion/browserWalk.js";
import { ok } from "../../../../../lib/result.js";

import type { FakeVisit } from "../../../../walkTransportFake.js";

/** Where the probe lands on a signed-in client, with a synthetic workspace name. */
const PROBE_LANDING = `${NOTION_WEB_ORIGIN}/p/acme/Notes-0123456789abcdef0123456789abcdef`;

/**
 * A writer that always succeeds and records what it was asked to store.
 *
 * @returns the writer, beside the relative paths it has been asked to store so far
 */
export function recordingWriter(): { write: NotionArtifactWriter; stored: string[] } {
  const stored: string[] = [];
  return {
    stored,
    write: ({ relativePath }) => {
      stored.push(relativePath);
      return ok(null);
    },
  };
}

/**
 * The probe's own answer, which every walk makes first.
 *
 * @returns the fake visit for the client's root, settling on the given landing URL
 */
export function probeVisit({ landing = PROBE_LANDING }: { landing?: string } = {}): Readonly<
  Record<string, FakeVisit>
> {
  return { [`${NOTION_WEB_ORIGIN}/`]: { capture: { finalUrl: landing } } };
}

/**
 * Find one declared page's observation by its surface name.
 *
 * @returns the observation whose surface matches, asserted present
 */
export function bySurface({
  pages,
  surface,
}: {
  pages: readonly NotionPageObservation[];
  surface: string;
}): NotionPageObservation {
  return pages.find((page) => page.surface === surface)!;
}
