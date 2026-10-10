# Flexible Worktrees

BB environment provider with server (`server.ts`), host worker (`host.ts`), shared schemas (`inputs.ts`), server/host RPC contracts (`contract.ts`), project-template selection (`settings.ts`), Git/filesystem operations and destination resolution (`worktrees.ts`), and a new-thread input slot (`app.tsx`). `WorktreePicker.tsx` owns the compact trigger and portalled configuration popover; keep the composer footer limited to the trigger, and keep all form buttons non-submitting. `TemplateReference.tsx` provides structured settings help with collapsible variable and project-override references; keep declarative setting descriptions concise. Vendored UI controls live in `components/ui`.

Use npm and the checked-in lockfile. Run `npm run check` before finishing a change. Tests use temporary Git repositories plus the public BB SDK harnesses. Build all three bundles before installing/reloading. Use `bb plugin types` to check the SDK version when upgrading BB. Before a release, also build a clean copy after `npm ci --omit=dev --omit=optional --ignore-scripts`: Git installs omit development dependencies. Browser modules must import schemas from `inputs.ts`, not the server/host contract module, which imports SDK runtime helpers.

Safety contract:
- Existing checkout mode never mutates Git, claims directory ownership, or removes files.
- The provider never deletes directories or branches, including cancellation/cleanup.
- Refuse existing destinations unless the path-key ownership receipt and Git worktree identity match a prior create.
- Claim canonical destination paths through core before mutation. Run Git with argv, not a shell.
- Keep lifecycle state in BB core. Host receipts identify filesystem ownership only.
- Resolve destination templates and read-only previews on the selected host with the same resolver. `pathTemplate` is the sole global destination setting; unset/blank templates use `~/worktrees/{pathKey}`. Do not reintroduce a separate default root. Explicit thread parent/folder fields override those parts independently; never materialize defaults into persisted inputs. Automatic names are unknown until launch, so previews use placeholders.
- Project template precedence is project ID, exact remote identity, most-specific remote wildcard, then global template. Remote matching uses BB's saved project URL without network access.
- Do not silently change retention policy or enable destructive cleanup.

The plugin is separate from the built-in Worktree provider. Do not disable that provider or migrate existing environments as part of ordinary development. No remote GitHub repository is required to install this local plugin.
