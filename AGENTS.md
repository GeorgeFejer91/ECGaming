# ECGaming agent instructions

## Mandatory first read

Before changing code in this repository, read **For-AI/00-START-HERE.md** and the relevant protocol documents in **For-AI/**.

`For-AI/` is the repository's AI orchestration layer. It contains project intent, architecture boundaries, research references, validation expectations, and cross-module rules. It is not a game-output directory and must not contain runtime assets or production game code.

When a task touches smartphone breathing, read **For-AI/BREATH-SENSING.md** before editing any game-specific file.

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
