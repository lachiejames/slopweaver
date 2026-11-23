/**
 * Where a rendered document's figures come from: files beside the markdown that names them, as a reader of
 * the repository would resolve them, and never a URL — fetching one is egress the render was never granted.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";

/** A figure named by a URL, which the render never fetches. */
export interface FigureIsUrlError {
  readonly code: "FIGURE_IS_URL";
  readonly message: string;
  readonly source: string;
}

/** A figure whose file is missing or unreadable. */
export interface FigureUnreadableError {
  readonly code: "FIGURE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The factories for why one figure's bytes could not be loaded. */
export const FigureLoadErrors = {
  isUrl: ({ source }: { source: string }): FigureIsUrlError => ({
    code: "FIGURE_IS_URL",
    message: `${source} is a URL, and policy render reads only files beside the markdown`,
    source,
  }),
  unreadable: ({ path }: { path: string }): FigureUnreadableError => ({
    code: "FIGURE_UNREADABLE",
    message: `no readable file at ${path}`,
    path,
  }),
} as const;

/**
 * Read the bytes of an image the markdown names, by the path it wrote. Injected so the layout stays free of
 * the filesystem and a caller decides what a relative path is relative to.
 */
export type ImageLoader = (input: { source: string }) => Result<Uint8Array, FigureIsUrlError | FigureUnreadableError>;

/**
 * An image loader reading each figure from beside one markdown file.
 *
 * @param file the markdown file whose figures are loaded, as the operator named it
 * @returns a loader that refuses a URL and names the path it could not read
 */
export function figuresBeside({ file }: { file: string }): ImageLoader {
  return ({ source }) => {
    if (source.includes("://")) {
      return err(FigureLoadErrors.isUrl({ source }));
    }
    const path = resolve(dirname(file), source);
    try {
      return ok(new Uint8Array(readFileSync(path)));
    } catch {
      return err(FigureLoadErrors.unreadable({ path }));
    }
  };
}
