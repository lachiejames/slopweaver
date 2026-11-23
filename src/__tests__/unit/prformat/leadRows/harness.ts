/*
 * What the lead-row test files share: the Risk and Blast radius pair in the order the rule requires, and a PR body
 * whose main table is drawn in the renderer's own spelling with any rows a case chooses above Problem.
 */

export const PAIR = [
  { label: "Risk", text: "Low risk." },
  { label: "Blast radius", text: "The settings page." },
];

/**
 * A main table in the renderer's own spelling, with the given rows above Problem.
 *
 * @returns a body holding a Next table, then a main table with the given rows above its Problem and Solution rows
 */
export function htmlBody({ lead }: { lead: readonly { label: string; text: string }[] }): string {
  const rows = lead.map((row) => `<tr>\n<td><strong>${row.label}</strong></td>\n<td>${row.text}</td>\n</tr>`);
  return [
    "<table>",
    "<tr><td>👉 <strong>Next</strong></td><td>Merge it.</td></tr>",
    "</table>",
    "",
    "<table>",
    ...rows,
    "<tr>\n<td><strong>Problem</strong></td>\n<td>A problem.</td>\n</tr>",
    "<tr>\n<td><strong>Solution</strong></td>\n<td>A fix.</td>\n</tr>",
    "</table>",
  ].join("\n");
}
