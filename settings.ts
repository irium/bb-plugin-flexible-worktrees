import { pathDefaultsSchema, projectOverridesSchema, type PathDefaults } from "./inputs";

/** Normalize remote URLs without contacting the remote or retaining credentials. */
export function remoteIdentity(remote: string | null): string | null {
  if (!remote) return null;
  let host: string, path: string;
  if (remote.includes("://")) {
    try {
      const url = new URL(remote);
      if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
      host = url.hostname; path = url.pathname;
    } catch { return null; }
  } else {
    const scp = /^(?:[^/@:]+@)?([^/:]+):(.+)$/.exec(remote);
    if (scp) { host = scp[1]!; path = scp[2]!; }
    else {
      const identity = /^([^/:]+)\/(.+)$/.exec(remote);
      if (!identity) return null;
      host = identity[1]!; path = identity[2]!;
    }
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  if (!host || !path || /[\\\s]/.test(host + path) || path.split("/").some(p => !p || p === "." || p === "..")) return null;
  return `${host.toLowerCase()}/${path}`;
}

function matches(pattern: string, identity: string) {
  const regex = pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${regex}$`).test(identity);
}

/** Project ID wins, then the most specific remote pattern, then global settings. */
export function projectDefaults(settings: PathDefaults & { projectOverrides: string }, projectId: string, remote: string | null): PathDefaults {
  const defaults = pathDefaultsSchema.parse(settings);
  const overrides = projectOverridesSchema.parse(JSON.parse(settings.projectOverrides));
  if (Object.hasOwn(overrides, projectId)) return pathDefaultsSchema.parse({ pathTemplate: overrides[projectId]! });
  const identity = remoteIdentity(remote);
  if (!identity) return defaults;
  const candidates = Object.entries(overrides).flatMap(([key, template]) => {
    const pattern = remoteIdentity(key);
    return pattern && matches(pattern, identity) ? [{ key, pattern, template }] : [];
  }).sort((a, b) => Number(b.pattern === identity) - Number(a.pattern === identity)
    || b.pattern.replaceAll("*", "").length - a.pattern.replaceAll("*", "").length
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return candidates.length ? pathDefaultsSchema.parse({ pathTemplate: candidates[0]!.template }) : defaults;
}
