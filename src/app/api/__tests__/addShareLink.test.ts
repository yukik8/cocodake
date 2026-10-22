import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { fetchAllowed } from "@/lib/safeFetch";
import { enrichPlaceByCoords, enrichPlaceById, enrichPlaceByName, geocodeAddress, placeCid, type PlacesResult } from "@/lib/placesApi";

// Adding a place from a Google Maps share link, with Google mocked. Share links expand to a ?q=
// with the name first and an ftid naming the place's CID; the shop and IDs below are made up.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getVerifiedUserId: vi.fn(async () => USER),
}));
vi.mock("@/lib/supabase", () => ({ createServerClient: vi.fn() }));
vi.mock("@/lib/safeFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safeFetch")>()),
  fetchAllowed: vi.fn(),
}));
vi.mock("@/lib/placesApi", () => ({
  enrichPlaceByCoords: vi.fn(),
  enrichPlaceById: vi.fn(),
  enrichPlaceByName: vi.fn(),
  geocodeAddress: vi.fn(),
  placeCid: vi.fn(),
}));

const USER = "11111111-1111-1111-1111-111111111111";
const SHARE_LINK = "https://maps.app.goo.gl/ExampleShareLink";
const EXPANDED =
  "https://maps.google.com/maps?q=Cafe+Sakura+Shiba+Branch,+2+Chome-5-1+Shiba,+Minato+City,+Tokyo,+105-0014&ftid=0x60188b0000000001:0x0123456789abcdef&entry=gps";
const CAFE_CID = BigInt("0x0123456789abcdef").toString();
const AT_ADDRESS = { lat: 35.65, lng: 139.75 };

const place = (name: string, place_id: string): PlacesResult => ({
  name,
  place_id,
  address: null,
  category: null,
  rating: null,
  photo_url: null,
  ...AT_ADDRESS,
});
const CAFE = place("カフェさくら 芝店", "ChIJcafe");
const OTHER_SHOP = place("SHIBA Tea Stand", "ChIJother");
const CIDS: Record<string, string> = { ChIJcafe: CAFE_CID, ChIJother: "1234567890" };

// records the row inserted into places
function fakeSupabase() {
  const inserted: Record<string, unknown>[] = [];
  const from = () => {
    let row: Record<string, unknown> | null = null;
    const builder: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve({ data: row ? { id: "new", ...row } : null, error: null });
          }
          return (...args: unknown[]) => {
            if (prop === "insert") {
              row = args[0] as Record<string, unknown>;
              inserted.push(row);
            }
            return builder;
          };
        },
      }
    );
    return builder;
  };
  vi.mocked(createServerClient).mockReturnValue({ from } as never);
  return inserted;
}

async function addShareLink() {
  const { POST } = await import("@/app/api/places/add/route");
  return POST(
    new NextRequest("http://localhost/api/places/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: SHARE_LINK }),
    })
  );
}

beforeEach(() => {
  vi.mocked(fetchAllowed).mockResolvedValue({ response: new Response(null, { status: 200 }), finalUrl: EXPANDED });
  vi.mocked(geocodeAddress).mockResolvedValue(AT_ADDRESS);
  vi.mocked(enrichPlaceById).mockReset();
  vi.mocked(placeCid).mockImplementation(async (id) => CIDS[id] ?? null);
  // the nearest match for "Shiba", the town, is another shop
  const search = async (name: string) => (/Cafe Sakura/.test(name) ? CAFE : OTHER_SHOP);
  vi.mocked(enrichPlaceByCoords).mockImplementation(async (_lat, _lng, name) => search(name ?? ""));
  vi.mocked(enrichPlaceByName).mockImplementation(async (name) => search(name));
});

describe("POST /api/places/add from a share link", () => {
  it("searches by the shop's name, not the town in its address, and saves the linked place", async () => {
    const inserted = fakeSupabase();
    expect((await addShareLink()).status).toBe(200);
    expect(vi.mocked(enrichPlaceByCoords).mock.calls[0][2]).toBe("Cafe Sakura Shiba Branch");
    expect(inserted[0]).toMatchObject({ name: "カフェさくら 芝店", place_id: "ChIJcafe", enriched: true });
  });

  it("retries with the whole name and address when the first result is another place", async () => {
    vi.mocked(enrichPlaceByCoords).mockResolvedValue(OTHER_SHOP);
    vi.mocked(enrichPlaceByName).mockResolvedValue(CAFE);
    const inserted = fakeSupabase();
    await addShareLink();
    expect(vi.mocked(enrichPlaceByName).mock.calls[0][0]).toContain("2 Chome-5-1 Shiba");
    expect(inserted[0]).toMatchObject({ place_id: "ChIJcafe" });
  });

  it("saves the link's own name and position rather than another place", async () => {
    vi.mocked(enrichPlaceByCoords).mockResolvedValue(OTHER_SHOP);
    vi.mocked(enrichPlaceByName).mockResolvedValue(OTHER_SHOP);
    const inserted = fakeSupabase();
    expect((await addShareLink()).status).toBe(200);
    expect(inserted[0]).toMatchObject({
      name: "Cafe Sakura Shiba Branch",
      place_id: null,
      ...AT_ADDRESS,
      enriched: true, // so /api/enrich doesn't search by name and pick the other shop later
    });
  });
});
