import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllowed, isGoogleMapsHost, isTabelogHost } from "../safeFetch";

const u = (s: string) => new URL(s);

describe("host checks", () => {
  it.each([
    ["https://maps.app.goo.gl/abc", true],
    ["https://goo.gl/maps/abc", true],
    ["https://goo.gl/other", false],
    ["https://www.google.com/maps/place/x", true],
    ["https://www.google.co.jp/maps", true],
    ["https://evilgoogle.com/maps", false],
    ["https://google.com.evil.example/maps", false],
    ["http://169.254.169.254/latest/meta-data", false],
  ])("isGoogleMapsHost(%s) → %s", (url, expected) => {
    expect(isGoogleMapsHost(u(url))).toBe(expected);
  });

  it("isTabelogHost", () => {
    expect(isTabelogHost(u("https://tabelog.com/x"))).toBe(true);
    expect(isTabelogHost(u("https://s.tabelog.com/x"))).toBe(true);
    expect(isTabelogHost(u("https://tabelog.com.evil.example/x"))).toBe(false);
  });
});

describe("fetchAllowed", () => {
  afterEach(() => vi.unstubAllGlobals());

  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it("follows redirects while they stay on allowed hosts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/place/X/@1.0,2.0"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAllowed("https://maps.app.goo.gl/abc", isGoogleMapsHost);
    expect(result?.finalUrl).toBe("https://www.google.com/maps/place/X/@1.0,2.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("stops at a redirect to a host that is not allowed (no request is made to it)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("http://169.254.169.254/latest/meta-data"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchAllowed("https://maps.app.goo.gl/abc", isGoogleMapsHost)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never requests a disallowed or non-https start URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAllowed("https://localhost:3000/admin", isGoogleMapsHost)).toBeNull();
    expect(await fetchAllowed("http://www.google.com/maps", isGoogleMapsHost)).toBeNull();
    expect(await fetchAllowed("not a url", isGoogleMapsHost)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on a redirect loop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => redirect("https://maps.app.goo.gl/loop")));
    expect(await fetchAllowed("https://maps.app.goo.gl/loop", isGoogleMapsHost)).toBeNull();
  });
});
