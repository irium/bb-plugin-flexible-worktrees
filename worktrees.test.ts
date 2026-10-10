import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import type { PathDefaults } from "./inputs";
import { inputsSchema } from "./contract";
import { create, git, list, plan, preview, remoteBranches } from "./worktrees";

let temp: string, source: string, data: string;
beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), "flexible-worktrees-test-")));
  source = join(temp, "repo"); data = join(temp, "data");
  await mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await git(source, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "initial"]);
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
const makePlan = (inputs: Record<string, string> = {}, pathKey = "test-key", defaults: Partial<PathDefaults> = {}) => plan({ source, inputs: inputsSchema.parse(inputs), pathTemplate: join(temp, "worktrees", "{repo}", "{pathKey}"), ...defaults, pathKey, suggestedBranch: "bb/test" });

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

describe("destination templates", () => {
  const siblings = { pathTemplate: "{checkoutParent}/{repo}.{branch}" };
  it("creates a sibling using a sanitized branch, without changing the Git branch", async () => {
    const p = await makePlan({ branch: "feature/login" }, "key", siblings);
    expect(p.path).toBe(join(temp, "repo.feature-login"));
    await create(p, data);
    expect(await git(p.path, ["branch", "--show-current"])).toBe("feature/login");
    await writeFile(join(p.path, "keep"), "uncommitted");
    await create(await makePlan({ branch: "feature/login" }, "key", siblings), data);
    expect(await readFile(join(p.path, "keep"), "utf8")).toBe("uncommitted");
  });
  it("supports both a shared root and checkout-relative destinations with one template", async () => {
    expect((await makePlan({}, "key", { pathTemplate: "{checkoutParent}/worktrees/{repo}/{pathKey}" })).path).toBe(join(temp, "worktrees", "repo", "key"));
    expect((await makePlan({}, "key", { pathTemplate: "{repoPath}/.worktrees/{pathKey}" })).path).toBe(join(source, ".worktrees", "key"));
  });
  it.each([undefined, "", "   "])("defaults to unique folders under ~/worktrees when the template is not provided: %s", async pathTemplate => {
    const key = `${basename(temp)}-default`;
    const p = await plan({ source, inputs: inputsSchema.parse({}), pathTemplate, pathKey: key, suggestedBranch: "bb/test" });
    expect(p.path).toBe(join(await realpath(homedir()), "worktrees", key));
    expect(await list(source)).toHaveLength(1);
  });
  it("resolves relative templates from the checkout and expands a leading tilde", async () => {
    expect((await makePlan({}, "key", { pathTemplate: "../{repo}.{branch}" })).path).toBe(join(temp, "repo.bb-test"));
    expect((await makePlan({}, "key", { pathTemplate: "~/worktrees/{repo}/{pathKey}" })).path).toBe(await realpath(homedir()).then(home => join(home, "worktrees", "repo", "key")));
  });
  it("uses BB's suggested branch and path key when names are automatic", async () => {
    expect((await makePlan({}, "key", { pathTemplate: "{checkoutParent}/{repo}.{branch}-{pathKey}" })).path).toBe(join(temp, "repo.bb-test-key"));
  });
  it("overrides parent and folder independently per thread", async () => {
    expect((await makePlan({ root: join(temp, "custom"), branch: "feature/login" }, "key", siblings)).path).toBe(join(temp, "custom", "repo.feature-login"));
    expect((await makePlan({ folder: "chosen", branch: "feature/login" }, "key", siblings)).path).toBe(join(temp, "chosen"));
    expect((await makePlan({ root: "{repoPath}/.worktrees", folder: "chosen" }, "key", siblings)).path).toBe(join(source, ".worktrees", "chosen"));
    expect((await makePlan({ root: join(temp, "custom"), folder: "chosen" }, "key", { pathTemplate: "/" })).path).toBe(join(temp, "custom", "chosen"));
  });
  it("anchors relative templates to a linked source but keeps the primary repo name", async () => {
    const linked = join(temp, "linked");
    await git(source, ["worktree", "add", "-b", "linked", linked]);
    const p = await plan({ source: linked, inputs: inputsSchema.parse({ branch: "other" }), pathTemplate: "../{repo}.{branch}", pathKey: "key", suggestedBranch: "bb/unused" });
    expect(p.path).toBe(join(temp, "repo.other"));
    expect(p.source).toBe(linked);
  });
  it("keeps existing checkout mode independent of destination settings", async () => {
    const p = await makePlan({ mode: "existing", checkout: source }, "key", { pathTemplate: "{unknown}" });
    expect(p.path).toBe(source);
    expect(await create(p, data)).toEqual({ path: source });
    expect(await preview({ source, inputs: inputsSchema.parse({ mode: "existing", checkout: source }), pathTemplate: "/" })).toMatchObject({ path: source, automaticBranch: false, automaticFolder: false });
  });
  it.each(["{unknown}/{repo}", "{{ repo }}", "{repoPath}/..", "{repoPath}/.", "/"])('rejects invalid full templates: %s', async pathTemplate => {
    await expect(makePlan({}, "key", { pathTemplate })).rejects.toThrow();
    expect(await list(source)).toHaveLength(1);
  });
  it("canonicalizes templated parents and refuses sanitized-name collisions", async () => {
    await mkdir(join(temp, "real")); await symlink(join(temp, "real"), join(temp, "alias"));
    const template = { pathTemplate: join(temp, "alias", "{branch}") };
    const p = await makePlan({ branch: "feature/login" }, "first", template);
    expect(p.path).toBe(join(temp, "real", "feature-login"));
    await create(p, data);
    await expect(create(await makePlan({ branch: "feature-login" }, "second", template), data)).rejects.toThrow("Destination already exists");
    expect(await git(p.path, ["branch", "--show-current"])).toBe("feature/login");
  });
  it("uses the chosen local branch name for remote destinations", async () => {
    await remoteFixture();
    const remote = await makePlan({ mode: "remote-branch", remoteBranch: "colleague/review" }, "one", siblings);
    expect(remote.path).toBe(join(temp, "repo.colleague-review"));
    const local = await makePlan({ mode: "remote-branch", remoteBranch: "colleague/review", branch: "review/custom" }, "two", siblings);
    expect(local.path).toBe(join(temp, "repo.review-custom"));
    expect((await makePlan({ mode: "existing-branch", branch: "main" }, "key", siblings)).path).toBe(join(temp, "repo.main"));
  });
  it("previews explicit destinations using the same resolver, without mutation", async () => {
    const inputs = inputsSchema.parse({ branch: "feature/login" });
    const result = await preview({ source, inputs, ...siblings });
    expect(result).toEqual({ path: (await makePlan({ branch: "feature/login" }, "key", siblings)).path, root: temp, folder: "repo.feature-login", automaticBranch: false, automaticFolder: false });
    expect(await list(source)).toHaveLength(1);
  });
  it("marks unknown automatic names in previews rather than inventing final names", async () => {
    const result = await preview({ source, inputs: inputsSchema.parse({}), pathTemplate: "{checkoutParent}/{repo}.{branch}-{pathKey}" });
    expect(result.path).toBe(join(temp, "repo.<automatic branch>-<automatic folder>"));
    expect(result.automaticBranch).toBe(true);
    expect(result.automaticFolder).toBe(true);
    const explicit = await preview({ source, inputs: inputsSchema.parse({ root: temp, folder: "chosen" }), pathTemplate: "{checkoutParent}/{repo}.{branch}-{pathKey}" });
    expect(explicit).toMatchObject({ path: join(temp, "chosen"), automaticBranch: false, automaticFolder: false });
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
