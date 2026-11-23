/**
 * `slopweaver page read <slug> --presentation` — every file one published page serves, each with a short-lived signed
 * read address, so the console's page route can show a page held only in the store
 * (`../../../store/publishedPages/presentation.ts` carries why one answer covers every image).
 *
 * The console cannot import `src/`, so `site/lib/pagePresentation.ts` decodes the `--json` document this prints, and
 * that document is the contract: `kind` says whether the page is there, and a store that cannot be read is its own
 * kind, never a page that is not. The exit code says the same thing for a shell: 0 shown, 3 not published, 1 the store
 * could not answer. It writes nothing.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { isValidPageSlug } from "../../../pages/url.js";
import { type PagePresentation, PRESENTATION_EXPIRY_SECONDS } from "../../../store/publishedPages/presentation.js";
import { withPublishedPagesReader } from "../../../store/publishedPages/read.js";
import type { PublishedPagesReadError } from "../../../store/publishedPages/readErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { PAGE_READ_USAGE } from "./usage.js";

/** `page read`'s flags. */
const PAGE_READ_FLAGS: FlagSpec = { boolean: ["json", "presentation"], string: ["home"] };

/** Every flag `page read` accepts, so `--help`'s advertised usage is checked against the parser. */
export const PAGE_READ_FLAG_NAMES: readonly string[] = ["--presentation", "--json", "--home"];

/** What one `page read` was asked. */
interface PageReadOptions {
  readonly slug: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The one document `page read --presentation --json` prints: the page, its absence, or why the store could not say. */
export type PagePresentationDocument =
  | {
      readonly schemaVersion: 1;
      readonly kind: "page";
      readonly slug: string;
      readonly expiresInSeconds: number;
      readonly files: PagePresentation["files"];
    }
  | { readonly schemaVersion: 1; readonly kind: "not-found"; readonly slug: string }
  | {
      readonly schemaVersion: 1;
      readonly kind: "store-unreadable";
      readonly slug: string;
      readonly code: string;
      readonly message: string;
    };

/** The seams `page read` performs its effects through. */
export interface PageReadDeps {
  /** Every file the page serves, signed, from the store this home selects. */
  readonly presentation: (args: {
    home: string;
    slug: string;
  }) => Promise<Result<PagePresentation, PublishedPagesReadError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Read `page read`'s arguments: exactly one slug, and `--presentation`, the one read it makes today.
 *
 * @param rest the argv tail after `page read`
 * @returns the options, or every problem with them
 */
export function pageReadOptions({ rest }: { rest: readonly string[] }): Result<PageReadOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PAGE_READ_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  const problems: string[] = [];
  const [slug] = positionals;
  if (positionals.length !== 1 || slug === undefined) {
    problems.push(`page read takes exactly one slug, got ${String(positionals.length)}`);
  } else if (!isValidPageSlug({ slug })) {
    problems.push(`"${slug}" is not a page slug`);
  }
  if (values["presentation"] !== true) {
    problems.push("--presentation is required: it is the one read `page read` makes");
  }
  if (problems.length > 0 || slug === undefined) {
    return err(problems);
  }
  const home = values["home"];
  return ok({ home: typeof home === "string" ? home : undefined, json: values["json"] === true, slug });
}

/**
 * The document one read prints, from what the store answered.
 *
 * @param slug the page asked for
 * @param read the store's answer
 * @returns the document
 */
export function presentationDocument({
  slug,
  read,
}: {
  slug: string;
  read: Result<PagePresentation, PublishedPagesReadError>;
}): PagePresentationDocument {
  if (read.isOk()) {
    const { expiresInSeconds, files } = read.value;
    return { expiresInSeconds, files, kind: "page", schemaVersion: 1, slug };
  }
  if (read.error.code === "PAGES_NOT_PUBLISHED") {
    return { kind: "not-found", schemaVersion: 1, slug };
  }
  return { code: read.error.code, kind: "store-unreadable", message: read.error.message, schemaVersion: 1, slug };
}

/**
 * What one read prints for a person: each file and its size, never an address, since an address is a capability.
 *
 * @param document what `--json` would print for the same read
 * @returns the lines
 */
export function presentationLines({ document }: { document: PagePresentationDocument }): readonly string[] {
  if (document.kind === "not-found") {
    return [`page read: the store holds no published page ${document.slug}`];
  }
  if (document.kind === "store-unreadable") {
    return [`page read: ${document.message}`];
  }
  return [
    `${document.slug}: ${String(document.files.length)} file(s), signed for ${String(document.expiresInSeconds)}s`,
    ...document.files.map((file) => `  ${file.relativePath}  ${String(file.byteLength)} bytes`),
  ];
}

/**
 * Run `page read` against injected seams.
 *
 * @param rest the argv tail after `page read`
 * @param deps the store read and the two sinks
 * @returns 0 when the page is shown, 3 when it is not published, 1 when the store could not say, 2 on bad arguments
 */
export async function runPageRead({ rest, deps }: { rest: readonly string[]; deps: PageReadDeps }): Promise<number> {
  const options = pageReadOptions({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, PAGE_READ_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const { json, slug } = options.value;
  const read = await deps.presentation({ home: resolveHome({ named: options.value.home }), slug });
  const document = presentationDocument({ read, slug });
  if (json) {
    deps.writeOut(JSON.stringify(document));
  } else if (document.kind === "page") {
    for (const line of presentationLines({ document })) {
      deps.writeOut(line);
    }
  } else {
    for (const line of presentationLines({ document })) {
      deps.writeDiagnostic(line);
    }
  }
  if (document.kind === "page") {
    return EXIT_OK;
  }
  return document.kind === "not-found" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
}

/**
 * The production seams: the store this home selects, and the two output channels.
 *
 * @returns the dependencies `page read` runs on
 */
export function productionPageReadDeps(): PageReadDeps {
  return {
    presentation: ({ home, slug }) =>
      withPublishedPagesReader({
        home,
        read: (reader) => reader.presentation({ expiresInSeconds: PRESENTATION_EXPIRY_SECONDS, pageKey: slug }),
      }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver page read`. */
export const pageReadCommand = defineCommand({
  run: (argv) => runPageRead({ deps: productionPageReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
