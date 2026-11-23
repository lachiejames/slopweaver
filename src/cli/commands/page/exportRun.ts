/**
 * `slopweaver page export <slug> --out <file>` — one published page written out of the store as a single file carrying
 * its own images, once, to the path the caller names (`docs/store/published-pages.md`): the
 * store is a page's only copy, and Reveal in Finder copies one out on demand to drag into Slack. The desktop shell is
 * the caller: it makes a private temporary directory, names the file in it, and reveals what this wrote.
 *
 * The file is created, never replaced, and readable by its owner only: a path that already exists is refused, so a
 * caller cannot be steered into overwriting something. Nothing else is written and nothing is kept; the page stays in
 * the store. Every file the page loads by attribute is inlined (`../../../pages/selfContained.ts`), and a page file
 * it still names and cannot carry is reported, never dropped.
 *
 * `--json` prints one document whose `kind` says what happened. The exit code says the same for a shell: 0 written,
 * 3 not published, 1 the store could not answer or the file could not be written, 2 bad arguments.
 */
import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { type NotInlined, selfContainedPage } from "../../../pages/selfContained.js";
import { isValidPageSlug, PAGE_FILENAME } from "../../../pages/url.js";
import type { HeldPageFile } from "../../../store/publishedPages/presentation.js";
import { withPublishedPagesReader } from "../../../store/publishedPages/read.js";
import type { PublishedPagesReadError } from "../../../store/publishedPages/readErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { PAGE_EXPORT_USAGE } from "./usage.js";

/** `page export`'s flags. */
const PAGE_EXPORT_FLAGS: FlagSpec = { boolean: ["json"], string: ["home", "out"] };

/** Every flag `page export` accepts, so `--help`'s advertised usage is checked against the parser. */
export const PAGE_EXPORT_FLAG_NAMES: readonly string[] = ["--out", "--json", "--home"];

/** What one `page export` was asked. */
interface PageExportOptions {
  readonly slug: string;
  readonly out: string;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The one document `page export --json` prints. */
export type PageExportDocument =
  | {
      readonly schemaVersion: 1;
      readonly kind: "exported";
      readonly slug: string;
      readonly path: string;
      readonly byteLength: number;
      readonly inlined: readonly string[];
      readonly notInlined: readonly NotInlined[];
    }
  | { readonly schemaVersion: 1; readonly kind: "not-found"; readonly slug: string }
  | {
      readonly schemaVersion: 1;
      readonly kind: "store-unreadable";
      readonly slug: string;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: "write-failed";
      readonly slug: string;
      readonly path: string;
      readonly message: string;
    };

/** The seams `page export` performs its effects through. */
export interface PageExportDeps {
  /** Every file the page serves with its bytes, the document first, from the store this home selects. */
  readonly files: (args: {
    home: string;
    slug: string;
  }) => Promise<Result<readonly HeldPageFile[], PublishedPagesReadError>>;
  /** Create the file with these bytes, refusing one that already exists. */
  readonly create: (args: { path: string; bytes: Uint8Array }) => Result<void>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Read `page export`'s arguments: exactly one slug, and the absolute file to create.
 *
 * @param rest the argv tail after `page export`
 * @returns the options, or every problem with them
 */
export function pageExportOptions({ rest }: { rest: readonly string[] }): Result<PageExportOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PAGE_EXPORT_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  const problems: string[] = [];
  const [slug] = positionals;
  if (positionals.length !== 1 || slug === undefined) {
    problems.push(`page export takes exactly one slug, got ${String(positionals.length)}`);
  } else if (!isValidPageSlug({ slug })) {
    problems.push(`"${slug}" is not a page slug`);
  }
  const out = values["out"];
  if (typeof out !== "string" || !isAbsolute(out)) {
    problems.push("--out is required and must be an absolute path: the one file this export creates");
  }
  if (problems.length > 0 || slug === undefined || typeof out !== "string") {
    return err(problems);
  }
  const home = values["home"];
  return ok({ home: typeof home === "string" ? home : undefined, json: values["json"] === true, out, slug });
}

/**
 * The one file a page's held files make, from what the store answered.
 *
 * @param files every file the page serves, the document first
 * @param slug the page, whose served address its references resolve from
 * @returns the document, carrying every file it loads by attribute
 */
export function exportedPage({
  files,
  slug,
}: {
  files: readonly HeldPageFile[];
  slug: string;
}): ReturnType<typeof selfContainedPage> {
  const document = files.find((file) => file.relativePath === PAGE_FILENAME)!;
  return selfContainedPage({
    document: new TextDecoder().decode(document.bytes),
    files: new Map(files.map((file) => [file.relativePath, file.bytes])),
    slug,
  });
}

/**
 * What one export prints for a person.
 *
 * @param document what `--json` would print for the same export
 * @returns the lines
 */
export function exportLines({ document }: { document: PageExportDocument }): readonly string[] {
  if (document.kind === "not-found") {
    return [`page export: the store holds no published page ${document.slug}`];
  }
  if (document.kind !== "exported") {
    return [`page export: ${document.message}`];
  }
  return [
    `${document.slug}: wrote ${document.path}, ${String(document.byteLength)} bytes, ${String(document.inlined.length)} file(s) carried inside it`,
    ...document.notInlined.map(({ reference, why }) => `  still names ${reference} (${why}), which a copy cannot load`),
  ];
}

/**
 * Read the page, build its one file and create it.
 *
 * @param options what was asked
 * @param deps the store read and the file create
 * @returns the document describing what happened
 */
async function exportDocument({
  options,
  deps,
}: {
  options: PageExportOptions;
  deps: PageExportDeps;
}): Promise<PageExportDocument> {
  const { out, slug } = options;
  const read = await deps.files({ home: resolveHome({ named: options.home }), slug });
  if (read.isErr()) {
    if (read.error.code === "PAGES_NOT_PUBLISHED") {
      return { kind: "not-found", schemaVersion: 1, slug };
    }
    return { code: read.error.code, kind: "store-unreadable", message: read.error.message, schemaVersion: 1, slug };
  }
  const page = exportedPage({ files: read.value, slug });
  const bytes = new TextEncoder().encode(page.html);
  const created = deps.create({ bytes, path: out });
  if (created.isErr()) {
    return { kind: "write-failed", message: created.error.join("; "), path: out, schemaVersion: 1, slug };
  }
  const { inlined, notInlined } = page;
  return { byteLength: bytes.byteLength, inlined, kind: "exported", notInlined, path: out, schemaVersion: 1, slug };
}

/**
 * Run `page export` against injected seams.
 *
 * @param rest the argv tail after `page export`
 * @param deps the store read, the file create and the two sinks
 * @returns 0 when written, 3 when the page is not published, 1 when the store or the write failed, 2 on bad arguments
 */
export async function runPageExport({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: PageExportDeps;
}): Promise<number> {
  const options = pageExportOptions({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, PAGE_EXPORT_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const document = await exportDocument({ deps, options: options.value });
  const sink = document.kind === "exported" ? deps.writeOut : deps.writeDiagnostic;
  if (options.value.json) {
    deps.writeOut(JSON.stringify(document));
  } else {
    for (const line of exportLines({ document })) {
      sink(line);
    }
  }
  if (document.kind === "exported") {
    return EXIT_OK;
  }
  return document.kind === "not-found" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
}

/**
 * The production seams: the store this home selects, an exclusive owner-only create, and the two output channels.
 *
 * @returns the dependencies `page export` runs on
 */
export function productionPageExportDeps(): PageExportDeps {
  return {
    create: ({ bytes, path }) => {
      try {
        writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
        return ok(undefined);
      } catch (cause) {
        return err([cause instanceof Error ? cause.message : String(cause)]);
      }
    },
    files: ({ home, slug }) => withPublishedPagesReader({ home, read: (reader) => reader.files({ pageKey: slug }) }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver page export`. */
export const pageExportCommand = defineCommand({
  run: (argv) => runPageExport({ deps: productionPageExportDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
