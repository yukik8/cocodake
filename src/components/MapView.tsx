"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import type { Place, BoundingBox } from "@/types";

interface MapViewProps {
  places: Place[];
  selectedIds: Set<string>;
  onSelectPlace: (place: Place) => void;
  selectionMode: boolean;
  onBoundingBoxChange?: (bbox: BoundingBox | null) => void;
  onVisiblePlacesChange?: (ids: Set<string>) => void;
  highlightedId?: string | null;
  sessionId?: string;
  onPlaceAdded?: () => void;
  focusedPlaceId?: string | null;
  onClearFocus?: () => void;
  readOnly?: boolean;
}

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";

export default function MapView({
  places,
  selectedIds,
  onSelectPlace,
  selectionMode,
  onBoundingBoxChange,
  onVisiblePlacesChange,
  highlightedId,
  sessionId,
  onPlaceAdded,
  focusedPlaceId,
  onClearFocus,
  readOnly = false,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const clusterRef = useRef<Supercluster | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const tempMarkerRef = useRef<maplibregl.Marker | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // リストから選択した場所のカード表示
  const [focusedPlace, setFocusedPlace] = useState<Place | null>(null);

  // focusedPlaceId が変わったらマップをフライして場所カードを表示
  useEffect(() => {
    if (!focusedPlaceId) { setFocusedPlace(null); return; }
    const place = places.find((p) => p.id === focusedPlaceId);
    if (!place) return;
    setFocusedPlace(place);
    setTapPreview(null); // タッププレビューは閉じる
    const map = mapRef.current;
    if (map) {
      map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 16), duration: 600 });
    }
  }, [focusedPlaceId, places]);

  // マップタップで追加
  const [tapPreview, setTapPreview] = useState<{
    lat: number; lng: number;
    name: string | null; address: string | null;
    category: string | null; rating: number | null; photo_url: string | null;
    place_id?: string | null;
    loading: boolean; saving: boolean;
  } | null>(null);

  // 検索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { id: string; name: string; address: string; lat: number; lng: number; place_id?: string }[]
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Keep callbacks in refs so they never appear in dependency arrays
  const onSelectPlaceRef = useRef(onSelectPlace);
  const onBoundingBoxChangeRef = useRef(onBoundingBoxChange);
  const onVisiblePlacesChangeRef = useRef(onVisiblePlacesChange);
  const selectionModeRef = useRef(selectionMode);
  useEffect(() => { onSelectPlaceRef.current = onSelectPlace; }, [onSelectPlace]);
  useEffect(() => { onBoundingBoxChangeRef.current = onBoundingBoxChange; }, [onBoundingBoxChange]);
  useEffect(() => { onVisiblePlacesChangeRef.current = onVisiblePlacesChange; }, [onVisiblePlacesChange]);
  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);

  // タッププレビューの一時ピン
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 前の一時ピンを削除
    tempMarkerRef.current?.remove();
    tempMarkerRef.current = null;

    if (!tapPreview) return;

    const el = document.createElement("div");
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="
          color:#2563eb;
          font-size:13px;
          font-weight:800;
          white-space:nowrap;
          margin-bottom:3px;
          text-shadow:
            0 0 4px white, 0 0 4px white, 0 0 4px white,
            0 0 6px white,
            1px 1px 0 white, -1px -1px 0 white,
            1px -1px 0 white, -1px 1px 0 white;
        ">${tapPreview.name || "..."}</div>
        <div style="
          width:14px;height:14px;
          background:#2563eb;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          border:2px solid white;
          box-shadow:0 2px 4px rgba(0,0,0,0.3);
        "></div>
      </div>
    `;

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([tapPreview.lng, tapPreview.lat])
      .addTo(map);
    tempMarkerRef.current = marker;

    return () => {
      marker.remove();
      tempMarkerRef.current = null;
    };
  }, [tapPreview]);

  // エリア選択中はマップのドラッグを無効化
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectionMode) {
      map.dragPan.disable();
      map.dragRotate.disable();
    } else {
      map.dragPan.enable();
      map.dragRotate.enable();
    }
  }, [selectionMode]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const styleUrl = MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
      : "https://demotiles.maplibre.org/style.json";

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [139.6917, 35.6895], // Tokyo default
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    mapRef.current = map;

    // マーカーがクリックされたかを追跡（マップclickと区別）
    let markerClicked = false;
    (map as maplibregl.Map & { _markerClicked?: () => void })._markerClicked = () => {
      markerClicked = true;
    };

    // マップクリックで場所追加
    let abortCtrl: AbortController | null = null;
    let tapping = false; // 処理中は多重発火を防ぐ
    map.on("click", (e) => {
      if (readOnly) return;
      if (selectionModeRef.current) return;
      if (markerClicked) { markerClicked = false; return; }
      if (tapping) return;
      tapping = true;

      // 前のリクエストをキャンセル
      abortCtrl?.abort();
      abortCtrl = new AbortController();
      const { lat, lng } = e.lngLat;

      // マップタイルからタップ地点の POI 名を取得
      const point = map.project([lng, lat]);
      const features = map.queryRenderedFeatures(point, {});
      const poiFeature = features.find(
        (f) => f.properties?.name && f.geometry.type === "Point"
      ) || features.find((f) => f.properties?.name);
      const poiName: string | null = poiFeature?.properties?.name || null;

      setTapPreview({ lat, lng, name: poiName, address: null, category: null, rating: null, photo_url: null, place_id: null, loading: true, saving: false });

      const apiUrl = poiName
        ? `/api/places/add?lat=${lat}&lng=${lng}&name=${encodeURIComponent(poiName)}`
        : `/api/places/add?lat=${lat}&lng=${lng}`;

      fetch(apiUrl, { signal: abortCtrl.signal })
        .then((r) => r.json())
        .then((data) => {
          if (data.place_id) {
            setTapPreview((prev) => prev ? {
              ...prev,
              name: data.name || poiName,
              address: data.address,
              category: data.category ?? null,
              rating: data.rating ?? null,
              photo_url: data.photo_url ?? null,
              place_id: data.place_id,
              loading: false,
            } : null);
          } else {
            // Google Places で見つからなかった（Nominatimフォールバック）
            setTapPreview((prev) => prev ? { ...prev, ...data, name: data.name || poiName, loading: false } : null);
          }
        })
        .catch((err) => {
          if (err.name !== "AbortError") setTapPreview(null);
        })
        .finally(() => { tapping = false; });
    });

    return () => {
      abortCtrl?.abort();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 検索（Nominatim）— 500msデバウンス
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = useCallback((q: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const map = mapRef.current;
        const center = map?.getCenter();
        const locParam = center ? `&lat=${center.lat}&lng=${center.lng}` : "";
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${locParam}`);
        const data = await res.json();
        setSearchResults(data);
      } catch {
        // ignore
      } finally {
        setSearchLoading(false);
      }
    }, 500);
  }, []);

  const handleSearchSelect = useCallback((result: { id: string; name: string; address: string; lat: number; lng: number }) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [result.lng, result.lat], zoom: 16, duration: 500 });
    setSearchResults([]);
    setSearchQuery("");
    // まず名前だけ表示してローディング状態に
    setTapPreview({
      lat: result.lat,
      lng: result.lng,
      name: result.name,
      address: result.address,
      category: null,
      rating: null,
      photo_url: null,
      place_id: result.id,
      loading: true,
      saving: false,
    });
    // place_idで写真・評価・カテゴリを取得
    fetch(`/api/places/add?place_id=${encodeURIComponent(result.id)}`)
      .then((r) => r.json())
      .then((data) => {
        setTapPreview((prev) => prev ? {
          ...prev,
          name: data.name || prev.name,
          address: data.address || prev.address,
          category: data.category ?? prev.category,
          rating: data.rating ?? prev.rating,
          photo_url: data.photo_url ?? prev.photo_url,
          lat: data.lat ?? prev.lat,
          lng: data.lng ?? prev.lng,
          loading: false,
        } : null);
      })
      .catch(() => {
        setTapPreview((prev) => prev ? { ...prev, loading: false } : null);
      });
  }, []);

  // タップ追加を確定する
  const handleTapSave = useCallback(async () => {
    if (!tapPreview || !sessionId) return;
    setTapPreview((p) => p ? { ...p, saving: true } : null);
    try {
      const body: Record<string, unknown> = {
        lat: tapPreview.lat,
        lng: tapPreview.lng,
        session: sessionId,
      };
      // 検索結果から追加の場合はplace_idと全情報を渡してサーバー側の再検索を省略
      if (tapPreview.place_id) {
        body.place_id = tapPreview.place_id;
        body.name = tapPreview.name;
        body.address = tapPreview.address;
        body.category = tapPreview.category;
        body.rating = tapPreview.rating;
        body.photo_url = tapPreview.photo_url;
      }
      const res = await fetch("/api/places/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        // 重複
        alert("このスポットはすでにリストに追加されています");
        setTapPreview(null);
        return;
      }
      setTapPreview(null);
      onPlaceAdded?.();
    } catch {
      setTapPreview(null);
    }
  }, [tapPreview, sessionId, onPlaceAdded]);

  // Compute visible places on map move — uses refs to avoid dependency churn
  const placesRef = useRef(places);
  useEffect(() => { placesRef.current = places; }, [places]);

  const updateVisiblePlaces = useCallback(() => {
    const map = mapRef.current;
    if (!map || !onVisiblePlacesChangeRef.current) return;

    const bounds = map.getBounds();
    const visible = new Set<string>();
    for (const p of placesRef.current) {
      if (
        p.lng >= bounds.getWest() &&
        p.lng <= bounds.getEast() &&
        p.lat >= bounds.getSouth() &&
        p.lat <= bounds.getNorth()
      ) {
        visible.add(p.id);
      }
    }
    onVisiblePlacesChangeRef.current(visible);
  }, []); // stable — no deps needed

  // Render markers with clustering
  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (places.length === 0) return;

    // Build supercluster
    const sc = new Supercluster({ radius: 60, maxZoom: 16 });
    sc.load(
      places.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { id: p.id, place: p },
      }))
    );
    clusterRef.current = sc;

    const zoom = Math.floor(map.getZoom());
    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    const clusters = sc.getClusters(bbox, zoom);

    for (const cluster of clusters) {
      const [lng, lat] = cluster.geometry.coordinates;
      const el = document.createElement("div");

      if (cluster.properties.cluster) {
        // Cluster marker
        const count = cluster.properties.point_count;
        el.className = "cursor-pointer";
        el.innerHTML = `
          <div style="
            background: #3B82F6;
            color: white;
            border-radius: 50%;
            width: ${Math.min(20 + count * 2, 50)}px;
            height: ${Math.min(20 + count * 2, 50)}px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            border: 2px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          ">${count}</div>
        `;

        el.addEventListener("click", () => {
          const newZoom = sc.getClusterExpansionZoom(
            cluster.properties.cluster_id
          );
          map.flyTo({ center: [lng, lat], zoom: newZoom });
        });

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
        markersRef.current.push(marker);
      } else {
        // Single place marker
        const place = cluster.properties.place as Place;
        const isSelected = selectedIds.has(place.id);
        const isHighlighted = place.id === highlightedId;

        const color = isSelected ? "#10B981" : isHighlighted ? "#F59E0B" : "#EF4444";
        const name = place.name || "";
        el.className = "cursor-pointer";
        el.style.cssText = "display:flex;flex-direction:column;align-items:center;";
        el.innerHTML = `
          <div style="
            color:${isSelected ? "#059669" : "#dc2626"};
            font-size:13px;
            font-weight:800;
            white-space:nowrap;
            margin-bottom:3px;
            letter-spacing:0.01em;
            background:rgba(255,255,255,0.85);
            padding:2px 5px;
            border-radius:4px;
            backdrop-filter:blur(2px);
          ">${name}</div>
          <div style="
            background:${color};
            border-radius:50% 50% 50% 0;
            width:14px;
            height:14px;
            transform:rotate(-45deg);
            border:2px solid white;
            box-shadow:0 2px 4px rgba(0,0,0,0.3);
          "></div>
        `;

        el.addEventListener("click", (e) => {
          // マップのclickイベントが後から発火しないようにフラグを立てる
          const m = mapRef.current as (maplibregl.Map & { _markerClicked?: () => void }) | null;
          m?._markerClicked?.();
          onSelectPlaceRef.current(place);
          e.stopPropagation();
        });

        const popup = new maplibregl.Popup({
          offset: 25,
          closeButton: false,
          maxWidth: "200px",
        }).setHTML(
          `<div style="font-size:13px;line-height:1.4">
            <strong>${place.name || "名称不明"}</strong>
            ${place.category ? `<br/><span style="color:#666">${place.category}</span>` : ""}
            ${place.rating ? `<br/>⭐ ${place.rating}` : ""}
          </div>`
        );

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);
      }
    }

    updateVisiblePlaces();
  }, [places, selectedIds, highlightedId, updateVisiblePlaces]);

  // Re-render markers when data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.isStyleLoaded()) {
      renderMarkers();
    } else {
      map.once("load", renderMarkers);
    }

    const onMoveEnd = () => {
      renderMarkers();
    };

    map.on("moveend", onMoveEnd);
    return () => {
      map.off("moveend", onMoveEnd);
    };
  }, [renderMarkers]);

  // Auto-fit to places
  useEffect(() => {
    const map = mapRef.current;
    if (!map || places.length === 0) return;

    const validPlaces = places.filter(
      (p) => p.lat != null && p.lng != null
    );
    if (validPlaces.length === 0) return;

    const lngs = validPlaces.map((p) => p.lng);
    const lats = validPlaces.map((p) => p.lat);

    const bounds = new maplibregl.LngLatBounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    );

    map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 800 });
  }, [places.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // highlightedId changes → just re-render markers with new color (no flyTo)
  useEffect(() => {
    if (mapRef.current?.isStyleLoaded()) renderMarkers();
  }, [highlightedId, renderMarkers]);

  // Bounding box drawing
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!selectionMode) return;
      drawStartRef.current = { x: e.clientX, y: e.clientY };
      setIsDrawing(true);

      if (!selectionBoxRef.current) {
        const box = document.createElement("div");
        box.style.cssText = `
          position: fixed;
          border: 2px dashed #3B82F6;
          background: rgba(59,130,246,0.1);
          pointer-events: none;
          z-index: 1000;
        `;
        document.body.appendChild(box);
        selectionBoxRef.current = box;
      }
    },
    [selectionMode]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing || !drawStartRef.current || !selectionBoxRef.current)
        return;

      const start = drawStartRef.current;
      const box = selectionBoxRef.current;

      const x = Math.min(start.x, e.clientX);
      const y = Math.min(start.y, e.clientY);
      const w = Math.abs(e.clientX - start.x);
      const h = Math.abs(e.clientY - start.y);

      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    },
    [isDrawing]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing || !drawStartRef.current || !mapRef.current) return;

      const map = mapRef.current;
      const container = mapContainer.current!;
      const rect = container.getBoundingClientRect();

      const start = drawStartRef.current;
      const end = { x: e.clientX, y: e.clientY };

      // Convert screen coords to map coords
      const sw = map.unproject([
        Math.min(start.x, end.x) - rect.left,
        Math.max(start.y, end.y) - rect.top,
      ]);
      const ne = map.unproject([
        Math.max(start.x, end.x) - rect.left,
        Math.min(start.y, end.y) - rect.top,
      ]);

      const bbox: BoundingBox = {
        minLng: sw.lng,
        minLat: sw.lat,
        maxLng: ne.lng,
        maxLat: ne.lat,
      };

      if (onBoundingBoxChangeRef.current) {
        const width = Math.abs(e.clientX - start.x);
        const height = Math.abs(e.clientY - start.y);
        onBoundingBoxChangeRef.current(width > 10 && height > 10 ? bbox : null);
      }

      // Cleanup
      if (selectionBoxRef.current) {
        selectionBoxRef.current.remove();
        selectionBoxRef.current = null;
      }
      drawStartRef.current = null;
      setIsDrawing(false);
    },
    [isDrawing]
  );

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapContainer}
        className="w-full h-full"
        style={{ cursor: selectionMode ? "crosshair" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />

      {/* 検索バー */}
      {!readOnly && !selectionMode && (
        <div className="absolute top-3 left-3 right-14 z-10 max-w-xs">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                handleSearch(e.target.value);
              }}
              placeholder="場所を検索..."
              className="w-full bg-white rounded-xl shadow-lg px-4 py-2.5 pr-8 text-sm outline-none border border-gray-200 focus:border-blue-400"
            />
            {searchLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            )}
            {searchQuery && !searchLoading && (
              <button
                onClick={() => { setSearchQuery(""); setSearchResults([]); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >✕</button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="mt-1 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleSearchSelect(r)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                >
                  <p className="font-medium text-gray-800 truncate">{r.name}</p>
                  <p className="text-xs text-gray-400 truncate">{r.address}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* エリア選択ヒント */}
      {selectionMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-sm px-4 py-2 rounded-full shadow-lg pointer-events-none z-10">
          ドラッグでエリアを選択
        </div>
      )}

      {/* タップ追加プレビュー */}
      {!readOnly && tapPreview && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
          {tapPreview.loading ? (
            <div className="flex items-center gap-3 p-4">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-sm text-gray-500">スポットを検索中...</p>
            </div>
          ) : (
            <>
              <div className="flex gap-3 p-4">
                {tapPreview.photo_url ? (
                  <img src={tapPreview.photo_url} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" alt="" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-2xl flex-shrink-0">📍</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">
                    {tapPreview.name || "名称不明"}
                  </p>
                  {tapPreview.category && (
                    <span className="text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">{tapPreview.category}</span>
                  )}
                  {tapPreview.address && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{tapPreview.address}</p>
                  )}
                  {tapPreview.rating != null && (
                    <p className="text-xs text-yellow-600 mt-0.5">⭐ {tapPreview.rating}</p>
                  )}
                </div>
              </div>
              <div className="flex border-t border-gray-100">
                <button
                  onClick={() => setTapPreview(null)}
                  className="flex-1 py-3 text-sm text-gray-500 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleTapSave}
                  disabled={tapPreview.saving}
                  className="flex-1 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 border-l border-gray-100 disabled:opacity-50"
                >
                  {tapPreview.saving ? "追加中..." : "リストに追加"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* リストから選択した場所のカード */}
      {focusedPlace && !tapPreview && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
          <div className="flex gap-3 p-4">
            {focusedPlace.photo_url ? (
              <img src={focusedPlace.photo_url} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" alt="" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-2xl flex-shrink-0">📍</div>
            )}
            <div className="flex-1 min-w-0">
              <a
                href={focusedPlace.url || `https://www.google.com/maps?q=${focusedPlace.lat},${focusedPlace.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-gray-900 text-sm hover:text-blue-600 hover:underline block"
              >
                {focusedPlace.name || "名称不明"}
              </a>
              {focusedPlace.category && (
                <span className="text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">{focusedPlace.category}</span>
              )}
              {focusedPlace.address && (
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{focusedPlace.address}</p>
              )}
              {focusedPlace.rating != null && (
                <p className="text-xs text-yellow-600 mt-0.5">⭐ {focusedPlace.rating}</p>
              )}
            </div>
          </div>
          <div className="flex border-t border-gray-100">
            <a
              href={focusedPlace.url || `https://www.google.com/maps?q=${focusedPlace.lat},${focusedPlace.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-3 text-sm text-center text-blue-600 hover:bg-blue-50 font-medium"
            >
              Google Mapで開く
            </a>
            <button
              onClick={() => { setFocusedPlace(null); onClearFocus?.(); }}
              className="flex-1 py-3 text-sm text-gray-500 hover:bg-gray-50 border-l border-gray-100"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
