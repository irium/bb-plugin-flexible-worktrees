import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inputsSchema } from "./contract";
import { create, git, list, plan, remoteBranches } from "./worktrees";

let temp: string, source: string, data: string;
beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "flexible-worktrees-test-")));
  source = join(temp, "repo"); data = join(temp, "data");
  await mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"]);
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
const makePlan = (inputs: Record<string, string> = {}, pathKey = "test-key") => plan({ source, inputs: inputsSchema.parse(inputs), defaultRoot: join(temp, "worktrees", "{repo}"), pathKey, suggestedBranch: "bb/test" });

describe("real Git worktrees", () => {
  it("creates the chosen branch and folder, and retries without losing edits", async () => {
    const p = await makePlan({ folder: "my folder", branch: "feature/custom" });
    expect(p.path).toBe(join(temp, "worktrees", "repo", "my folder"));
    await create(p, data);
    await writeFile(join(p.path, "keep.txt"), "uncommitted");
    await create(p, data);
    expect(await readFile(join(p.path, "keep.txt"), "utf8")).toBe("uncommitted");
    expect(await git(p.path, ["branch", "--show-current"])).toBe("feature/custom");
    expect(await list(source)).toContainEqual({ path: p.path, branch: "feature/custom" });
  });
  it("attaches dirty existing checkouts without switching branches", async () => {
    await writeFile(join(source, "keep"), "dirty");
    const p = await makePlan({ mode: "existing", checkout: source });
    expect(await create(p, data)).toEqual({ path: source });
    expect(await git(source, ["branch", "--show-current"])).toBe("main");
    expect(await readFile(join(source, "keep"), "utf8")).toBe("dirty");
  });
  it("uses an existing branch without detaching or creating another branch", async () => {
    await git(source, ["branch", "existing"]);
    const p = await makePlan({ mode: "existing-branch", branch: "existing" });
    await create(p, data);
    expect(await git(p.path, ["branch", "--show-current"])).toBe("existing");
  });
  it("refuses a branch checked out elsewhere", async () => {
    const p = await makePlan({ mode: "existing-branch", branch: "main" });
    await expect(create(p, data)).rejects.toThrow();
    expect(await git(source, ["branch", "--show-current"])).toBe("main");
  });
  it("never adopts or overwrites a pre-existing destination, even if empty", async () => {
    const p = await makePlan();
    await mkdir(p.path, { recursive: true });
    await expect(create(p, data)).rejects.toThrow("Destination already exists");
    await writeFile(join(p.path, "keep"), "keep");
    await expect(create(p, data)).rejects.toThrow("Destination already exists");
    expect(await readFile(join(p.path, "keep"), "utf8")).toBe("keep");
  });
  it("rejects folder traversal, relative roots, option-like branches, and subdirectories", async () => {
    expect(inputsSchema.safeParse({ folder: "../escape" }).success).toBe(false);
    await expect(makePlan({ root: "relative" })).rejects.toThrow("absolute");
    await expect(makePlan({ branch: "--force" })).rejects.toThrow("Invalid branch");
    await mkdir(join(source, "nested"));
    await expect(makePlan({ mode: "existing", checkout: join(source, "nested") })).rejects.toThrow("root");
  });
  it("canonicalizes symlinked parents before claiming a path", async () => {
    await mkdir(join(temp, "real")); await symlink(join(temp, "real"), join(temp, "alias"));
    expect((await makePlan({ root: join(temp, "alias"), folder: "chosen" })).path).toBe(join(temp, "real", "chosen"));
  });
  it("refuses mismatched receipts and leaves the original worktree untouched", async () => {
    const p = await makePlan(); await create(p, data);
    await expect(create({ ...p, path: join(temp, "elsewhere") }, data)).rejects.toThrow("different worktree");
    expect(await git(p.path, ["branch", "--show-current"])).toBe("bb/test");
  });
  it("honors cancellation before mutating", async () => {
    const p = await makePlan();
    await expect(create(p, data, AbortSignal.abort())).rejects.toThrow();
    expect(await list(source)).toHaveLength(1);
  });
});

async function remoteFixture() {
  const remote = join(temp, "remote.git");
  await git(temp, ["init", "--bare", remote]);
  await git(source, ["remote", "add", "origin", remote]);
  await git(source, ["push", "origin", "main:refs/heads/colleague/review"]);
  await git(source, ["update-ref", "-d", "refs/remotes/origin/colleague/review"]);
  return remote;
}

it("fetches an unseen remote branch, tracks it, and preserves edits on retry", async () => {
  await remoteFixture();
  const p = await makePlan({ mode: "remote-branch", remoteBranch: "colleague/review" });
  await expect(git(source, ["rev-parse", "--verify", "refs/remotes/origin/colleague/review"])).rejects.toThrow();
  await create(p, data);
  expect(await git(p.path, ["branch", "--show-current"])).toBe("colleague/review");
  expect(await git(p.path, ["rev-parse", "--abbrev-ref", "@{upstream}"])).toBe("origin/colleague/review");
  await writeFile(join(p.path, "review-notes"), "keep");
  await create(await makePlan({ mode: "remote-branch", remoteBranch: "colleague/review" }), data);
  expect(await readFile(join(p.path, "review-notes"), "utf8")).toBe("keep");
});

it("refuses local branch collisions but permits a distinct tracking branch name", async () => {
  await remoteFixture();
  await git(source, ["branch", "colleague/review"]);
  await expect(create(await makePlan({ mode: "remote-branch", remoteBranch: "colleague/review" }), data)).rejects.toThrow("Local branch already exists");
  const p = await makePlan({ mode: "remote-branch", remoteBranch: "colleague/review", branch: "review/alternate" });
  await create(p, data);
  expect(await git(p.path, ["rev-parse", "--abbrev-ref", "@{upstream}"])).toBe("origin/colleague/review");
});

it("rejects unknown remotes, malformed refs, and missing remote branches", async () => {
  await remoteFixture();
  await expect(makePlan({ mode: "remote-branch", remote: "--upload-pack=bad", remoteBranch: "main" })).rejects.toThrow("configured Git remote");
  await expect(makePlan({ mode: "remote-branch", remoteBranch: "bad:ref" })).rejects.toThrow();
  await expect(create(await makePlan({ mode: "remote-branch", remoteBranch: "missing" }), data)).rejects.toThrow();
  expect(await list(source)).toHaveLength(1);
});

it("discovers unfetched remote heads without changing local refs and reports unreachable remotes", async () => {
  await remoteFixture();
  await git(source, ["remote", "add", "offline", join(temp, "missing.git")]);
  const result = await remoteBranches(source);
  expect(result.branches).toContainEqual({ remote: "origin", branch: "colleague/review" });
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("offline");
  await expect(git(source, ["rev-parse", "--verify", "refs/remotes/origin/colleague/review"])).rejects.toThrow();
});
