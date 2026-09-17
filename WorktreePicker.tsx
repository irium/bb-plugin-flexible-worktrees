import { useId, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { inputsSchema, type Inputs } from "./inputs";

export type Checkout = { path: string; branch: string };
export interface WorktreePickerProps {
  form: Inputs;
  choices: Checkout[];
  defaultRoot: string;
  loading: boolean;
  error: string;
  onChange(form: Inputs): void;
  onRefresh(): void;
}

function Icon({ kind, className = "" }: { kind: "branch" | "chevron" | "refresh" | "check" | "folder"; className?: string }) {
  const paths: Record<typeof kind, ReactNode> = {
    branch: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 7v10m12-10a10 10 0 0 1-10 10" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    folder: <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />,
  };
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>{paths[kind]}</svg>;
}

export function shortPath(path: string) {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)|^\/home\/[^/]+(?=\/|$)/, "~");
}

export function WorktreePicker({ form, choices, defaultRoot, loading, error, onChange, onRefresh }: WorktreePickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState<boolean | null>(null);
  const existing = form.mode === "existing";
  const selected = choices.find(c => c.path === form.checkout);
  const showManual = manual ?? Boolean(form.checkout && !selected && !loading);
  const filtered = choices.filter(c => `${c.branch} ${c.path}`.toLowerCase().includes(query.toLowerCase()));
  const parsed = inputsSchema.safeParse(form);
  const invalid = parsed.success ? "" : parsed.error.issues[0]!.message;
  const summary = existing ? (selected?.branch || shortPath(form.checkout).split("/").filter(Boolean).pop() || "Choose checkout") : (form.branch || "New worktree");
  const destination = existing ? form.checkout : `${form.root || defaultRoot}/${form.folder || "<automatic folder>"}`;
  const patch = (values: Partial<Inputs>) => onChange({ ...form, ...values });
  const field = (key: keyof Inputs, label: string, placeholder: string, hint?: string) => <div className="grid min-w-0 gap-1.5 text-xs font-medium text-foreground">
    <label htmlFor={`${id}-${key}`}>{label}</label>
    <Input id={`${id}-${key}`} aria-describedby={hint ? `${id}-${key}-hint` : undefined} className="h-8 min-w-0 text-sm" value={form[key]} placeholder={placeholder} onChange={e => patch({ [key]: e.target.value })} />
    {hint && <span id={`${id}-${key}-hint`} className="text-xs font-normal text-muted-foreground">{hint}</span>}
  </div>;

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button type="button" aria-label={`Configure worktree: ${summary}`} title={destination || "Choose an existing checkout"}
        className="inline-flex h-8 max-w-[240px] min-w-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Icon kind={existing ? "folder" : "branch"} />
        <span className="truncate">{summary}</span>
        {invalid && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-label="Configuration required" />}
        <Icon kind="chevron" />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="end" side="bottom" sideOffset={8} collisionPadding={12}
        aria-labelledby={`${id}-title`}
        style={{ width: "min(420px, calc(100vw - 24px))", maxHeight: "var(--radix-popover-content-available-height)", overflowY: "auto" }}
        className="z-50 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
        <div className="grid gap-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id={`${id}-title`} className="text-sm font-semibold">Workspace</h2>
            <span className="text-xs text-muted-foreground">Flexible Worktrees</span>
          </div>
          <div role="group" aria-label="Workspace mode" className="flex gap-1 rounded-lg bg-muted p-1">
            {[{ label: "Existing checkout", value: "existing" }, { label: "New worktree", value: "new-branch" }].map(mode => <button
              key={mode.value} type="button" aria-pressed={mode.value === "existing" ? existing : !existing}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${(mode.value === "existing" ? existing : !existing) ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => patch({ mode: mode.value as Inputs["mode"] })}>{mode.label}</button>)}
          </div>
          {existing ? <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{showManual ? "Checkout path" : "Choose a checkout"}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setManual(!showManual)}>{showManual ? "Browse checkouts" : "Enter a path"}</Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Refresh checkouts" disabled={loading} onClick={onRefresh}>
                  <Icon kind="refresh" className={loading ? "animate-spin" : ""} />
                </Button>
              </div>
            </div>
            {showManual ? field("checkout", "Existing checkout path", "~/dev/my-repo", "An absolute path or ~/path on the selected machine.") : <>
              <Input className="h-8 text-sm" aria-label="Filter checkouts" placeholder="Filter by branch or path…" value={query} onChange={e => setQuery(e.target.value)} />
              <div role="group" aria-label="Available checkouts" aria-busy={loading} className="max-h-44 overflow-y-auto rounded-lg border border-border p-1">
                {filtered.map(c => <button type="button" key={c.path} aria-pressed={form.checkout === c.path} title={c.path}
                  onClick={() => patch({ checkout: c.path })}
                  className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${form.checkout === c.path ? "bg-accent text-accent-foreground" : "text-foreground"}`}>
                  <Icon kind="branch" className="text-muted-foreground" />
                  <span className="grid min-w-0 flex-1 gap-0.5"><span className="truncate text-sm font-medium">{c.branch}</span><span className="truncate font-mono text-xs text-muted-foreground">{shortPath(c.path)}</span></span>
                  {form.checkout === c.path && <Icon kind="check" />}
                </button>)}
                {!filtered.length && <p className="px-3 py-5 text-center text-xs text-muted-foreground">{loading ? "Loading checkouts…" : query ? "No matching checkouts." : "No checkouts found. Enter a path instead."}</p>}
              </div>
            </>}
            <p className="text-xs text-muted-foreground">Keeps the checkout’s current branch and local changes.</p>
          </div> : <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              {field("folder", "Folder name", "Automatic")}
              {field("branch", "Branch name", form.mode === "new-branch" ? "Automatic" : "feature/my-change")}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="h-3.5 w-3.5 accent-current" checked={form.mode === "existing-branch"} onChange={e => patch({ mode: e.target.checked ? "existing-branch" : "new-branch" })} />
              Use an existing local branch
            </label>
            {form.mode === "new-branch" && field("base", "Base revision", "HEAD")}
            {field("root", "Parent directory", defaultRoot)}
          </div>}
          {destination && <div className="rounded-lg bg-muted/50 px-3 py-2">
            <div className="mb-1 text-xs text-muted-foreground">{existing ? "Selected checkout" : "Destination"}</div>
            <div className="break-all font-mono text-xs leading-relaxed" title={destination}>{shortPath(destination)}</div>
          </div>}
          {invalid && <p role="alert" className="text-xs text-destructive">{invalid}</p>}
          {error && <p role="alert" className="text-xs text-destructive">Couldn’t load checkouts. Enter a path or try refreshing.</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground" title="Archiving or deleting a thread keeps its worktree and branch. Remove them manually with Git when finished.">Files are kept when threads close.</span>
          <Popover.Close asChild><Button type="button" size="sm" className="h-7 px-3 text-xs" disabled={Boolean(invalid)}>Done</Button></Popover.Close>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
