/**
 * What `slopweaver page read <slug> --presentation --json` answered, decoded: every file a published page serves, each
 * with a short-lived signed address the console's server fetches its bytes from, or that the page is not there, or that
 * the store could not say. The verb is `src/cli/commands/page/readRun.ts`; its `--json` document is the contract, and
 * this file is the one place the console reads it.
 *
 * The verb prints that document whether it exits 0, 3 or 1, so the decoder reads stdout from either arm of the
 * outcome, and believes a kind only with its own exit. A child that never finished, printed anything else, or printed a
 * kind under another exit, is a store that could not say — never a page that is not there, because nothing established
 * that it is not.
 *
 * Pure: the route runs the verb (`./spawnVerb.ts`) and hands its outcome here.
 */
import { z } from "zod";

import type { SpawnOutcome } from "./spawnVerb";

/** The verb line, as a failure names it. */
export const PAGE_PRESENTATION_TITLE = "slopweaver page read <slug> --presentation --json";

/** How long the console gives the verb: one store query and one signing request, with a cold CLI start. */
export const PAGE_PRESENTATION_TIMEOUT_MS = 20_000;

/** One file the page serves, as the console fetches it. */
export interface PresentedFile {
  readonly sha256: string;
  readonly byteLength: number;
  readonly signedUrl: string;
}

/** What asking for one page came to. */
export type PresentationRead =
  | {
      readonly kind: "page";
      readonly expiresInSeconds: number;
      /** Keyed by the path under the page, `/`-separated. */
      readonly files: ReadonlyMap<string, PresentedFile>;
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "store-unreadable"; readonly why: string };

const SHA256 = /^[0-9a-f]{64}$/u;

/** The exit each kind is printed with (`src/cli/commands/page/readRun.ts`); a document with any other is not believed. */
const EXIT_OF_KIND = { "not-found": 3, page: 0, "store-unreadable": 1 } as const;

const DOCUMENT = z.discriminatedUnion("kind", [
  z.object({
    expiresInSeconds: z.number().int().positive(),
    files: z.array(
      z.object({
        byteLength: z.number().int().nonnegative(),
        relativePath: z.string().min(1),
        sha256: z.string().regex(SHA256),
        signedUrl: z.url({ protocol: /^https?$/u }),
      }),
    ),
    kind: z.literal("page"),
    schemaVersion: z.literal(1),
    slug: z.string(),
  }),
  z.object({ kind: z.literal("not-found"), schemaVersion: z.literal(1), slug: z.string() }),
  z.object({
    code: z.string(),
    kind: z.literal("store-unreadable"),
    message: z.string(),
    schemaVersion: z.literal(1),
    slug: z.string(),
  }),
]);

/**
 * The verb's arguments for one page.
 *
 * @param slug the page's slug, already checked against the slug alphabet
 * @returns the argv after `slopweaver`
 */
export function pagePresentationArgv({ slug }: { slug: string }): readonly string[] {
  return ["page", "read", slug, "--presentation", "--json"];
}

/**
 * Decode one run of the verb for the slug asked.
 *
 * @param outcome the verb's run
 * @param slug the slug asked for; a document about another is refused
 * @returns the page's files, its absence, or why the store could not say
 */
export function presentationOf({ outcome, slug }: { outcome: SpawnOutcome; slug: string }): PresentationRead {
  if (!outcome.ok && outcome.exitCode === undefined) {
    return { kind: "store-unreadable", why: `${PAGE_PRESENTATION_TITLE} did not finish` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.out);
  } catch {
    return { kind: "store-unreadable", why: `${PAGE_PRESENTATION_TITLE} printed something that is not JSON` };
  }
  const document = DOCUMENT.safeParse(parsed);
  if (!document.success || document.data.slug !== slug) {
    return { kind: "store-unreadable", why: `${PAGE_PRESENTATION_TITLE} printed no presentation of ${slug}` };
  }
  const read = document.data;
  // An exit 1 printing `not-found` is not a 404: the store could not say.
  const exitCode = outcome.ok ? 0 : outcome.exitCode;
  if (exitCode !== EXIT_OF_KIND[read.kind]) {
    return {
      kind: "store-unreadable",
      why: `${PAGE_PRESENTATION_TITLE} exited ${String(exitCode)} printing ${read.kind}, which it never does`,
    };
  }
  if (read.kind === "not-found") {
    return { kind: "not-found" };
  }
  if (read.kind === "store-unreadable") {
    return { kind: "store-unreadable", why: read.message };
  }
  return {
    expiresInSeconds: read.expiresInSeconds,
    files: new Map(read.files.map(({ relativePath, ...file }) => [relativePath, file])),
    kind: "page",
  };
}
