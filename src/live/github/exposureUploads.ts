/**
 * Every uploaded asset a repository's text links to, and every place that links it — the `attachments` half of
 * `github exposure sweep`.
 *
 * An upload is an image or a file, not text, so the sweep never fetches or analyses its bytes: it lists each one with
 * where it is linked, for a visible session to look at. The list goes to the state home only (`uploads.jsonl`), since
 * a locator names the object linking it.
 *
 * An upload is keyed by its URL with the query and fragment removed. A `private-user-images` URL carries a signed,
 * expiring token in its query, so the same image read twice comes back under two queries; the token is also a
 * credential to that image and is never kept. The URL itself stays whole rather than reduced to an id, because
 * nothing establishes that the URL families share one id space.
 */

import type { GithubExposureSurfaceId } from "./exposureModel.js";
import type { GithubExposureText } from "./exposureTexts.js";

/**
 * An upload URL as GitHub mints it: an image asset by id, a file by id and the name it was uploaded under, the
 * repository-scoped `/<owner>/<repo>/assets|files/<id>/…` form from before `user-attachments`, or an image on either
 * upload host (`./media.ts`'s `GITHUB_ATTACHMENT_HOSTS`). A file keeps its name segment, since that is the address a
 * visible session opens.
 */
const UPLOAD_URL =
  /https:\/\/(?:github\.com\/(?:user-attachments\/(?:assets\/[A-Za-z0-9-]+|files\/[A-Za-z0-9-]+(?:\/[^\s)"'<>\]?#]+)?)|[^/\s]+\/[^/\s]+\/(?:assets|files)\/\d+\/[^\s)"'<>\]?#]+)|(?:private-)?user-images\.githubusercontent\.com\/[^\s)"'<>\]]+)/gu;

/** One place an upload is linked from: the object, and which of its fields. */
interface GithubExposureUploadLink {
  readonly surface: GithubExposureSurfaceId;
  readonly locator: string;
  readonly field: string;
}

/** One distinct upload and every distinct place linking it, in first-seen order. */
export interface GithubExposureUpload {
  readonly url: string;
  readonly linkedFrom: readonly GithubExposureUploadLink[];
}

/** An accumulator of uploads over texts taken one batch at a time; `uploads()` returns a fresh snapshot each call. */
export interface GithubExposureUploadIndex {
  readonly take: (args: { texts: readonly GithubExposureText[] }) => void;
  readonly uploads: () => readonly GithubExposureUpload[];
}

/** An upload URL without its query or fragment. */
function withoutQuery({ url }: { url: string }): string {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/** Every distinct upload URL one text links, query removed, in first-seen order. */
function uploadsIn({ text }: { text: string }): readonly string[] {
  return [...new Set([...text.matchAll(UPLOAD_URL)].map((match) => withoutQuery({ url: match[0] })))];
}

/**
 * Every distinct uploaded asset a body of text references, each with its query removed.
 *
 * @param texts the bodies read
 * @returns the distinct upload URLs, in first-seen order
 */
export function referencedUploads({ texts }: { texts: readonly string[] }): readonly string[] {
  return [...new Set(texts.flatMap((text) => uploadsIn({ text })))];
}

/**
 * An empty upload index. Each distinct `{ surface, locator, field }` is one link, however often that field repeats
 * the URL.
 *
 * @returns the index
 */
export function createGithubExposureUploadIndex(): GithubExposureUploadIndex {
  const links = new Map<string, Map<string, GithubExposureUploadLink>>();
  return {
    take: ({ texts }) => {
      for (const text of texts) {
        for (const url of uploadsIn({ text: text.text })) {
          let linked = links.get(url);
          if (linked === undefined) {
            linked = new Map<string, GithubExposureUploadLink>();
            links.set(url, linked);
          }
          linked.set([text.surface, text.locator, text.field].join("\u0000"), {
            field: text.field,
            locator: text.locator,
            surface: text.surface,
          });
        }
      }
    },
    uploads: () => [...links].map(([url, linked]) => ({ linkedFrom: [...linked.values()], url })),
  };
}

/**
 * Every upload a set of texts links, with every place linking it. Pure.
 *
 * @param texts the texts, each with the surface, locator and field it sits at
 * @returns the uploads, in first-seen order
 */
export function githubExposureUploadLinks({
  texts,
}: {
  texts: readonly GithubExposureText[];
}): readonly GithubExposureUpload[] {
  const index = createGithubExposureUploadIndex();
  index.take({ texts });
  return index.uploads();
}

/**
 * How many uploads there are and how many places link them, for a summary that must carry neither.
 *
 * @returns the two counts
 */
export function githubExposureUploadCounts({ uploads }: { uploads: readonly GithubExposureUpload[] }): {
  readonly uploads: number;
  readonly links: number;
} {
  return { links: uploads.reduce((sum, upload) => sum + upload.linkedFrom.length, 0), uploads: uploads.length };
}
