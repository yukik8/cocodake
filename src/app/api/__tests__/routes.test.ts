import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getVerifiedUserId } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

// Route handlers run against a fake Supabase client that records every query, so the tests
// can check that each one is scoped to the verified user (the bug class this suite guards).
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getVerifiedUserId: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ createServerClient: vi.fn() }));

type Op = [string, unknown[]];
interface Query {
  table: string;
  ops: Op[];
}
type Result = { data?: unknown; error?: unknown; count?: number | null };

function fakeSupabase(respond: (q: Query) => Result = () => ({ data: null, error: null })) {
  const queries: Query[] = [];
  const from = (table: string) => {
    const q: Query = { table, ops: [] };
    queries.push(q);
    const builder: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const result = { data: null, error: null, ...respond(q) };
            return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            q.ops.push([String(prop), args]);
            return builder;
          };
        },
      }
    );
    return builder;
  };
  const deleteUser = vi.fn(async () => ({ data: {}, error: null }));
  const client = { from, auth: { admin: { deleteUser } } };
  vi.mocked(createServerClient).mockReturnValue(client as never);
  const has = (q: Query, op: string, ...args: unknown[]) =>
    q.ops.some(([name, a]) => name === op && args.every((v, i) => JSON.stringify(a[i]) === JSON.stringify(v)));
  return { queries, deleteUser, has };
}

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const P1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LEGACY_PHOTO = "https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=AbC_def-123456&key=SECRET_KEY";

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.mocked(getVerifiedUserId).mockReset();
  vi.mocked(createServerClient).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("every user-data endpoint rejects requests without a verified user", () => {
  it.each([
    ["DELETE /api/account", async () => (await import("@/app/api/account/route")).DELETE()],
    ["GET /api/places", async () => (await import("@/app/api/places/route")).GET()],
    ["PATCH /api/places", async () => (await import("@/app/api/places/route")).PATCH(json("/api/places", "PATCH", { id: P1, note: "x" }))],
    ["DELETE /api/places", async () => (await import("@/app/api/places/route")).DELETE(json("/api/places", "DELETE", { id: P1 }))],
    ["GET /api/places/add", async () => (await import("@/app/api/places/add/route")).GET(json("/api/places/add?lat=1&lng=2", "GET"))],
    ["POST /api/places/add", async () => (await import("@/app/api/places/add/route")).POST(json("/api/places/add", "POST", { lat: 1, lng: 2 }))],
    ["GET /api/search", async () => (await import("@/app/api/search/route")).GET(json("/api/search?q=cafe", "GET"))],
    ["POST /api/share", async () => (await import("@/app/api/share/route")).POST(json("/api/share", "POST", { place_ids: [P1] }))],
    ["POST /api/enrich", async () => (await import("@/app/api/enrich/route")).POST(json("/api/enrich", "POST", {}))],
    [
      "POST /api/import",
      async () => {
        const form = new FormData();
        form.append("file", new File(["[]"], "x.json"));
        return (await import("@/app/api/import/route")).POST(new NextRequest("http://localhost/api/import", { method: "POST", body: form }));
      },
    ],
  ])("%s → 401", async (_name, call) => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/account", () => {
  it("deletes only the verified user's shares, places and auth user", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    const db = fakeSupabase();
    const { DELETE } = await import("@/app/api/account/route");

    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(db.queries.map((q) => q.table)).toEqual(["shared_lists", "places"]);
    for (const q of db.queries) {
      expect(db.has(q, "delete")).toBe(true);
      expect(db.has(q, "eq", "user_session", USER)).toBe(true);
    }
    expect(db.deleteUser).toHaveBeenCalledWith(USER);
  });
});

describe("POST /api/share", () => {
  it("snapshots only the caller's own places, without owner ID or private note", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    const db = fakeSupabase((q) =>
      q.table === "places"
        ? {
            // what the DB would return for the owner's rows (the select already omits these columns;
            // toSharedPlace drops them again if a row ever carries them)
            data: [
              { id: P2, name: "Second", lat: 2, lng: 2, photo_url: LEGACY_PHOTO, user_session: USER, note: "private" },
              { id: P1, name: "First", lat: 1, lng: 1, photo_url: null },
            ],
          }
        : { data: { id: "share-1", title: null, expires_at: null, created_at: "now" } }
    );
    const { POST } = await import("@/app/api/share/route");

    const res = await POST(json("/api/share", "POST", { place_ids: [P1, P2, "not-a-uuid", P1], expires_in_days: 0, title: "  渋谷  " }));
    expect(res.status).toBe(200);
    expect((await res.json()).share.id).toBe("share-1");

    const [lookup, insert] = db.queries;
    expect(db.has(lookup, "eq", "user_session", USER)).toBe(true);
    expect(db.has(lookup, "in", "id", [P1, P2])).toBe(true);

    const row = insert.ops.find(([op]) => op === "insert")![1][0] as Record<string, unknown>;
    expect(row.user_session).toBe(USER);
    expect(row.title).toBe("渋谷");
    expect(row.expires_at).toBeNull();
    expect(row.place_ids).toEqual([P1, P2]); // request order kept
    const snapshot = JSON.stringify(row.places_snapshot);
    expect(snapshot).not.toContain("user_session");
    expect(snapshot).not.toContain("private");
    expect(snapshot).not.toContain("SECRET_KEY");
  });

  it.each([[-1], [1.5], ["7"], [9999]])("rejects expires_in_days = %s", async (days) => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    fakeSupabase();
    const { POST } = await import("@/app/api/share/route");
    expect((await POST(json("/api/share", "POST", { place_ids: [P1], expires_in_days: days }))).status).toBe(400);
  });
});

describe("/api/places", () => {
  it("GET loads every page for the verified user (in parallel after the first) and hides the photo key", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    const db = fakeSupabase((q) => {
      const range = q.ops.find(([op]) => op === "range")![1] as [number, number];
      const rows = Array.from({ length: range[0] >= 2000 ? 500 : 1000 }, (_, i) => ({ id: `${range[0] + i}`, photo_url: LEGACY_PHOTO }));
      return { data: rows, count: 2500 };
    });
    const { GET } = await import("@/app/api/places/route");

    const body = await (await GET()).json();
    expect(body.places).toHaveLength(2500);
    expect(JSON.stringify(body)).not.toContain("SECRET_KEY");
    expect(db.queries).toHaveLength(3);
    for (const q of db.queries) expect(db.has(q, "eq", "user_session", USER)).toBe(true);
  });

  it("PATCH and DELETE are scoped to the verified user and validate the ID", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    const db = fakeSupabase();
    const { PATCH, DELETE } = await import("@/app/api/places/route");

    expect((await DELETE(json("/api/places", "DELETE", { id: "1 or 1=1" }))).status).toBe(400);
    expect((await DELETE(json("/api/places", "DELETE", { id: P1, session: OTHER }))).status).toBe(200);
    expect((await PATCH(json("/api/places", "PATCH", { id: P1, note: "memo", session: OTHER }))).status).toBe(200);
    for (const q of db.queries) {
      expect(db.has(q, "eq", "user_session", USER)).toBe(true);
      expect(db.has(q, "eq", "user_session", OTHER)).toBe(false);
    }
  });

  it("answers 400, not 500, to a body that isn't JSON", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    fakeSupabase();
    const { DELETE } = await import("@/app/api/places/route");
    const req = new NextRequest("http://localhost/api/places", { method: "DELETE", body: "{not json" });
    expect((await DELETE(req)).status).toBe(400);
  });
});

describe("POST /api/places/add (from a search result)", () => {
  const body = { place_id: "ChIJabc12345", lat: 35.6, lng: 139.7, name: " Cafe ", photo_url: LEGACY_PHOTO, session: OTHER };

  it("saves for the verified user, ignoring a session in the body, and never stores the photo key", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    const db = fakeSupabase((q) =>
      q.ops.some(([op]) => op === "insert") ? { data: { id: P1, name: "Cafe", photo_url: "/api/photo?ref=AbC_def-123456" } } : { data: null }
    );
    const { POST } = await import("@/app/api/places/add/route");

    const res = await POST(json("/api/places/add", "POST", body));
    expect(res.status).toBe(200);
    const insert = db.queries.find((q) => q.ops.some(([op]) => op === "insert"))!;
    const row = insert.ops.find(([op]) => op === "insert")![1][0] as Record<string, unknown>;
    // shown by place ID; the reference the client sent is kept in place_photos
    expect(row).toMatchObject({ user_session: USER, place_id: "ChIJabc12345", name: "Cafe", photo_url: "/api/photo?place_id=ChIJabc12345" });
    const cached = db.queries.find((q) => q.table === "place_photos")!;
    expect(db.has(cached, "upsert")).toBe(true);
    expect(JSON.stringify(cached.ops)).toContain("AbC_def-123456");
  });

  it("turns a unique-index violation (two saves at once) into 409", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    fakeSupabase((q) => (q.ops.some(([op]) => op === "insert") ? { error: { code: "23505" } } : { data: null }));
    const { POST } = await import("@/app/api/places/add/route");
    expect((await POST(json("/api/places/add", "POST", body))).status).toBe(409);
  });

  it("refuses a javascript: URL without fetching anything", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    fakeSupabase();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/places/add/route");
    expect((await POST(json("/api/places/add", "POST", { url: "javascript:alert(1)" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/photo", () => {
  const photo302 = (where: string) => new Response(null, { status: 302, headers: { location: `https://lh3.googleusercontent.com/places/${where}` } });
  const details = (ref?: string) => Response.json({ status: "OK", result: ref ? { photos: [{ photo_reference: ref }] } : {} });
  const now = () => new Date().toISOString();
  const upserts = (db: ReturnType<typeof fakeSupabase>) =>
    db.queries.filter((q) => q.table === "place_photos").flatMap((q) => q.ops.filter(([op]) => op === "upsert").map(([, a]) => a[0]));

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = "SECRET_KEY";
  });

  it("?ref= redirects to Google's image URL without exposing the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(photo302("abc=s400"));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/photo/route");

    const res = await GET(new NextRequest("http://localhost/api/photo?ref=AbC_def-123456"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://lh3.googleusercontent.com/places/abc=s400");
    expect(JSON.stringify([...res.headers])).not.toContain("SECRET_KEY");
    expect(String(fetchMock.mock.calls[0][0])).toContain("key=SECRET_KEY");
  });

  it("?ref= answers 404 (cached briefly) for an expired reference", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Request", { status: 400 })));
    const { GET } = await import("@/app/api/photo/route");
    const res = await GET(new NextRequest("http://localhost/api/photo?ref=Expired_ref_123"));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
  });

  it("uses the stored reference: one Google call, no Place Details lookup", async () => {
    fakeSupabase((q) => (q.table === "place_photos" ? { data: { photo_ref: "Stored_ref_ABCDEFG", fetched_at: now() } } : {}));
    const fetchMock = vi.fn().mockResolvedValue(photo302("stored=s400"));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/photo/route");

    const res = await GET(new NextRequest("http://localhost/api/photo?place_id=ChIJabc12345"));
    expect(res.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("photo_reference=Stored_ref_ABCDEFG");
  });

  it("when the stored reference has expired, fetches the current one, stores it and shows it", async () => {
    const db = fakeSupabase((q) => (q.table === "place_photos" ? { data: { photo_ref: "Expired_ref_123", fetched_at: now() } } : {}));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad Request", { status: 400 }))
      .mockResolvedValueOnce(details("Fresh_ref_ABCDEFG"))
      .mockResolvedValueOnce(photo302("fresh=s400"));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/photo/route");

    const res = await GET(new NextRequest("http://localhost/api/photo?place_id=ChIJabc12345"));
    expect(res.headers.get("location")).toBe("https://lh3.googleusercontent.com/places/fresh=s400");
    expect(String(fetchMock.mock.calls[1][0])).toContain("place_id=ChIJabc12345");
    expect(upserts(db)).toEqual([[expect.objectContaining({ place_id: "ChIJabc12345", photo_ref: "Fresh_ref_ABCDEFG" })]]);
  });

  it("with nothing stored, looks up a saved place's photo and stores the reference", async () => {
    const db = fakeSupabase((q) => (q.table === "places" ? { data: { id: P1 } } : {}));
    const fetchMock = vi.fn().mockResolvedValueOnce(details("Fresh_ref_ABCDEFG")).mockResolvedValueOnce(photo302("fresh=s400"));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/photo/route");

    expect((await GET(new NextRequest("http://localhost/api/photo?place_id=ChIJabc12345"))).status).toBe(302);
    expect(upserts(db)).toHaveLength(1);
  });

  it("never asks Google about a place nobody saved", async () => {
    fakeSupabase();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/photo/route");

    expect((await GET(new NextRequest("http://localhost/api/photo?place_id=ChIJnotSaved123"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records a place without photos, and answers 404 without asking Google again for a week", async () => {
    const db = fakeSupabase((q) => (q.table === "places" ? { data: { id: P1 } } : {}));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(details()));
    const { GET } = await import("@/app/api/photo/route");
    expect((await GET(new NextRequest("http://localhost/api/photo?place_id=ChIJabc12345"))).status).toBe(404);
    expect(upserts(db)).toEqual([[expect.objectContaining({ place_id: "ChIJabc12345", photo_ref: null })]]);

    fakeSupabase((q) => (q.table === "place_photos" ? { data: { photo_ref: null, fetched_at: now() } } : {}));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(new NextRequest("http://localhost/api/photo?place_id=ChIJabc12345"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not cache a failure when Google is unavailable", async () => {
    fakeSupabase((q) => (q.table === "places" ? { data: { id: P1 } } : {}));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "OVER_QUERY_LIMIT" })));
    const { GET } = await import("@/app/api/photo/route");
    const res = await GET(new NextRequest("http://localhost/api/photo?place_id=ChIJabc12345"));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("still works before the migration (no place_photos table yet)", async () => {
    fakeSupabase((q) => (q.table === "place_photos" ? { error: { code: "PGRST205" } } : { data: { id: P1 } }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(details("Fresh_ref_ABCDEFG")).mockResolvedValueOnce(photo302("fresh=s400")));
    const { GET } = await import("@/app/api/photo/route");
    expect((await GET(new NextRequest("http://localhost/api/photo?place_id=ChIJabc12345"))).status).toBe(302);
  });

  it("answers 404 to an invalid reference or place ID without calling Google", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/photo/route");
    expect((await GET(new NextRequest("http://localhost/api/photo?ref=../../etc"))).status).toBe(404);
    expect((await GET(new NextRequest("http://localhost/api/photo?place_id=../x"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getSharedList (share page and GET /api/share/[id])", () => {
  it("treats a malformed ID as not found without querying", async () => {
    const db = fakeSupabase();
    const { getSharedList } = await import("@/lib/sharedList");
    expect(await getSharedList("1 or 1=1")).toEqual({ status: "not_found" });
    expect(db.queries).toHaveLength(0);
  });

  it("reports an expired link", async () => {
    fakeSupabase(() => ({ data: { id: P1, title: null, places_snapshot: [], expires_at: "2000-01-01T00:00:00Z", created_at: "x" } }));
    const { getSharedList } = await import("@/lib/sharedList");
    expect((await getSharedList(P1)).status).toBe("expired");
  });

  it("strips owner IDs, notes and photo keys from snapshots saved before the fix", async () => {
    fakeSupabase(() => ({
      data: {
        id: P2,
        title: "old share",
        expires_at: null,
        created_at: "x",
        places_snapshot: [{ id: P1, name: "A", lat: 1, lng: 2, user_session: OTHER, note: "private", photo_url: LEGACY_PHOTO }],
      },
    }));
    const { getSharedList } = await import("@/lib/sharedList");
    const result = await getSharedList(P2);
    expect(result.status).toBe("ok");
    const text = JSON.stringify(result);
    expect(text).not.toContain(OTHER);
    expect(text).not.toContain("private");
    expect(text).not.toContain("SECRET_KEY");
  });
});

describe("POST /api/import", () => {
  const upload = async (name: string, content: BlobPart) => {
    const form = new FormData();
    form.append("file", new File([content], name));
    const { POST } = await import("@/app/api/import/route");
    return POST(new NextRequest("http://localhost/api/import", { method: "POST", body: form, headers: { "X-Stream": "true" } }));
  };

  it("answers a wrong file at once with a JSON error, before any streaming", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    const res = await upload("takeout-20261020.zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(res.status).toBe(415);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()).error).toContain("zipファイルのままです");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("turns a file over 4MB away with its own 413, under Vercel's 4.5MB request limit", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    const res = await upload("big.csv", new Uint8Array(4 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("ファイルが大きすぎます（4MBまで）");
  });

  it("says when a CSV has no places", async () => {
    vi.mocked(getVerifiedUserId).mockResolvedValue(USER);
    const res = await upload("list.csv", "name,address\nCafe,Tokyo\n");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("スポットが見つかりませんでした");
  });
});

