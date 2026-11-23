/** The effectful shell for all three typed named-object readers. */

import { githubToken, linearToken, notionToken } from "../../../config.js";
import { makeAttachmentTransport } from "../../../corpus/notion/attachmentTransport.js";
import { makeNotionNamedReadApi } from "../../../corpus/notion/liveApi.js";
import { logger } from "../../../lib/logger.js";
import { scopeIdForToken } from "../../../lib/providerCall.js";
import { err, type Result } from "../../../lib/result.js";
import { readGithubObjectWithMedia } from "../../../live/github/bodyMedia.js";
import { withDiffOnBase } from "../../../live/github/diffOnBase.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import { githubMediaDownload } from "../../../live/github/mediaDownload.js";
import { withPullFiles } from "../../../live/github/pullFiles.js";
import { githubReadGraphql, githubReadRest, readGithubObject } from "../../../live/github/read.js";
import { fetchLinearAsset } from "../../../live/linear/assetFetch.js";
import { type LinearLiveError, LinearLiveErrors } from "../../../live/linear/errors.js";
import { type LinearReadInclude, linearReadRequest, readLinearObject } from "../../../live/linear/read.js";
import { type NotionLiveError, NotionLiveErrors } from "../../../live/notion/errors.js";
import { readNotionObject } from "../../../live/notion/read.js";
import {
  type ProviderReadDocument,
  type ProviderReadSource,
  renderProviderReadJson,
  renderProviderReadText,
} from "../../../live/providerRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseProviderReadArgs, providerReadUsage } from "./core.js";
import { providerReadArgsErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** Any of the three sources' own read errors — a dispatch-layer union, never a shared base type in domain code. */
export type ProviderReadError = GithubLiveError | LinearLiveError | NotionLiveError;

/** Injectable command edges. Plain fakes exercise the shell without provider SDKs or credentials. */
export interface ProviderReadDeps {
  readonly github: (args: {
    address: string;
    home: string | undefined;
    limit: number;
    mediaOut: string | undefined;
    files: boolean;
  }) => Promise<Result<ProviderReadDocument, GithubLiveError>>;
  readonly linear: (args: {
    address: string;
    home: string | undefined;
    include: LinearReadInclude;
    limit: number;
    pdf: boolean;
  }) => Promise<Result<ProviderReadDocument, LinearLiveError>>;
  readonly notion: (args: {
    address: string;
    home: string | undefined;
    kind: "page" | "database";
    limit: number;
    after: string | undefined;
    nestedCalls: number;
    pdf: boolean;
  }) => Promise<Result<ProviderReadDocument, NotionLiveError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Select one injected reader without collapsing its provider-specific input shape. */
async function readWith({
  provider,
  address,
  home,
  include,
  limit,
  notionKind,
  after,
  nestedCalls,
  pdf,
  mediaOut,
  files,
  deps,
}: {
  provider: ProviderReadSource;
  address: string;
  home: string | undefined;
  include: LinearReadInclude;
  limit: number;
  notionKind: "page" | "database";
  after: string | undefined;
  nestedCalls: number;
  pdf: boolean;
  mediaOut: string | undefined;
  files: boolean;
  deps: ProviderReadDeps;
}): Promise<Result<ProviderReadDocument, ProviderReadError>> {
  switch (provider) {
    case "github":
      return deps.github({ address, files, home, limit, mediaOut });
    case "linear":
      return deps.linear({ address, home, include, limit, pdf });
    case "notion":
      return deps.notion({ address, after, home, kind: notionKind, limit, nestedCalls, pdf });
    default: {
      // ProviderReadSource is derived from the registry: a new member fails to compile here, never reads as Notion.
      const unhandled: never = provider;
      return unhandled;
    }
  }
}

/**
 * Run one provider read against injected edges.
 *
 * @param provider the provider noun
 * @param rest argv after `<provider> read`
 * @param deps the provider and output seams
 * @returns the process exit code
 */
export async function runProviderRead({
  provider,
  rest,
  deps,
}: {
  provider: ProviderReadSource;
  rest: readonly string[];
  deps: ProviderReadDeps;
}): Promise<number> {
  const parsed = parseProviderReadArgs({ provider, rest });
  if (parsed.isErr()) {
    providerReadArgsErrorLines({ error: parsed.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(providerReadUsage({ provider }));
    return EXIT_USAGE;
  }
  const result = await readWith({
    address: parsed.value.address,
    after: parsed.value.after,
    deps,
    files: parsed.value.files,
    home: parsed.value.home,
    include: parsed.value.include,
    limit: parsed.value.limit,
    mediaOut: parsed.value.mediaOut,
    nestedCalls: parsed.value.nestedCalls,
    notionKind: parsed.value.notionKind,
    pdf: parsed.value.pdf,
    provider,
  });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json
      ? renderProviderReadJson({ document: result.value })
      : renderProviderReadText({ document: result.value }),
  );
  return EXIT_OK;
}

/** The wall clock every production read is stamped with. */
const nowIso = (): string => new Date().toISOString();

/** The production GitHub read: the object, its media when asked, and a pull request's files when asked. */
const productionGithubRead: ProviderReadDeps["github"] = async ({ address, home, limit, mediaOut, files }) => {
  const token = githubToken(home === undefined ? {} : { home });
  const graphql = githubReadGraphql({ token });
  let document: Result<ProviderReadDocument, GithubLiveError>;
  if (mediaOut === undefined) {
    document = await readGithubObject({ address, graphql, limit, nowIso });
  } else {
    document = await readGithubObjectWithMedia({
      address,
      download: githubMediaDownload({ outDir: mediaOut }),
      graphql,
      limit,
      nowIso,
    });
  }
  if (!files || document.isErr()) {
    return document;
  }
  const withFiles = await withPullFiles({ document: document.value, rest: githubReadRest({ token }) });
  if (withFiles.isErr()) {
    return withFiles;
  }
  return withDiffOnBase({ document: withFiles.value, graphql, nowIso });
};

/**
 * Production provider edges: credential resolution stays in the same explicit state home as the read.
 *
 * @returns credential-aware, safe provider readers and output sinks
 */
export function productionProviderReadDeps(): ProviderReadDeps {
  return {
    github: productionGithubRead,
    linear: async ({ address, home, include, limit, pdf }) => {
      const token = linearToken(home === undefined ? {} : { home });
      if (token === undefined) {
        return err(
          LinearLiveErrors.readFailed({ message: "no Linear token configured; run `slopweaver connect linear`" }),
        );
      }
      return readLinearObject({
        address,
        ...(pdf ? { assets: { fetchAsset: fetchLinearAsset, token } } : {}),
        include,
        limit,
        nowIso,
        request: linearReadRequest({ token }),
      });
    },
    notion: async ({ address, home, kind, limit, after, nestedCalls, pdf }) => {
      const token = notionToken(home === undefined ? {} : { home });
      if (token === undefined) {
        return err(
          NotionLiveErrors.readFailed({ message: "no Notion token configured; run `slopweaver connect notion`" }),
        );
      }
      return readNotionObject({
        address,
        after,
        api: makeNotionNamedReadApi({ token }),
        ...(pdf ? { assets: { scopeId: scopeIdForToken({ token }), transport: makeAttachmentTransport() } } : {}),
        kind,
        limit,
        nested: { maxCalls: nestedCalls, nowMs: () => Date.now() },
        nowIso,
      });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver github read`. */
export const githubReadCommand = defineCommand({
  run: (argv) =>
    runProviderRead({ deps: productionProviderReadDeps(), provider: "github", rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver linear read`. */
export const linearReadCommand = defineCommand({
  run: (argv) =>
    runProviderRead({ deps: productionProviderReadDeps(), provider: "linear", rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver notion read`. */
export const notionReadCommand = defineCommand({
  run: (argv) =>
    runProviderRead({ deps: productionProviderReadDeps(), provider: "notion", rest: argv.slice(VERB_ARG_OFFSET) }),
});
