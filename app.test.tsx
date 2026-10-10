// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, waitFor, screen, cleanup, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Inputs, DestinationPreview } from "./inputs";

afterEach(cleanup);
async function setup(value: Record<string, string> | null = null, fail = false, pathTemplate = "~/worktrees/{pathKey}") {
  const app = await loadPluginApp(() => import("./app"));
  const onChange = vi.fn();
  const preview = vi.fn(async ({ inputs }: { inputs: Inputs }): Promise<DestinationPreview> => {
    const branch = inputs.branch || inputs.remoteBranch || "<automatic branch>";
    const sibling = pathTemplate.includes("{branch}");
    const root = inputs.root || (sibling ? "/" : "/home/test/worktrees");
    const folder = inputs.folder || (sibling ? `repo.${branch.replaceAll("/", "-")}` : "<automatic folder>");
    return { path: `${root.replace(/\/$/, "")}/${folder}`, root, folder, automaticBranch: Boolean(sibling && !inputs.branch && !inputs.remoteBranch), automaticFolder: !inputs.folder && !sibling };
  });
  const slot = renderSlot(app.environmentProviderInputs[0]!, {
    projectId: "project", target: { kind: "existing-host", hostId: "host" }, value, onChange,
  }, { rpc: { choices: () => {
    if (fail) throw new Error("Offline");
    return { worktrees: [{ path: "/repo", branch: "main" }, { path: "/worktrees/feature", branch: "feature/ui" }], pathTemplate };
  }, preview: input => preview(input as { inputs: Inputs }), remoteBranches: () => ({ branches: [{ remote: "origin", branch: "colleague/review" }, { remote: "upstream", branch: "main" }], errors: [] }) } });
  return { slot, onChange, preview };
}

it("keeps settings help scannable and reveals details without changing configuration", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.settingsSections[0]!, {});
  const layouts = within(screen.getByRole("region", { name: "Common path layouts" }));
  expect(layouts.getByText("Default")).toBeTruthy();
  expect(layouts.getByText("~/worktrees/{pathKey}")).toBeTruthy();
  expect(layouts.getByText("~/worktrees/{repo}/{pathKey}")).toBeTruthy();
  expect(layouts.getByText("{checkoutParent}/{repo}.{branch}")).toBeTruthy();
  const variables = screen.getByText("Variables and path rules");
  const projects = screen.getByText("Per-project override examples");
  expect((variables.closest("details") as HTMLDetailsElement).open).toBe(false);
  expect((projects.closest("details") as HTMLDetailsElement).open).toBe(false);
  fireEvent.click(variables);
  expect((variables.closest("details") as HTMLDetailsElement).open).toBe(true);
  for (const token of ["{repo}", "{repoPath}", "{checkoutParent}", "{branch}", "{pathKey}"]) {
    expect(within(variables.closest("details")!).getAllByText(token).length).toBeGreaterThan(0);
  }
  expect(screen.getByText("/home/user/GIT/app.feature-login")).toBeTruthy();
  fireEvent.click(projects);
  expect((projects.closest("details") as HTMLDetailsElement).open).toBe(true);
  expect(JSON.parse(projects.closest("details")!.querySelector("pre")!.textContent!)).toEqual({
    "github.com/my-org/*": "{checkoutParent}/{repo}.{branch}", "proj_example": "~/special/{repo}/{pathKey}",
  });
  expect(slot.inspection.rpcCalls).toHaveLength(0);
  slot.lifecycle.unmount();
});

it("keeps the composer compact, edits in a popover, and preserves changes when closed", async () => {
  const { slot, onChange } = await setup();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByLabelText("Folder name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Configure worktree: New worktree" }));
  expect(screen.getByRole("dialog", { name: "Workspace" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "chosen-folder" } });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ folder: "chosen-folder" }) })));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Configure worktree: New worktree" }));
  expect((screen.getByLabelText("Folder name") as HTMLInputElement).value).toBe("chosen-folder");
  slot.lifecycle.unmount();
});

it("filters existing checkouts and avoids a duplicate editable path field", async () => {
  const { slot, onChange } = await setup();
  fireEvent.click(screen.getByRole("button", { name: /Configure worktree/ }));
  fireEvent.click(screen.getByRole("button", { name: "Existing checkout" }));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "blocked" })));
  await screen.findByText("feature/ui");
  fireEvent.change(screen.getByLabelText("Filter checkouts"), { target: { value: "feature" } });
  expect(screen.queryByText("main")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /feature\/ui/ }));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready", value: expect.objectContaining({ mode: "existing", checkout: "/worktrees/feature" }) })));
  expect(screen.queryByLabelText("Existing checkout path")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Configure worktree: feature/ui" })).toBeTruthy();
  slot.lifecycle.unmount();
});

it("supports manual paths even when discovery fails", async () => {
  const { slot, onChange } = await setup(null, true);
  fireEvent.click(screen.getByRole("button", { name: /Configure worktree/ }));
  fireEvent.click(screen.getByRole("button", { name: "Existing checkout" }));
  await screen.findByText(/Couldn’t load checkouts/);
  fireEvent.click(screen.getByRole("button", { name: "Enter a path" }));
  fireEvent.change(screen.getByLabelText("Existing checkout path"), { target: { value: "/another/repo" } });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready", value: expect.objectContaining({ checkout: "/another/repo" }) })));
  slot.lifecycle.unmount();
});

it("validates existing branches and keeps form actions from submitting the composer", async () => {
  const { slot, onChange } = await setup();
  fireEvent.click(screen.getByRole("button", { name: /Configure worktree/ }));
  fireEvent.change(screen.getByLabelText("Branch source"), { target: { value: "existing-branch" } });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "blocked" })));
  expect(screen.queryByLabelText("Base revision")).toBeNull();
  fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "existing" } });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready", value: expect.objectContaining({ mode: "existing-branch", branch: "existing" }) })));
  for (const button of screen.getAllByRole("button")) expect(button.getAttribute("type")).toBe("button");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  slot.lifecycle.unmount();
});

it("shows the default template and its resolved parent without a separate root setting", async () => {
  const { slot, onChange } = await setup();
  fireEvent.click(screen.getByRole("button", { name: /Configure worktree/ }));
  await screen.findByText("~/worktrees/<automatic folder>");
  expect(screen.getByText("Template: ~/worktrees/{pathKey}")).toBeTruthy();
  expect((screen.getByLabelText("Parent directory") as HTMLInputElement).placeholder).toBe("/home/test/worktrees");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ root: "", folder: "" }) }));
  slot.lifecycle.unmount();
});

it("previews project templates without materializing defaults into per-thread overrides", async () => {
  const { slot, onChange } = await setup({ branch: "feature/login" }, false, "{checkoutParent}/{repo}.{branch}");
  fireEvent.click(screen.getByRole("button", { name: /Configure worktree/ }));
  await screen.findByText("/repo.feature-login");
  expect((screen.getByLabelText("Parent directory") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Folder name") as HTMLInputElement).placeholder).toBe("repo.feature-login");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready", value: expect.objectContaining({ root: "", folder: "" }) }));
  fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "chosen" } });
  await screen.findByText("/chosen");
  fireEvent.change(screen.getByLabelText("Parent directory"), { target: { value: "/custom" } });
  await screen.findByText("/custom/chosen");
  slot.lifecycle.unmount();
});

it("shows automatic-name placeholders and blocks invalid destination previews", async () => {
  const { slot, onChange, preview } = await setup(null, false, "{checkoutParent}/{repo}.{branch}");
  fireEvent.click(screen.getByRole("button", { name: /Configure worktree/ }));
  await screen.findByText("/repo.<automatic branch>");
  expect(screen.getByText("Automatic names are assigned at launch.")).toBeTruthy();
  preview.mockImplementationOnce(async () => { throw new Error("Invalid branch name"); });
  fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "HEAD" } });
  await screen.findByText(/Couldn’t resolve destination:.*Invalid branch name/);
  expect(screen.queryByText("/repo.<automatic branch>")).toBeNull();
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "blocked" }));
  fireEvent.click(screen.getByRole("button", { name: "Existing checkout" }));
  fireEvent.click(await screen.findByRole("button", { name: /main.*\/repo/ }));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready", value: expect.objectContaining({ mode: "existing" }) })));
  slot.lifecycle.unmount();
});

it("ignores late preview results after the destination changes", async () => {
  const { slot, preview } = await setup();
  let resolveOld!: (value: DestinationPreview) => void;
  preview.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: /Configure worktree/ }));
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "latest" } });
  await screen.findByText("~/worktrees/latest");
  resolveOld({ path: "/stale", root: "/", folder: "stale", automaticBranch: false, automaticFolder: false });
  await waitFor(() => expect(screen.queryByText("/stale")).toBeNull());
  slot.lifecycle.unmount();
});

it("filters and selects a remote branch without typing Git details", async () => {
  const { slot, onChange } = await setup();
  fireEvent.click(screen.getByRole("button", { name: /Configure worktree/ }));
  fireEvent.change(screen.getByLabelText("Branch source"), { target: { value: "remote-branch" } });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "blocked" })));
  await screen.findByRole("button", { name: "origin/colleague/review" });
  fireEvent.change(screen.getByLabelText("Filter remote branches"), { target: { value: "colleague" } });
  expect(screen.queryByRole("button", { name: "upstream/main" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "origin/colleague/review" }));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready", value: expect.objectContaining({ mode: "remote-branch", remote: "origin", remoteBranch: "colleague/review", branch: "" }) })));
  expect(screen.queryByLabelText("Base revision")).toBeNull();
  for (const button of screen.getAllByRole("button")) expect(button.getAttribute("type")).toBe("button");
  slot.lifecycle.unmount();
});
