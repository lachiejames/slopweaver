/**
 * Publishers a caller's test injects: the real `publishPage` with the store write replaced by a plain fake writer —
 * accepting, refusing, or recording what it was asked. A publish writes nothing on disk, so a test reads what was
 * published off the recording writer, never off a folder.
 */
import { err, ok } from "../lib/result.js";
import { type PagePublisher, type PageStoreWriter, publishPage } from "../pages/publish.js";

/** One store write a recording writer was asked for. */
export type WrittenPage = Parameters<PageStoreWriter>[0];

/** A writer that accepts every page. */
const acceptingWriter: PageStoreWriter = async () => ok(undefined);

/**
 * A writer that refuses every page with one line.
 *
 * @param line the refusal it answers
 * @returns the writer
 */
export function refusingWriter({ line }: { line: string }): PageStoreWriter {
  return async () => err([line]);
}

/**
 * A writer that accepts every page and keeps what it was asked.
 *
 * @returns the writer and the list it appends to
 */
export function recordingWriter(): { readonly writer: PageStoreWriter; readonly written: WrittenPage[] } {
  const written: WrittenPage[] = [];
  return {
    writer: async (request) => {
      written.push(request);
      return ok(undefined);
    },
    written,
  };
}

/**
 * The real publisher over a given writer.
 *
 * @param writer stands in for the store write
 * @returns a publisher a caller injects
 */
export function publisherWith({ writer }: { writer: PageStoreWriter }): PagePublisher {
  return (request) => publishPage({ ...request, write: writer });
}

/** The real publisher, its store write always accepted. */
export const localPagePublisher: PagePublisher = publisherWith({ writer: acceptingWriter });
