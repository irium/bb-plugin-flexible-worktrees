// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, waitFor, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(cleanup);
async function setup(value: Record<string, string> | null = null, fail = false) {
  const app = await loadPluginApp(() => import("./app"));
  const onChange = vi.fn();
  const slot = renderSlot(app.environmentProviderInputs[0]!, {
    projectId: "project", target: { kind: "existing-host", hostId: "host" }, value, onChange,
  }, { rpc: { choices: () => {
    if (fail) throw new Error("Offline");
    return { worktrees: [{ path: "/repo", branch: "main" }, { path: "/worktrees/feature", branch: "feature/ui" }], defaultRoot: "/worktrees/{repo}" };
  }, remoteBranches: () => ({ branches: [{ remote: "origin", branch: "colleague/review" }, { remote: "upstream", branch: "main" }], errors: [] }) } });
  return { slot, onChange };
}

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
