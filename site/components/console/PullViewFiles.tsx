/** The files tab: every changed file as its patch, with each review thread hung under the line it is on. */
import { type ReactElement, type ReactNode, useMemo } from "react";

import { type PullFile, type PullThread, type PullView as PullViewData } from "../../lib/pullView";
import { type DiffSide, parseUnifiedDiff, placeByLine } from "../../lib/unifiedDiff";
import { CHIP } from "./controls";
import { Churn, type People } from "./PullViewParts";
import { DiffRows, ThreadBox } from "./PullViewThreads";

/** A file's status as GitHub's word and tone. */
function FileStatus({ status }: { status: string }): ReactElement {
  let tone = "";
  if (status === "added") {
    tone = "hot";
  } else if (status === "removed" || status === "renamed") {
    tone = "warn";
  }
  return (
    <span className={CHIP} data-tone={tone}>
      {status}
    </span>
  );
}

/** Past this many rows a file opens folded, as GitHub folds a large diff. */
const FOLD_ROWS = 400;

/** One changed file: its head, its patch with each review thread under its line, and any outdated thread after. */
function FileBox({
  file,
  threads,
  people,
  url,
}: {
  file: PullFile;
  threads: readonly PullThread[];
  people: People;
  url: string;
}): ReactElement {
  const rows = useMemo(() => {
    if (file.patch === undefined) {
      return [];
    }
    return parseUnifiedDiff({ patch: file.patch });
  }, [file.patch]);
  // An outdated thread's code is no longer in the diff, and one whose line this patch does not show is kept after
  // the file, never lost.
  const placed: { line: number; side: DiffSide; item: PullThread }[] = [];
  const loose: PullThread[] = [];
  for (const thread of threads) {
    if (thread.line === undefined || thread.outdated) {
      loose.push(thread);
    } else {
      placed.push({ item: thread, line: thread.line, side: thread.side });
    }
  }
  const { byRow, unshown } = placeByLine({ items: placed, rows });
  loose.push(...unshown);
  const hung = new Map<number, ReactNode>();
  for (const [index, held] of byRow) {
    hung.set(
      index,
      <div className="grid gap-2">
        {held.map((thread) => (
          <ThreadBox key={thread.id} thread={thread} people={people} />
        ))}
      </div>,
    );
  }
  let name: ReactNode = file.filename;
  if (file.previousFilename !== undefined) {
    name = (
      <>
        {file.previousFilename} → {file.filename}
      </>
    );
  }
  return (
    <details open={rows.length <= FOLD_ROWS} className="overflow-hidden rounded-lg border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 bg-muted/30 px-3 py-2 text-[0.8rem]">
        <Churn additions={file.additions} deletions={file.deletions} />
        <code className="text-[0.78rem] break-all">{name}</code>
        <FileStatus status={file.status} />
        {threads.length > 0 && (
          <span className="text-muted-foreground">
            {String(threads.length)} thread{threads.length === 1 ? "" : "s"}
          </span>
        )}
        {rows.length > FOLD_ROWS && <span className="text-muted-foreground">large diff: open to draw it</span>}
      </summary>
      {file.patch === undefined && (
        <p className="m-0 border-t px-3 py-2 text-[0.78rem] text-muted-foreground">
          GitHub sends no patch for this file: it is binary, or too large for GitHub to diff.{" "}
          <a href={`${url}/files`} target="_blank" rel="noreferrer">
            Open the files in GitHub
          </a>
        </p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto border-t">
          <DiffRows rows={rows} hung={hung} />
        </div>
      )}
      {loose.length > 0 && (
        <div className="grid gap-2 border-t px-3 py-2">
          {loose.map((thread) => (
            <ThreadBox key={thread.id} thread={thread} people={people} />
          ))}
        </div>
      )}
    </details>
  );
}

/** The files tab: every file the read carried, with any it did not named. */
export function Files({ view, people }: { view: PullViewData; people: People }): ReactElement {
  const byPath = new Map<string, PullThread[]>();
  for (const thread of view.threads) {
    const held = byPath.get(thread.path);
    if (held === undefined) {
      byPath.set(thread.path, [thread]);
    } else {
      held.push(thread);
    }
  }
  return (
    <div className="grid gap-3">
      <p className="m-0 text-[0.8rem] text-muted-foreground">
        {String(view.changedFiles)} file{view.changedFiles === 1 ? "" : "s"} changed ·{" "}
        <Churn additions={view.additions} deletions={view.deletions} /> · against the branch&apos;s merge base
      </p>
      {view.files.length < view.changedFiles && (
        <p className="m-0 text-[0.8rem] text-warning">
          The read carries the first {String(view.files.length)} of {String(view.changedFiles)} files:{" "}
          <a href={`${view.url}/files`} target="_blank" rel="noreferrer">
            the rest are in GitHub
          </a>
        </p>
      )}
      {view.files.map((file) => {
        // A file nobody commented on has no threads, by design.
        let threads: readonly PullThread[] = [];
        const held = byPath.get(file.filename);
        if (held !== undefined) {
          threads = held;
        }
        return <FileBox key={file.filename} file={file} threads={threads} people={people} url={view.url} />;
      })}
    </div>
  );
}
