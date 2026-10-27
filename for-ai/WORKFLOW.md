# Session and publication workflow

1. Read [PROJECT.md](PROJECT.md), resume its active checklist, and inspect fresh
   status, branch, upstream, and registered worktrees. Preserve unrelated work.
2. Select [SKILLS.md](SKILLS.md) routes for the actual task. Reuse the agreed
   design and plan; define an observable acceptance check for unfinished work.
3. Implement the smallest complete change. Keep product code and assets outside
   `for-ai/`. Preserve the existing signal and controller owners and update
   durable contracts in their existing documents when behavior changes.
4. Run the relevant [verification gates](VERIFICATION.md). Record evidence and
   limitations in the active checklist; mark an item complete only when its
   named check passes. A local task pass is not overall goal completion.
5. Follow the publication rule in [AGENTS.md](../AGENTS.md). For user-authorized
   website work, promptly commit only intended, validated paths and push the
   tracked branch after scoped checks pass. Verify the remote SHA and relevant
   workflow result; report any overlap or integration blocker immediately.

Use Git history and registered worktrees for isolation and rollback. Prefer
existing Codex-managed isolation for substantial independent work. Do not make
backup source trees, discard uncommitted work, force-push, bypass protections,
or remove another task's worktree. Inspect the complete staged diff before
committing. Toolkit approval menus do not revoke continuing user authorization.

When authorized parallel work is useful, record disjoint file ownership in the
active checklist and keep integration with one owner. Agents must not edit each
other's files or independently publish a partially integrated change.

The single Pages workflow,
[`deploy-pages.yml`](../.github/workflows/deploy-pages.yml), verifies tests and builds before deployment on `main` pushes or manual
dispatch. The duplicate unverified publisher was removed to prevent competing deployments. [`ci.yml`](../.github/workflows/ci.yml) covers pull requests and other
branch pushes. A feature-branch push alone is not deployed-site evidence.
Check the workflow runs for the intended commit and the live route before
claiming publication. Preserve branch rules and report a blocked integration.

Before ending or handing off, update the existing state in `PROJECT.md` with:

- Overall goal, active task, completed acceptance checks, and evidence links.
- Next concrete unfinished action and its acceptance check.
- Blockers, unresolved decisions, and continuing authorization.
- Last-observed canonical checkout/worktree, branch, commit, dirty paths, remote
  revision, and deployment state; the next session must recheck these facts.

Keep this handoff concise. Store large local logs and screenshots in ignored
artifact directories; link useful evidence instead of copying transcripts.
