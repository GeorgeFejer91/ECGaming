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
