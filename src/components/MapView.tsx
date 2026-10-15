"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import type { Place, SharedPlace, BoundingBox } from "@/types";
import { inBounds, normalizeBounds, sameIdSet } from "@/lib/geo";

// The fields the map needs: the owner's places and a share's snapshot both have them
type MapPlace = SharedPlace;

interface MapViewProps {
  places: MapPlace[];
  selectedIds: ReadonlySet<string>;
  onSelectPlace: (place: MapPlace) => void;
  selectionMode: boolean;
  onBoundingBoxChange?: (bbox: BoundingBox | null) => void;
  onVisiblePlacesChange?: (ids: Set<string>) => void;
  highlightedId?: string | null;
  onPlaceAdded?: (place: Place) => void;
  focusedPlaceId?: string | null;
  onClearFocus?: () => void;
  readOnly?: boolean;
  // The map fits all places when this changes (first show, after an import) — not after
  // every single add or delete, which used to make the view jump.
  fitVersion?: number;
}

interface SearchResult {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
}

interface TapPreview {
  lat: number | null;
  lng: number | null;
  name: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  photo_url: string | null;
  place_id?: string | null;
  loading: boolean;
  saving: boolean;
}

interface MarkerEntry {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  placeId: string | null; // null for a cluster
}

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";
const CAROUSEL_MAX_DOTS = 20;
const TEXT_HALO = "-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff";

// Markers are built with DOM APIs and textContent: place names come from imported files
// and shared lists, so they must never be parsed as HTML (stored XSS before).
function createPlaceMarkerElement(place: MapPlace): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cursor-pointer";
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;";
  const label = document.createElement("div");
  label.style.cssText = `font-size:12px;font-weight:700;white-space:nowrap;margin-bottom:3px;letter-spacing:0.01em;text-shadow:${TEXT_HALO};`;
  label.textContent = place.name || "";
  const pin = document.createElement("div");
  pin.style.cssText =
    "border-radius:50% 50% 50% 0;width:14px;height:14px;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);";
  el.append(label, pin);
  return el;
}

function paintPlaceMarker(el: HTMLDivElement, isSelected: boolean, isHighlighted: boolean) {
  const [label, pin] = Array.from(el.children) as HTMLElement[];
  label.style.color = isSelected ? "#059669" : "#dc2626";
  pin.style.background = isSelected ? "#10B981" : isHighlighted ? "#F59E0B" : "#EF4444";
}

function createClusterElement(count: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cursor-pointer";
  const size = Math.min(20 + count * 2, 50);
  const bubble = document.createElement("div");
  bubble.style.cssText = `background:#3B82F6;color:white;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);`;
  bubble.textContent = String(count);
  el.append(bubble);
  return el;
}

function createPopupContent(place: MapPlace): HTMLDivElement {
  const box = document.createElement("div");
  box.style.cssText = "font-size:13px;line-height:1.4";
  const name = document.createElement("strong");
  name.textContent = place.name || "名称不明";
  box.append(name);
  if (place.category) {
    const category = document.createElement("span");
    category.style.color = "#666";
    category.textContent = place.category;
    box.append(document.createElement("br"), category);
  }
  if (place.rating) {
    box.append(document.createElement("br"), document.createTextNode(`⭐ ${place.rating}`));
  }
  return box;
}

function createTempMarkerElement(name: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;";
  const label = document.createElement("div");
  label.style.cssText =
    "color:#2563eb;font-size:13px;font-weight:800;white-space:nowrap;margin-bottom:3px;text-shadow:0 0 4px white,0 0 4px white,0 0 4px white,0 0 6px white,1px 1px 0 white,-1px -1px 0 white,1px -1px 0 white,-1px 1px 0 white;";
  label.textContent = name;
  const pin = document.createElement("div");
  pin.style.cssText =
    "width:14px;height:14px;background:#2563eb;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);";
  el.append(label, pin);
  return el;
}

export default function MapView({
  places,
  selectedIds,
  onSelectPlace,
  selectionMode,
  onBoundingBoxChange,
  onVisiblePlacesChange,
  highlightedId,
  onPlaceAdded,
  focusedPlaceId,
  onClearFocus,
  readOnly = false,
  fitVersion = 0,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const tempMarkerRef = useRef<maplibregl.Marker | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  // マーカーがクリックされたかを追跡（マップclickと区別）
  const markerClickedRef = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [bearing, setBearing] = useState(0);

  // カルーセル表示
  const [carouselOpen, setCarouselOpen] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // マップタップで追加
  const [tapPreview, setTapPreview] = useState<TapPreview | null>(null);

  // 検索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // The cluster index is built once per change of `places` — not on every pan, zoom,
  // hover or selection change as before.
  const index = useMemo(() => {
    const sc = new Supercluster<{ place: MapPlace }>({ radius: 60, maxZoom: 16, minPoints: 10 });
    sc.load(
      places.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { place: p },
      }))
    );
    return sc;
  }, [places]);

  // Keep the latest props in refs so the map event handlers (registered once) read them
  const indexRef = useRef(index);
  const placesRef = useRef(places);
  const selectedIdsRef = useRef(selectedIds);
  const highlightedIdRef = useRef(highlightedId ?? null);
  const onSelectPlaceRef = useRef(onSelectPlace);
  const onBoundingBoxChangeRef = useRef(onBoundingBoxChange);
  const onVisiblePlacesChangeRef = useRef(onVisiblePlacesChange);
  const selectionModeRef = useRef(selectionMode);
  const readOnlyRef = useRef(readOnly);
  const lastVisibleRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    indexRef.current = index;
    placesRef.current = places;
    selectedIdsRef.current = selectedIds;
    highlightedIdRef.current = highlightedId ?? null;
    onSelectPlaceRef.current = onSelectPlace;
    onBoundingBoxChangeRef.current = onBoundingBoxChange;
    onVisiblePlacesChangeRef.current = onVisiblePlacesChange;
    selectionModeRef.current = selectionMode;
    readOnlyRef.current = readOnly;
  });

  // focusedPlaceId が変わったらカルーセルを開いて該当カードへ
  // (state is adjusted during render; the effect below only scrolls and moves the map)
  const [prevFocusedId, setPrevFocusedId] = useState(focusedPlaceId);
  if (focusedPlaceId !== prevFocusedId) {
    setPrevFocusedId(focusedPlaceId);
    const i = focusedPlaceId ? places.findIndex((p) => p.id === focusedPlaceId) : -1;
    if (i !== -1) {
      setCarouselOpen(true);
      setCarouselIndex(i);
      setTapPreview(null);
    }
  }
  useEffect(() => {
    if (!focusedPlaceId) return;
    const i = places.findIndex((p) => p.id === focusedPlaceId);
    if (i === -1) return;
    // カルーセルが描画された後にスクロール
    requestAnimationFrame(() => {
      const container = carouselRef.current;
      if (!container) return;
      const card = container.children[i] as HTMLElement | undefined;
      card?.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
    });
    const map = mapRef.current;
    const place = places[i];
    if (map && place) {
      map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
    }
  }, [focusedPlaceId, places]);

  // スワイプ後にどのカードが中央にいるかを検出してマップを追従
  const handleCarouselScroll = useCallback(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const container = carouselRef.current;
      if (!container) return;
      const cardWidth = (container.children[0] as HTMLElement)?.offsetWidth ?? container.offsetWidth;
      const i = Math.round(container.scrollLeft / (cardWidth + 12)); // 12 = gap
      const place = placesRef.current[i];
      if (!place) return;
      setCarouselIndex(i);
      mapRef.current?.flyTo({
        center: [place.lng, place.lat],
        zoom: Math.max(mapRef.current.getZoom(), 14),
        duration: 400,
      });
    }, 100);
  }, []);

  // タッププレビューの一時ピン
  useEffect(() => {
    const map = mapRef.current;
    tempMarkerRef.current?.remove();
    tempMarkerRef.current = null;
    if (!map || !tapPreview || tapPreview.lat == null || tapPreview.lng == null) return;

    const marker = new maplibregl.Marker({ element: createTempMarkerElement(tapPreview.name || "..."), anchor: "bottom" })
      .setLngLat([tapPreview.lng, tapPreview.lat])
      .addTo(map);
    tempMarkerRef.current = marker;

    return () => {
      marker.remove();
      tempMarkerRef.current = null;
    };
  }, [tapPreview?.lat, tapPreview?.lng, tapPreview?.name]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Report the places inside the view — only when the set actually changed, so panning
  // doesn't re-render the whole page and list each time.
  const updateVisiblePlaces = useCallback(() => {
    const map = mapRef.current;
    if (!map || !onVisiblePlacesChangeRef.current) return;
    const b = map.getBounds();
    const bbox = normalizeBounds(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
    const visible = new Set<string>();
    for (const p of placesRef.current) if (inBounds(p, bbox)) visible.add(p.id);
    if (lastVisibleRef.current && sameIdSet(lastVisibleRef.current, visible)) return;
    lastVisibleRef.current = visible;
    onVisiblePlacesChangeRef.current(visible);
  }, []);

  // Sync markers with the clusters in view: markers that stay in view are kept as they
  // are, only the ones that appear or disappear are added or removed.
  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const sc = indexRef.current;
    const b = map.getBounds();
    const clusters = sc.getClusters([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], Math.floor(map.getZoom()));

    const markers = markersRef.current;
    const keep = new Set<string>();
    for (const cluster of clusters) {
      const [lng, lat] = cluster.geometry.coordinates;
      const props = cluster.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; place?: MapPlace };
      const key = props.cluster ? `c:${props.cluster_id}` : `p:${props.place!.id}`;
      keep.add(key);
      if (markers.has(key)) continue;

      if (props.cluster) {
        const el = createClusterElement(props.point_count ?? 0);
        const clusterId = props.cluster_id!;
        el.addEventListener("click", (e) => {
          markerClickedRef.current = true;
          e.stopPropagation();
          const newZoom = indexRef.current.getClusterExpansionZoom(clusterId);
          map.flyTo({ center: [lng, lat], zoom: newZoom });
        });
        const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
        markers.set(key, { marker, el, placeId: null });
      } else {
        const place = props.place!;
        const el = createPlaceMarkerElement(place);
        paintPlaceMarker(el, selectedIdsRef.current.has(place.id), place.id === highlightedIdRef.current);
        el.addEventListener("click", (e) => {
          // マップのclickイベントが後から発火しないようにフラグを立てる
          markerClickedRef.current = true;
          onSelectPlaceRef.current(place);
          e.stopPropagation();
        });
        const popup = new maplibregl.Popup({ offset: 25, closeButton: false, maxWidth: "200px" }).setDOMContent(
          createPopupContent(place)
        );
        const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).setPopup(popup).addTo(map);
        markers.set(key, { marker, el, placeId: place.id });
      }
    }
    for (const [key, entry] of markers) {
      if (!keep.has(key)) {
        entry.marker.remove();
        markers.delete(key);
      }
    }

    updateVisiblePlaces();
  }, [updateVisiblePlaces]);

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

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    map.on("rotate", () => setBearing(map.getBearing()));
    map.on("load", renderMarkers);
    map.on("moveend", renderMarkers);

    mapRef.current = map;
    const markers = markersRef.current;

    // マップクリックで場所追加
    let abortCtrl: AbortController | null = null;
    let tapping = false; // 処理中は多重発火を防ぐ
    map.on("click", (e) => {
      if (readOnlyRef.current) return;
      if (selectionModeRef.current) return;
      if (markerClickedRef.current) { markerClickedRef.current = false; return; }
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
          setTapPreview((prev) => prev ? {
            ...prev,
            name: data.name || poiName,
            address: data.address ?? null,
            category: data.category ?? null,
            rating: data.rating ?? null,
            photo_url: data.photo_url ?? null,
            place_id: data.place_id ?? null,
            // the matched place's own position when the server found one nearby
            lat: typeof data.lat === "number" ? data.lat : prev.lat,
            lng: typeof data.lng === "number" ? data.lng : prev.lng,
            loading: false,
          } : null);
        })
        .catch((err) => {
          if (err.name !== "AbortError") setTapPreview(null);
        })
        .finally(() => { tapping = false; });
    });

    return () => {
      abortCtrl?.abort();
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [renderMarkers]);

  // A new set of places means a new cluster index: rebuild the markers once
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const entry of markersRef.current.values()) entry.marker.remove();
    markersRef.current.clear();
    lastVisibleRef.current = null;
    if (map.isStyleLoaded()) renderMarkers();
  }, [index, renderMarkers]);

  // Selection and hover only recolour the markers already on the map
  useEffect(() => {
    for (const entry of markersRef.current.values()) {
      if (entry.placeId) paintPlaceMarker(entry.el, selectedIds.has(entry.placeId), entry.placeId === highlightedId);
    }
  }, [selectedIds, highlightedId]);

  // Fit to all places on first show and whenever fitVersion changes
  const lastFitRef = useRef<number | null>(null);
  const hasPlaces = places.length > 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasPlaces || lastFitRef.current === fitVersion) return;
    lastFitRef.current = fitVersion;

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const p of placesRef.current) {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
    map.fitBounds(new maplibregl.LngLatBounds([minLng, minLat], [maxLng, maxLat]), { padding: 80, maxZoom: 14, duration: 800 });
  }, [fitVersion, hasPlaces]);

  // 検索 — 500msデバウンス
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = useCallback((q: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim()) { setSearchResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const map = mapRef.current;
        const center = map?.getCenter();
        const locParam = center ? `&lat=${center.lat}&lng=${center.lng}` : "";
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${locParam}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      } finally {
        setSearchLoading(false);
      }
    }, 500);
  }, []);

  const handleSearchSelect = useCallback((result: SearchResult) => {
    const map = mapRef.current;
    if (!map) return;
    if (result.lat != null && result.lng != null) {
      map.flyTo({ center: [result.lng, result.lat], zoom: 16, duration: 500 });
    }
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
      place_id: result.place_id,
      loading: true,
      saving: false,
    });
    // Google の候補は place_id で座標・写真・評価・カテゴリを取得（候補には座標がない）。
    // それ以外（MapTiler / Nominatim）は座標と名前でプレビュー
    const previewUrl = result.place_id
      ? `/api/places/add?place_id=${encodeURIComponent(result.place_id)}`
      : `/api/places/add?lat=${result.lat}&lng=${result.lng}&name=${encodeURIComponent(result.name)}`;
    fetch(previewUrl)
      .then((r) => r.json())
      .then((data) => {
        const lat = typeof data.lat === "number" ? data.lat : result.lat;
        const lng = typeof data.lng === "number" ? data.lng : result.lng;
        if (lat == null || lng == null) {
          setTapPreview(null);
          return;
        }
        if (result.lat == null || result.lng == null) {
          mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 500 });
        }
        setTapPreview((prev) => prev ? {
          ...prev,
          name: data.name || prev.name,
          address: data.address || prev.address,
          category: data.category ?? prev.category,
          rating: data.rating ?? prev.rating,
          photo_url: data.photo_url ?? prev.photo_url,
          place_id: data.place_id ?? prev.place_id,
          lat,
          lng,
          loading: false,
        } : null);
      })
      .catch(() => {
        setTapPreview((prev) => prev && prev.lat != null ? { ...prev, loading: false } : null);
      });
  }, []);

  // タップ追加を確定する
  const handleTapSave = useCallback(async () => {
    if (!tapPreview || tapPreview.lat == null || tapPreview.lng == null || readOnly) return;
    setTapPreview((p) => p ? { ...p, saving: true } : null);
    try {
      const body: Record<string, unknown> = {
        lat: tapPreview.lat,
        lng: tapPreview.lng,
      };
      // プレビューで place_id が取れていれば全情報を渡してサーバー側の再検索を省略
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
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // 重複
        alert("このスポットはすでにリストに追加されています");
      } else if (!res.ok) {
        alert(data.error || "追加に失敗しました");
      } else if (data.place) {
        // 保存したスポットだけを足す（全件を読み直さない）
        onPlaceAdded?.(data.place);
      }
      setTapPreview(null);
    } catch {
      setTapPreview(null);
    }
  }, [tapPreview, readOnly, onPlaceAdded]);

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

      const bbox = normalizeBounds(sw.lng, sw.lat, ne.lng, ne.lat);

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

      {/* コンパスボタン */}
      {Math.abs(bearing) > 1 && (
        <button
          onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 300 })}
          className="absolute top-3 right-3 z-10 w-10 h-10 bg-white rounded-xl shadow-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
          title="北向きに戻す"
        >
          <svg
            width="22" height="22" viewBox="0 0 24 24"
            style={{ transform: `rotate(${-bearing}deg)`, transition: 'transform 0.1s' }}
          >
            <polygon points="12,3 15,12 12,10 9,12" fill="#dc2626" />
            <polygon points="12,21 15,12 12,14 9,12" fill="#9ca3af" />
          </svg>
        </button>
      )}

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
                  // eslint-disable-next-line @next/next/no-img-element -- photos come from our /api/photo redirect
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

      {/* スポットカルーセル */}
      {carouselOpen && !tapPreview && places.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-20 pb-4 pt-2">
          {/* 閉じるボタン */}
          <div className="flex justify-end px-4 mb-1">
            <button
              onClick={() => { setCarouselOpen(false); onClearFocus?.(); }}
              className="text-xs text-gray-400 hover:text-gray-600 bg-white/80 backdrop-blur-sm rounded-full px-3 py-1 shadow"
            >
              閉じる
            </button>
          </div>
          {/* インジケーター（件数が多いときは「n / 全体」） */}
          {places.length > 1 && places.length <= CAROUSEL_MAX_DOTS && (
            <div className="flex justify-center gap-1 mb-2">
              {places.map((_, i) => (
                <div
                  key={i}
                  className={`rounded-full transition-all duration-200 ${i === carouselIndex ? "w-4 h-1.5 bg-blue-500" : "w-1.5 h-1.5 bg-gray-300"}`}
                />
              ))}
            </div>
          )}
          {places.length > CAROUSEL_MAX_DOTS && (
            <div className="flex justify-center mb-2">
              <span className="text-xs text-gray-500 bg-white/80 rounded-full px-2 py-0.5 shadow">
                {carouselIndex + 1} / {places.length}
              </span>
            </div>
          )}
          {/* カード列 — 画面外のカードは描画を省く（content-visibility）、写真は近づいてから読む */}
          <div
            ref={carouselRef}
            onScroll={handleCarouselScroll}
            className="flex gap-3 overflow-x-scroll px-4 snap-x snap-mandatory scrollbar-none"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {places.map((place) => (
              <div
                key={place.id}
                className="flex-shrink-0 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden snap-center"
                style={{ contentVisibility: "auto", containIntrinsicSize: "288px 128px" }}
              >
                <div className="flex gap-3 p-4">
                  {place.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- photos come from our /api/photo redirect
                    <img src={place.photo_url} loading="lazy" decoding="async" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" alt="" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">📍</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{place.name || "名称不明"}</p>
                    {place.category && (
                      <span className="text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 inline-block mt-0.5">{place.category}</span>
                    )}
                    {place.address && (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{place.address}</p>
                    )}
                    {place.rating != null && (
                      <p className="text-xs text-yellow-600 mt-0.5">⭐ {place.rating}</p>
                    )}
                  </div>
                </div>
                <div className="flex border-t border-gray-100">
                  <a
                    href={place.url || `https://www.google.com/maps?q=${place.lat},${place.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 text-xs text-center text-blue-600 hover:bg-blue-50 font-medium"
                  >
                    Google Mapで開く
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
