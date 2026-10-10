import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, realpath, lstat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { pathDefaultsSchema, planSchema, templateSchema, type Inputs, type Plan, type PathDefaults, type DestinationPreview } from "./inputs";

const exec = promisify(execFile);
export async function git(cwd: string, args: string[], signal?: AbortSignal) {
  const { stdout } = await exec("git", ["-C", cwd, ...args], {
    signal, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trimEnd();
}
function expand(path: string, relativeTo?: string) {
  const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded) && !relativeTo) throw new Error("Use an absolute path or ~/path");
  return relativeTo ? resolve(relativeTo, expanded) : resolve(expanded);
}
export async function canonical(path: string): Promise<string> {
  try { return await realpath(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent), basename(path));
  }
}
async function exists(path: string) {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function checkoutRoot(path: string, signal?: AbortSignal) {
  const root = await realpath(expand(path));
  if (await git(root, ["rev-parse", "--is-inside-work-tree"], signal) !== "true") throw new Error("Not a Git checkout");
  const top = await realpath(await git(root, ["rev-parse", "--show-toplevel"], signal));
  if (root !== top) throw new Error("Choose the checkout root, not a subdirectory");
  return root;
}
export async function list(source: string, signal?: AbortSignal) {
  const raw = await git(source, ["worktree", "list", "--porcelain", "-z"], signal);
  return raw.split("\0\0").filter(Boolean).flatMap(record => {
    const fields = record.split("\0");
    const path = fields.find(f => f.startsWith("worktree "))?.slice(9);
    if (!path || fields.includes("bare")) return [];
    return [{ path, branch: fields.find(f => f.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "(detached)" }];
  });
}
type PlanArgs = { source: string; inputs: Inputs; pathTemplate?: string; pathKey: string; suggestedBranch: string };

function chosenBranch(inputs: Inputs, suggestedBranch: string) {
  return inputs.branch || (inputs.mode === "remote-branch" ? inputs.remoteBranch : suggestedBranch);
}
async function validateBranch(source: string, branch: string, signal?: AbortSignal) {
  if (!branch || branch.startsWith("-") || branch === "HEAD") throw new Error("Invalid branch name");
  await git(source, ["check-ref-format", `refs/heads/${branch}`], signal);
}

async function destination(source: string, inputs: Inputs, defaults: PathDefaults, pathKey: string, branch: string, preview: boolean, signal?: AbortSignal): Promise<DestinationPreview> {
  // {repo} retains the primary checkout's name; relative paths use the selected source checkout.
  const common = await realpath(await git(source, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal));
  const automaticBranch = preview && !inputs.branch && inputs.mode === "new-branch";
  const values: Record<string, string> = {
    repo: basename(dirname(common)), repoPath: source, checkoutParent: dirname(source),
    branch: automaticBranch ? "<automatic branch>" : branch.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-"),
    pathKey,
  };
  const render = (template: string) => templateSchema.parse(template).replace(/\{([^{}]+)\}/g, (_, token: string) => values[token]!);
  let root: string, folder: string;
  if (inputs.root && inputs.folder) {
    root = expand(render(inputs.root)); folder = inputs.folder;
  } else {
    const rendered = render(defaults.pathTemplate);
    if (!basename(rendered) || [".", ".."].includes(basename(rendered))) throw new Error("Path template must end in a folder name");
    const full = expand(rendered, source);
    root = dirname(full); folder = basename(full);
  }
  if (inputs.root) root = expand(render(inputs.root));
  if (inputs.folder) folder = inputs.folder;
  if (!folder || folder === "." || folder === ".." || /[\\/\0\r\n]/.test(folder)) throw new Error("Invalid folder name");
  const path = await canonical(join(root, folder));
  const usedTemplates = `${inputs.root || dirname(defaults.pathTemplate)} ${inputs.folder ? "" : basename(defaults.pathTemplate)}`;
  return {
    path, root: dirname(path), folder: basename(path),
    automaticBranch: automaticBranch && usedTemplates.includes("{branch}"),
    automaticFolder: preview && usedTemplates.includes("{pathKey}"),
  };
}

/** Read-only preview; BB's automatic branch and path key do not exist until launch. */
export async function preview(args: { source: string; inputs: Inputs } & PathDefaults, signal?: AbortSignal): Promise<DestinationPreview> {
  const source = await checkoutRoot(args.source, signal);
  if (args.inputs.mode === "existing") {
    const path = await checkoutRoot(args.inputs.checkout, signal);
    return { path, root: dirname(path), folder: basename(path), automaticBranch: false, automaticFolder: false };
  }
  const branch = chosenBranch(args.inputs, "bb/automatic-preview");
  await validateBranch(source, branch, signal);
  return destination(source, args.inputs, pathDefaultsSchema.parse(args), "<automatic folder>", branch, true, signal);
}

export async function plan(args: PlanArgs, signal?: AbortSignal): Promise<Plan> {
  const { inputs, pathKey } = args;
  const source = await checkoutRoot(args.source, signal);
  if (inputs.mode === "existing") {
    return { mode: inputs.mode, source, path: await checkoutRoot(inputs.checkout, signal), branch: "", base: "", pathKey };
  }
  const branch = chosenBranch(inputs, args.suggestedBranch);
  await validateBranch(source, branch, signal);
  const { path } = await destination(source, inputs, pathDefaultsSchema.parse(args), pathKey, branch, false, signal);
  if (inputs.mode === "remote-branch") {
    await validateRemote(source, inputs.remote, inputs.remoteBranch, signal);
  }
  const base = inputs.mode === "existing-branch" ? `refs/heads/${branch}` : (inputs.base || "HEAD");
  if (inputs.mode !== "remote-branch") await git(source, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], signal);
  return { mode: inputs.mode, source, path, branch, base, pathKey, ...(inputs.mode === "remote-branch" ? { remote: inputs.remote, remoteBranch: inputs.remoteBranch } : {}) };
}

async function validateRemote(source: string, remote: string | undefined, branch: string | undefined, signal?: AbortSignal) {
  if (!remote || remote.startsWith("-") || !(await git(source, ["remote"], signal)).split("\n").includes(remote)) {
    throw new Error("Choose a configured Git remote, such as origin");
  }
  if (!branch || branch.startsWith("-")) throw new Error("Enter a remote branch name without the remote prefix");
  await git(source, ["check-ref-format", `refs/heads/${branch}`], signal);
  await git(source, ["check-ref-format", `refs/remotes/${remote}/${branch}`], signal);
}

/** Durable ownership receipt, not a launch/lifecycle registry. No paths are ever deleted. */
export async function create(p: Plan, dataDir: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (p.mode === "existing") return { path: await checkoutRoot(p.path, signal) };
  const receipts = join(dataDir, "receipts");
  await mkdir(receipts, { recursive: true });
  const receipt = join(receipts, `${createHash("sha256").update(p.pathKey).digest("hex")}.json`);
  let recorded: Plan | undefined;
  try { recorded = planSchema.parse(JSON.parse(await readFile(receipt, "utf8"))); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (recorded && JSON.stringify(recorded) !== JSON.stringify(planSchema.parse(p))) throw new Error("This launch already reserved a different worktree. Restore the original settings or start a new thread.");
  const present = await exists(p.path);
  if (present) {
    if (!recorded) throw new Error("Destination already exists. Use Existing checkout; nothing was overwritten.");
    const rows = await list(p.source, signal);
    const row = rows.find(r => resolve(r.path) === p.path && r.branch === p.branch);
    if (!row) throw new Error("Reserved destination no longer matches its worktree. Nothing was changed.");
    await checkoutRoot(p.path, signal);
    return { path: p.path };
  }
  if (p.mode === "remote-branch") {
    await validateRemote(p.source, p.remote, p.remoteBranch, signal);
    const local = await git(p.source, ["for-each-ref", "--format=%(refname)", `refs/heads/${p.branch}`], signal);
    if (local.split("\n").includes(`refs/heads/${p.branch}`)) {
      throw new Error("Local branch already exists. Use Existing checkout or an existing local branch, or choose a different local branch name.");
    }
    // Fetch only the requested branch after core has claimed the destination.
    // No force, pruning, tags, or updates to local branches.
    await git(p.source, ["fetch", "--no-tags", "--no-recurse-submodules", "--", p.remote!, `refs/heads/${p.remoteBranch}:refs/remotes/${p.remote}/${p.remoteBranch}`], signal);
  }
  if (!recorded) await writeFile(receipt, JSON.stringify(p), { flag: "wx", mode: 0o600 });
  await mkdir(dirname(p.path), { recursive: true });
  // Refuse even an empty destination created since the initial check.
  if (await exists(p.path)) throw new Error("Destination appeared during creation; refusing to overwrite it");
  const args = p.mode === "remote-branch"
    ? ["worktree", "add", "--track", "-b", p.branch, "--", p.path, `refs/remotes/${p.remote}/${p.remoteBranch}`]
    : p.mode === "new-branch"
    ? ["worktree", "add", "-b", p.branch, "--", p.path, p.base]
    : ["worktree", "add", "--", p.path, `refs/heads/${p.branch}`];
  // Passing a full ref detaches HEAD, so existing-branch mode must use the validated short name.
  if (p.mode === "existing-branch") args[args.length - 1] = p.branch;
  await git(p.source, args, signal);
  return { path: p.path };
}

/** Query the live remote heads without changing any local refs or checkout. */
export async function remoteBranches(source: string, signal?: AbortSignal) {
  const remotes = (await git(source, ["remote"], signal)).split("\n").filter(Boolean);
  const results = await Promise.all(remotes.map(async remote => {
    try {
      const raw = await git(source, ["ls-remote", "--heads", "--", remote], signal);
      return { branches: raw.split("\n").flatMap(line => {
        const ref = line.split("\t")[1];
        return ref?.startsWith("refs/heads/") ? [{ remote, branch: ref.slice(11) }] : [];
      }), errors: [] as string[] };
    } catch {
      signal?.throwIfAborted();
      return { branches: [], errors: [`Couldn’t load branches from ${remote}. Check network access and Git authentication, then refresh.`] };
    }
  }));
  return { branches: results.flatMap(r => r.branches).sort((a, b) => `${a.remote}/${a.branch}`.localeCompare(`${b.remote}/${b.branch}`)), errors: results.flatMap(r => r.errors) };
}
