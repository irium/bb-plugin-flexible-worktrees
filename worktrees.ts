import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, realpath, lstat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { planSchema, type Inputs, type Plan } from "./inputs";

const exec = promisify(execFile);
export async function git(cwd: string, args: string[], signal?: AbortSignal) {
  const { stdout } = await exec("git", ["-C", cwd, ...args], {
    signal, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trimEnd();
}
function expand(path: string) {
  const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded)) throw new Error("Use an absolute path or ~/path");
  return resolve(expanded);
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
export async function plan(args: { source: string; inputs: Inputs; defaultRoot: string; pathKey: string; suggestedBranch: string }, signal?: AbortSignal): Promise<Plan> {
  const { inputs, pathKey } = args;
  const source = await checkoutRoot(args.source, signal);
  if (inputs.mode === "existing") {
    return { mode: inputs.mode, source, path: await checkoutRoot(inputs.checkout, signal), branch: "", base: "", pathKey };
  }
  // Use the primary checkout's name even when the source is itself a linked worktree.
  const common = await realpath(await git(source, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal));
  const repo = basename(dirname(common));
  const root = expand((inputs.root || args.defaultRoot).replaceAll("{repo}", repo));
  const folder = inputs.folder || pathKey;
  if (!folder || folder === "." || folder === ".." || /[\\/\0\r\n]/.test(folder)) throw new Error("Invalid folder name");
  const path = await canonical(join(root, folder));
  const branch = inputs.branch || args.suggestedBranch;
  if (!branch || branch.startsWith("-") || branch === "HEAD") throw new Error("Invalid branch name");
  await git(source, ["check-ref-format", `refs/heads/${branch}`], signal);
  const base = inputs.mode === "existing-branch" ? `refs/heads/${branch}` : (inputs.base || "HEAD");
  await git(source, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], signal);
  return { mode: inputs.mode, source, path, branch, base, pathKey };
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
  if (recorded && JSON.stringify(recorded) !== JSON.stringify(p)) throw new Error("This launch already reserved a different worktree. Restore the original settings or start a new thread.");
  const present = await exists(p.path);
  if (present) {
    if (!recorded) throw new Error("Destination already exists. Use Existing checkout; nothing was overwritten.");
    const rows = await list(p.source, signal);
    const row = rows.find(r => resolve(r.path) === p.path && r.branch === p.branch);
    if (!row) throw new Error("Reserved destination no longer matches its worktree. Nothing was changed.");
    await checkoutRoot(p.path, signal);
    return { path: p.path };
  }
  if (!recorded) await writeFile(receipt, JSON.stringify(p), { flag: "wx", mode: 0o600 });
  await mkdir(dirname(p.path), { recursive: true });
  // Refuse even an empty destination created since the initial check.
  if (await exists(p.path)) throw new Error("Destination appeared during creation; refusing to overwrite it");
  const args = p.mode === "new-branch"
    ? ["worktree", "add", "-b", p.branch, "--", p.path, p.base]
    : ["worktree", "add", "--", p.path, `refs/heads/${p.branch}`];
  // Passing a full ref detaches HEAD, so existing-branch mode must use the validated short name.
  if (p.mode === "existing-branch") args[args.length - 1] = p.branch;
  await git(p.source, args, signal);
  return { path: p.path };
}
