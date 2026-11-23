"use client";

/**
 * The sidebar's one update element: a single line saying whether what the owner runs is up to date, and behind its fold
 * how many changes getting onto the latest would bring, read in the release-notes modal.
 *
 * Its line never contradicts the build actually running (measured: it read one version behind while the owner was on
 * the latest build). It re-reads `checkout console --json` once a minute without a reload, and never
 * reloads the page itself — a reload during a voice call ends the call.
 *
 * Two readings stand under it — the page's build (`site/lib/buildStanding.ts`) and the app's, which only an install
 * rebuilds (`site/lib/shellStanding.ts`) — but the owner reads ONE standing over both
 * (`site/lib/updateStanding.ts`), because two kinds of update is one more thing to think about (a fold listed seven
 * commits under Console and one change under App). So the changes are one
 * list, the owner's asks first, read in a modal rather than cut to the fold's width (`ReleaseNotesModal.tsx`), and the
 * step is one press of the Update button under the line, which ends a call first and restarts it after
 * (`UpdateButton.tsx`). It is never pushed: the update quits the app, so it stays the owner's act. The fold
 * opens as a short panel above the line, which never moves (`SidebarFold.tsx`).
 */
import { type ReactElement, type ReactNode, useEffect, useState } from "react";

import { type BuildStanding, buildStanding } from "../../lib/buildStanding";
import { type ConsoleBuildReport, readConsoleBuildReport } from "../../lib/buildStandingReport";
import { LOADED_BUILD } from "../../lib/loadedBuild";
import { shellStanding } from "../../lib/shellStanding";
import type { ShellStanding } from "../../lib/shellStandingWords";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { lineIntent, updateAction, updateIntent } from "../../lib/updateAction";
import { experienceChanges, updateStanding } from "../../lib/updateStanding";
import { cn } from "../../lib/utils";
import { ReadMark } from "../live/LiveMarks";
import { useLive } from "../live/useLive";
import { useShellBuild, useUpdateShell } from "../voice/useDesktopShell";
import { useVoice } from "../voice/voiceContext";
import { ReadingIndicator } from "./ReadingIndicator";
import { ReleaseNotesModal } from "./ReleaseNotesModal";
import { SidebarFold } from "./SidebarFold";
import { StaleMark } from "./StaleMark";
import { UpdateButton, useUpdateControl } from "./UpdateButton";

/** How often the reading is taken: the verb fetches the upstream at most once a minute, so a faster poll only re-reads. */
const BUILD_POLL_MS = 60_000;

/** The dot's colour for each tone. */
const DOT: Record<BuildStanding["tone"], string> = {
  attention: "bg-primary",
  busy: "bg-warning",
  ok: "bg-success",
  unknown: "bg-border",
};

/**
 * The staleness line and its fold.
 *
 * @returns the element, drawn as a dot alone on the icon rail
 */
export function BuildStatus(): ReactElement {
  const state = useLive<ConsoleBuildReport>({
    everyMs: BUILD_POLL_MS,
    read: (payload) => readConsoleBuildReport({ payload }),
    slug: "build",
  });
  const voice = useVoice();
  const shell = useShellBuild({ everyMs: BUILD_POLL_MS });
  const update = useUpdateShell();
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Ages move without a reading, so the line keeps its own minute tick.
  useEffect(() => {
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => {
      clearInterval(tick);
    };
  }, []);
  if (state.phase === "not-measured") {
    return (
      <Line>
        <StaleMark facts={[{ subject: "The build", why: state.why }]} />
      </Line>
    );
  }
  // An app that has not answered yet is not a browser: until it does, the one line cannot say "Up to date" (a
  // pending reading and a browser both leave `shellStanding` undefined), so it waits as the page's does.
  if (state.phase === "loading" || shell.kind === "pending") {
    return (
      <Line>
        <ReadingIndicator label="Reading the build" />
      </Line>
    );
  }
  // The page's build reads THIS page's call, whose lease answer is its only word on what is held. Pressing Update
  // reads a call anywhere: in the desktop app the call runs in the voice's window, the shell ends it there and
  // restarts it after, and read as this window's alone, a held build drew "Update waiting on a call" twice and
  // nothing to press while the owner was on the call.
  const callHere = voice?.callActive === true;
  const callLive = voice?.callActiveAnywhere === true;
  const standing = buildStanding({
    callLive: callHere,
    callWaiting: voice?.waiting,
    loaded: LOADED_BUILD,
    nowMs,
    report: state.value,
  });
  const app = shellStanding({ callLive, nowMs, report: state.value, shell });
  return (
    <ReadyBuildStatus
      app={app}
      callLive={callLive}
      mark={<ReadMark state={state} subject="the build" />}
      report={state.value}
      standing={standing}
      update={update}
    />
  );
}

/**
 * The line and its fold once a reading has arrived — a component of its own so the one update controller's hooks run
 * on every render, never only after the early returns above.
 *
 * @param report the console's build reading
 * @param standing the page's build standing
 * @param app the app's build standing, `undefined` in a browser
 * @param mark the build reading's own freshness mark, drawn beside the line
 * @param update the shell's update half and its standing (`useUpdateShell`)
 * @returns the fold, and the Update button under it
 */
function ReadyBuildStatus({
  report,
  standing,
  app,
  callLive,
  mark,
  update,
}: {
  report: ConsoleBuildReport;
  standing: BuildStanding;
  app: ShellStanding | undefined;
  callLive: boolean;
  mark: ReactNode;
  update: ReturnType<typeof useUpdateShell>;
}): ReactElement {
  const control = useUpdateControl({ app, callLive, page: standing, update });
  const running = update.state.running;
  // Something under way is said once, by the line — a swap the controller is waiting out included — and the sidebar's
  // button leaves it there (`sidebarAction`).
  const intent = lineIntent({
    action: control.action,
    intent: updateIntent({ app, callLive, page: standing, running }),
  });
  const changes = experienceChanges({ app, mainline: report.mainline.commits, page: standing });
  const pressable = updateAction({ app, callLive, canUpdate: update.bridge !== undefined, page: standing, running });
  const glance = updateStanding({
    app,
    changes,
    intent,
    page: standing,
    pressable: pressable.kind !== "none",
  });
  // A sub-read the verb could not make is a failed read: one mark beside the line naming each, never a paragraph.
  const unread: readonly StalenessFact[] = [
    ...glance.unread,
    ...report.problems.map((why) => ({ subject: "part of the build reading", why })),
  ];
  return (
    <>
      <SidebarFold
        fold="build"
        title={glance.title}
        summary={
          <>
            <Dot tone={glance.tone} title={glance.title} />
            {/* The line wraps rather than truncating: at sidebar width a cut read "Update available · 2 ch…". */}
            {glance.line === "" ? null : (
              <span className="min-w-0 leading-snug text-foreground group-data-[sidebar=icons]/console:hidden">
                {glance.line}
              </span>
            )}
            {unread.length > 0 && <StaleMark facts={unread} />}
            {mark}
          </>
        }
      >
        {glance.notes.map((note) => (
          <p key={note} className="m-0 mt-[0.2rem] text-foreground">
            {note}
          </p>
        ))}
        {glance.changes.length === 0 ? null : (
          <ReleaseNotesModal changes={glance.changes} update={control} upstreamSha={report.upstream?.sha} />
        )}
        {standing.checked === undefined ? null : <p className="m-0 mt-[0.2rem]">{standing.checked}</p>}
      </SidebarFold>
      <UpdateButton control={control} surface="sidebar" />
    </>
  );
}

/**
 * The status before a reading has arrived, or when none could be taken: the spinner or staleness mark alone, no fold.
 *
 * @returns the line
 */
function Line({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center px-[0.55rem] py-[0.3rem] text-[0.74rem] text-muted-foreground group-data-[sidebar=icons]/console:justify-center group-data-[sidebar=icons]/console:px-0">
      {children}
    </div>
  );
}

/**
 * The standing's colour, the one thing the icon rail keeps.
 *
 * @returns the dot
 */
function Dot({ tone, title }: { tone: BuildStanding["tone"]; title: string }): ReactElement {
  return <span className={cn("inline-block size-[0.55rem] shrink-0 rounded-full", DOT[tone])} title={title} />;
}
