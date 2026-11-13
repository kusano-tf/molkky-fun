import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const template = readFileSync(new URL("../scripts/sw.js", import.meta.url), "utf8");

function createWorker(scope: string) {
  type FetchEvent = { request: { url: string; method: string; mode: string }; respondWith: (value: unknown) => void };
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const cachedPage = { source: "cached app" };
  const match = vi.fn(async () => cachedPage);
  const fetch = vi.fn();
  runInNewContext(template.replace("__VERSION__", "test").replace("__FILES__", '["index.html"]'), {
    URL,
    self: { registration: { scope }, addEventListener: (name: string, handler: (event: FetchEvent) => void) => handlers.set(name, handler) },
    caches: { open: async () => ({ match }) },
    fetch,
  });
  return { handlers, cachedPage, match, fetch };
}

describe.each(["https://example.com/", "https://example.com/molkky-fun/"])("service worker at %s", (scope) => {
  it.each(["", "?source=home", "index.html"])("keeps offline app navigation for %s", async (path) => {
    const worker = createWorker(scope);
    const respondWith = vi.fn();
    worker.handlers.get("fetch")!({ request: { url: `${scope}${path}`, method: "GET", mode: "navigate" }, respondWith });
    expect(respondWith).toHaveBeenCalledOnce();
    await expect(respondWith.mock.calls[0][0]).resolves.toBe(worker.cachedPage);
    expect(worker.match).toHaveBeenCalledWith(`${scope}index.html`);
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it.each(["navigate", "cors"])("leaves direct JSON requests to the server (%s)", (mode) => {
    const worker = createWorker(scope);
    const respondWith = vi.fn();
    worker.handlers.get("fetch")!({ request: { url: `${scope}app-data.schema.json`, method: "GET", mode }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(worker.match).not.toHaveBeenCalled();
  });
});
