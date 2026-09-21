# Flexible Worktrees for BB

A new-thread environment provider that lets you choose the checkout, worktree directory, folder name, and branch. Requires BB 0.43+, Plugin SDK 0.4.87+, and Git 2.31+ on the selected machine.

## Install

```sh
bb plugin install 'git:https://github.com/spachava753/bb-plugin-flexible-worktrees.git@^0.1.0'
```

Git-source installation builds the plugin locally. BB asks for confirmation because plugins run with full trust.

## Use

Select a project and machine in **New thread**, then select **Flexible Worktrees** in the environment picker. Click the compact branch/checkout button beside it to open the **Workspace** popover. Changes apply immediately; **Done**, Escape, or clicking outside closes the popover.

Switch between **Existing checkout** and **New worktree** at the top. Existing checkouts can be filtered by branch or path; **Enter a path** opens manual entry. New worktrees show folder and branch fields together, with a Branch source selector for a new branch, existing local branch, or remote branch. A destination preview shows the chosen path. The popover stays within the viewport and scrolls on smaller screens.

- **Use existing checkout**: choose a project worktree from the list, or enter an absolute path / `~/path` to another Git checkout. Uses its current branch, dirty files, and untracked files as-is. Does not switch branches, reset, clean, or run BB environment setup scripts. Separate clones can be entered manually; the plugin does not verify that a manually entered clone belongs to the selected project.
- **New worktree + new branch**: set a parent directory, folder name, branch name, and starting revision. Blank folder and branch fields use BB's unique path key and suggested branch name. The default starting revision is `HEAD` of the project's source checkout.
- **New worktree + existing local branch**: choose the directory and an existing local branch name. Git refuses a branch already checked out elsewhere; use the existing checkout mode instead.

To review a colleague’s branch that you haven’t fetched, choose **New worktree → Branch source → Remote branch**. The picker automatically queries the configured remotes on the selected machine. Filter the list and click a branch; **Refresh remote branches** loads the latest remote heads. Launch the thread to fetch that branch and create a worktree tracking it. The local branch defaults to the selected branch’s name; optionally choose a different name if it already exists. Branch discovery uses `git ls-remote` without changing local refs; creation fetches the selected branch. The picker does not browse PR URLs.

Remote mode requires a configured remote and working Git authentication on the selected machine. It fetches only the requested branch, without tags, pruning, or force. Existing local branches are refused rather than reset or updated; use existing local branch/checkout mode to reuse them. Authentication failures, missing branches, and network failures stop creation and can be retried. PRs from forks require that fork to be configured as a Git remote first; PR URLs are not accepted.

Paths are resolved on the selected machine, not necessarily the machine running the BB server. The folder field is one name, not a path. Put nested directories in the parent-directory field. No shell expansion is performed except a leading `~`.

The parent-directory default is `~/dev/worktrees/{repo}`. Change it under **Settings → Installed plugins → Flexible Worktrees**, or:

```sh
bb plugin config flexible-worktrees set defaultRoot '~/dev/worktrees/{repo}'
```

`{repo}` expands to the primary checkout directory's name. An explicit parent directory overrides the default for that thread. Settings are read on each creation; no reload is required.

## Retention and safety

**The plugin never removes directories or branches.** Archiving/deleting a thread or explicitly deleting its environment keeps the files. Cancelled or failed creation may also leave a worktree or branch; inspect these and remove them yourself with Git. Use `git worktree list` and `git worktree remove /absolute/path` (without `--force`) when you are done. BB-managed environments from other plugins retain their own cleanup policies; reuse their existing BB environment rather than independently attaching the same path through this plugin.

- Existing checkout mode does not claim ownership of the directory.
- Newly created worktrees are marked owned so BB runs its normal `.bb-env-setup.sh` and `.bb-env-teardown.sh` hooks. Those repository scripts have their own side effects and are not controlled by this plugin.
- Existing destinations are refused, including empty directories. No force/reset/clean commands are used.
- Git runs with argument arrays, never shell interpolation. This does not disable existing Git hooks or filters: creating a worktree runs Git's ordinary checkout behavior.
- Canonical paths are claimed through BB before creation. A plugin-local ownership receipt allows retries to recognize an already-created worktree without overwriting its files. A mismatched receipt is refused.
- Existing checkouts can be shared, so concurrent agents may edit the same files. Use separate worktrees for isolation.
- Local modes need no network access. Remote branch mode uses the machine’s existing Git credentials to fetch; the plugin never pushes.

This intentionally does not reproduce the built-in Worktree plugin's `.worktreeinclude` copying. Configure repository setup scripts if you need dependencies or ignored local files prepared in new worktrees.

## CLI

The provider uses BB's normal thread command; it adds no separate CLI command:

```sh
bb thread spawn --project <project-id> \
  --environment-provider flexible-worktrees \
  --environment-inputs '{"mode":"existing","checkout":"/absolute/path/to/repo"}' \
  --prompt 'Inspect this checkout'

bb thread spawn --project <project-id> \
  --environment-provider flexible-worktrees \
  --environment-inputs '{"mode":"new-branch","root":"~/dev/worktrees/my-repo","folder":"issue-123","branch":"feature/issue-123","base":"main"}' \
  --prompt 'Work on issue 123'
```

## Development and installation

```sh
npm ci
npm run check                 # TypeScript, tests, all BB bundles
bb plugin install . --yes     # installs alongside the built-in Worktree provider
```

After editing an installed local plugin, run `npm run check` and `bb plugin reload flexible-worktrees`. Do not disable the built-in provider while existing threads still depend on it.

Tests use temporary local Git repositories and BB's public backend/frontend harnesses. They do not modify personal repositories or start paid agent sessions.

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md` for the vendored BB UI notices.

## Alternatives researched

The BB Official and Community catalogs and public GitHub repository search were checked before implementing this:

- Built-in Worktree: installed version exposes a base branch, but no path/folder settings.
- [Worktree shortcut plugin](https://github.com/suiramdev/bb-plugin-worktree): creates standard BB-managed worktrees; its documented prefix setting does not provide arbitrary destination or existing-checkout selection.
- [VCS Widget](https://github.com/CostaFot/bb-plugin-vcs-widget): Git controls inside a thread, including creating worktrees, rather than a configurable new-thread environment provider.
- [Worktree Setup](https://github.com/KaviiSuri/bb-plugin-worktree-setup): provisioning hooks, not checkout selection or placement.
- [Repo Watch](https://github.com/slogsdon/bb-plugin-repo-watch): repository/worktree monitoring.

BB's built-in Project checkout provider also accepts a `path` input through the API/CLI, which covers part of existing-checkout reuse without a new plugin. It does not provide configurable creation paths for new worktrees.
