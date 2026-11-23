/**
 * The lines a real drip prints once it has run — one per message, sent or not, and what to do next. Split out of
 * `./dripCore.ts` under the file-size cap: that module plans a drip, this one reports on a drip that
 * already happened, reading its {@link DripOutcome} type and `dripFullyLanded` predicate. A sent message's line also
 * names where its read-back found it (`placementLine`), which the split added rather than moved.
 * `slackDripSendLines` is exported from here only; `./dripCore.ts` imports nothing from this module.
 */
import { placementLine } from "../../../outbound/slack/placement.js";
import { type DripOutcome, dripFullyLanded } from "./dripCore.js";

/**
 * The report after a real (or partial) drip. This is the output the "which ones landed?" question is
 * answered from, so every message appears, including the ones that did not.
 *
 * @param outcomes one outcome per message, in index order
 * @param channel the destination channel id
 * @returns the report lines, in display order
 */
export function slackDripSendLines({
  outcomes,
  channel,
}: {
  outcomes: readonly DripOutcome[];
  channel: string;
}): readonly string[] {
  const landed = outcomes.filter((o) => o.state === "sent").length;
  const skipped = outcomes.filter((o) => o.state === "already-sent").length;
  return [
    dripFullyLanded({ outcomes })
      ? `drip complete — channel=${channel}, ${String(landed)} sent, ${String(skipped)} already there`
      : `drip INCOMPLETE — channel=${channel}, ${String(landed)} sent, ${String(skipped)} already there. ` +
        "Nothing below was published; re-run to continue from the gap.",
    ...outcomes.map((outcome) => `  ${String(outcome.index + 1)}. ${outcomeLine({ outcome })}`),
    ...resumeAdvice({ outcomes }),
  ];
}

/** One outcome as a line. */
function outcomeLine({ outcome }: { outcome: DripOutcome }): string {
  switch (outcome.state) {
    case "sent":
      return sentLine({ outcome });
    case "already-sent":
      return `already sent by an earlier run — ts=${outcome.ts} (not reposted)`;
    case "unconfirmed":
      return (
        `NOT SENT — an earlier run reserved this message at ${outcome.reservedIso} and never confirmed it, ` +
        "so it may or may not be in Slack"
      );
    case "failed":
      return `FAILED — ${outcome.error}`;
    case "not-attempted":
      return outcome.reason === "earlier-failure"
        ? "not attempted — the drip stopped at the failure above"
        : "not attempted — the drip stopped at the unresolved message above";
  }
}

/**
 * One SENT message as a line: where it is, what rode on it, and whether it renders as intended.
 *
 * The render verdict has three spellings rather than two, because "checked and clean" and "not checked at
 * all" are different facts and only one of them is reassuring. A send whose read-back could not answer says
 * so, so nobody reads a silent line as a clean bill.
 */
function sentLine({ outcome }: { outcome: Extract<DripOutcome, { state: "sent" }> }): string {
  const rendered = renderedLine({ outcome });
  // Loose for the same reason as `whereOf`: a null read off a JSON outcome is no read-back, never a report.
  if (outcome.placement == null) {
    return rendered;
  }
  return `${rendered}; ${placementLine({ report: outcome.placement })}`;
}

/** Where a sent message is: its permalink, or its ts when the send could not resolve one. */
function whereOf({ outcome }: { outcome: Extract<DripOutcome, { state: "sent" }> }): string {
  const { permalink } = outcome;
  // Loose on purpose: the `??` this replaced also fell back on a null read off a JSON outcome.
  if (permalink == null) {
    return `ts=${outcome.ts}`;
  }
  return permalink;
}

/** The where, media and render half of {@link sentLine}. */
function renderedLine({ outcome }: { outcome: Extract<DripOutcome, { state: "sent" }> }): string {
  const where = whereOf({ outcome });
  const media =
    outcome.fileIds.length === 0 ? "" : `, ${String(outcome.fileIds.length)} file(s) attached and read back`;
  if (outcome.renderIssues === undefined) {
    return `sent — ${where}${media}, render NOT CHECKED (the read-back could not answer)`;
  }
  if (outcome.renderIssues.length === 0) {
    return `sent — ${where}${media}, render checked against what Slack stored`;
  }
  return (
    `sent — ${where}${media}, but RENDERS WRONG and is already published. ` +
    `${outcome.renderIssues.join(" ")} Fix it with \`slack edit --as me\`, never by posting a correction ` +
    "underneath it."
  );
}

/**
 * What to do next, printed only when there is something to do.
 *
 * The `unconfirmed` advice names both ways forward and refuses to pick one, because only a human looking
 * at the channel knows which is right.
 */
function resumeAdvice({ outcomes }: { outcomes: readonly DripOutcome[] }): readonly string[] {
  const unconfirmed = outcomes.find((outcome) => outcome.state === "unconfirmed");
  if (unconfirmed !== undefined) {
    return [
      "",
      `message ${String(unconfirmed.index + 1)} is UNRESOLVED. Open the channel and look:`,
      "  · it IS there  → edit or drop that message from the drip, then re-run",
      "  · it is NOT there → re-run with --resend-unconfirmed to send it and continue",
      "Nothing is guessed here: skipping it would silently drop a line, resending it would double-post one.",
    ];
  }
  return outcomes.some((outcome) => outcome.state === "failed")
    ? ["", "Re-run the same command to continue: the messages that already landed are recorded and skipped."]
    : [];
}
