<!--
  Do not fill this body by hand. CI's pr-format check accepts a description only when it is the exact
  render of a typed C3 form, so a hand-written body fails it. The full shape: skills/github/reference/pull-requests.md.

  Write it through the door instead:
    slopweaver github stack push --file <f>      opens the pull request from an authoring file
    slopweaver github stack push --file-example  prints a complete, valid authoring file to start from
    slopweaver github pr update --edit '<json>'  changes only the named fields of an open one

  The body reads top to bottom:
  - three DERIVED badges (risk, problem, proof), none authored, each with a plain hover;
  - the explainer, at most 70 words: what broke, for whom, and what this changes;
  - "Proof of the problem" and "Proof of the solution": a screenshot under the one line it proves, quoted output
    under it with its source, or a reason;
  - "Checks", one sentence per check with no screenshot, a group nested under its label, then "Not checked, and why";
  - "Re-run", the one fold, holding only what re-runs it.

  Proof images are hosted as a github.com/user-attachments asset, never committed to the repository. No grade,
  gold anchor, origin or reviewer table is published, and no first person appears in prose.
  Anything non-obvious goes in an inline review comment on the diff, not this body.
-->
