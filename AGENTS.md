# ECGaming agent instructions

## Publish website changes promptly

For user-authorized website changes, do not leave completed work only in the
local worktree. As soon as the scoped checks pass:

1. create a focused commit containing only the intended, validated changes;
2. push the current tracked branch promptly so the website deployment can
   begin; and
3. verify the remote branch revision and deployment workflow when available.

Never force-push. Never include unrelated or unvalidated worktree changes just
to publish quickly. If overlapping local work prevents a safe focused commit,
report that blocker immediately.

## HTML UI skill route

For text-bearing HTML/CSS interface work, read [for-ai/SKILLS.md](./for-ai/SKILLS.md) before editing.

<!-- for-ai:shared-skills:start -->
## Shared project workflow

At project entry, also read [for-ai/SKILLS.md](for-ai/SKILLS.md) for the required RTK, GSD Core,
and Superpowers baseline, conditional Rust/Tauri/HTML routes, and Git worktree
policy. Preserve this project's product and evidence contracts.

Read the durable project goal and resume its active checklist at session
start. Before ending, update that same state with evidence, blockers, the
next action, and observed Git/publication state. Keep the overall goal open
until its own acceptance criteria pass.
<!-- for-ai:shared-skills:end -->
