import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { fetchTiles } from "./traffic";

// Just enough of KV, assets and the cron context for the handlers.
function fakeEnv(stored: string | null = null) {
  const kv = new Map<string, string>(stored ? [["traffic-now", stored]] : []);
  return {
    kv,
    env: {
      TOMTOM_KEY: "test-key",
      TRAFFIC: {
        get: async (k: string) => kv.get(k) ?? null,
        put: async (k: string, v: string) => void kv.set(k, v),
      },
      ASSETS: { fetch: async () => new Response("asset") },
    } as unknown as Parameters<NonNullable<typeof worker.fetch>>[1],
  };
}

function runCron(env: ReturnType<typeof fakeEnv>["env"]): Promise<unknown> {
  let job: Promise<unknown> = Promise.resolve();
  const ctx = { waitUntil: (p: Promise<unknown>) => void (job = p) } as unknown as ExecutionContext;
  worker.scheduled!({} as ScheduledController, env, ctx);
  return job;
}

const request = (path: string) => new Request(`https://bike.example${path}`) as Parameters<NonNullable<typeof worker.fetch>>[0];

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/traffic", () => {
  it("is 503 before the first refresh", async () => {
    const { env } = fakeEnv();
    const res = await worker.fetch!(request("/api/traffic"), env);
    expect(res.status).toBe(503);
  });

  it("serves the stored snapshot with a short cache", async () => {
    const { env } = fakeEnv('{"updatedAt":"2026-10-24T21:00:00Z","segments":{}}');
    const res = await worker.fetch!(request("/api/traffic"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect((await res.json()) as object).toMatchObject({ updatedAt: "2026-10-24T21:00:00Z" });
  });

  it("hands every other path to the static assets", async () => {
    const { env } = fakeEnv();
    const res = await worker.fetch!(request("/"), env);
    expect(await res.text()).toBe("asset");
  });
});

describe("cron refresh", () => {
  it("keeps the last good snapshot when TomTom is down", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    const { env, kv } = fakeEnv('{"old":true}');
    await expect(runCron(env)).rejects.toThrow(/tile requests failed/);
    expect(kv.get("traffic-now")).toBe('{"old":true}');
  });

  it("writes a new snapshot when tiles come back", async () => {
    // Empty tiles decode to no traffic, but the refresh still records itself.
    vi.stubGlobal("fetch", async () => new Response(new ArrayBuffer(0)));
    const { env, kv } = fakeEnv();
    await runCron(env);
    const snap = JSON.parse(kv.get("traffic-now")!);
    expect(snap.tiles).toEqual({ requested: 93, failed: 0 });
    expect(snap.segments).toEqual({});
  });
});

describe("fetchTiles", () => {
  it("counts failures and never runs more than 6 requests at once", async () => {
    let active = 0;
    let peak = 0;
    const fakeFetch = (async (url: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return url.includes("/14/1/") ? new Response("", { status: 500 }) : new Response(new ArrayBuffer(4));
    }) as unknown as typeof fetch;
    const tiles = Array.from({ length: 20 }, (_, i) => `${i}/2`);
    const { buffers, failed } = await fetchTiles("k", { zoom: 14, tiles, segments: [] }, fakeFetch);
    expect(failed).toBe(1);
    expect(buffers).toHaveLength(19);
    expect(peak).toBeLessThanOrEqual(6);
  });
});
