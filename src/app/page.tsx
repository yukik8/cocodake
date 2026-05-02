"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Place, BoundingBox } from "@/types";
import { useAuth } from "@/lib/useAuth";
import PlacesList from "@/components/PlacesList";
import ImportPanel from "@/components/ImportPanel";
import SharePanel from "@/components/SharePanel";
import AuthButton from "@/components/AuthButton";
import LoginScreen from "@/components/LoginScreen";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Tab = "map" | "list" | "import";

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const sessionId = user?.id ?? "";

  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [selectionMode, setSelectionMode] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [filterToVisible, setFilterToVisible] = useState(false);

  const loadPlaces = useCallback(async (session: string) => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/places?session=${session}`);
      const data = await res.json();
      if (data.places) setPlaces(data.places);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionId) loadPlaces(sessionId);
  }, [sessionId, loadPlaces]);

  const handleBoundingBoxChange = useCallback(
    (bbox: BoundingBox | null) => {
      if (!bbox) return;
      const inBox = places
        .filter(
          (p) =>
            p.lng >= bbox.minLng &&
            p.lng <= bbox.maxLng &&
            p.lat >= bbox.minLat &&
            p.lat <= bbox.maxLat
        )
        .map((p) => p.id);
      setSelectedIds(new Set(inBox));
      setSelectionMode(false);
    },
    [places]
  );

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const ids = filterToVisible
      ? places.filter((p) => visibleIds.has(p.id)).map((p) => p.id)
      : places.map((p) => p.id);
    setSelectedIds(new Set(ids));
  }, [places, filterToVisible, visibleIds]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await fetch("/api/places", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, session: sessionId }),
      });
      setPlaces((prev) => prev.filter((p) => p.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [sessionId]
  );

  const selectedPlaces = useMemo(
    () => places.filter((p) => selectedIds.has(p.id)),
    [places, selectedIds]
  );

  const visiblePlaces = useMemo(
    () => places.filter((p) => visibleIds.has(p.id)),
    [places, visibleIds]
  );

  const handleSelectVisible = useCallback(() => {
    setSelectedIds(new Set(visibleIds));
  }, [visibleIds]);

  // 認証ロード中
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 未ログイン
  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3 px-4 h-14">
          <span className="text-2xl">🗺️</span>
          <h1 className="text-lg font-bold text-gray-900">MapShare</h1>
          <span className="hidden sm:block text-xs text-gray-400">
            Googleマップのリストをエリア切り取りしてシェア
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSelectionMode(!selectionMode)}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                selectionMode
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              ✂️ エリア選択
            </button>

            <button
              onClick={handleSelectVisible}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              表示中を選択
            </button>

            <button
              onClick={() => setShowShare(true)}
              disabled={selectedIds.size === 0 && visibleIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              🔗{" "}
              {selectedIds.size > 0
                ? `${selectedIds.size}件をシェア`
                : "シェア"}
            </button>

            <div className="hidden sm:block border-l border-gray-200 h-6 mx-1" />
            <AuthButton />
          </div>
        </div>

        {places.length > 0 && (
          <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-50 text-xs text-gray-500 border-t border-gray-100">
            <span>合計 {places.length}件</span>
            <span>表示中 {visibleIds.size}件</span>
            {selectedIds.size > 0 && (
              <>
                <span className="text-blue-600 font-medium">
                  選択中 {selectedIds.size}件
                </span>
                <button
                  onClick={handleClearSelection}
                  className="text-gray-400 hover:text-gray-600"
                >
                  選択解除
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {/* Mobile tabs */}
      <div className="sm:hidden flex border-b border-gray-200 bg-white">
        {(["map", "list", "import"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500"
            }`}
          >
            {tab === "map" ? "マップ" : tab === "list" ? "リスト" : "追加"}
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden sm:flex flex-col w-80 bg-white border-r border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200">
            {(["list", "import"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab === "list" ? "リスト" : "追加・インポート"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab !== "import" ? (
              <PlacesList
                places={places}
                selectedIds={selectedIds}
                visibleIds={visibleIds}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                onClearSelection={handleClearSelection}
                onHover={setHighlightedId}
                onDelete={handleDelete}
                onFocusPlace={(id) => { setFocusedPlaceId(id); setActiveTab("map"); }}
                filterToVisible={filterToVisible}
              />
            ) : (
              <ImportPanel
                sessionId={sessionId}
                onImportComplete={() => loadPlaces(sessionId)}
              />
            )}
          </div>

          {activeTab !== "import" && places.length > 0 && (
            <div className="p-3 border-t border-gray-100">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterToVisible}
                  onChange={(e) => setFilterToVisible(e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-gray-600">
                  地図の表示範囲のみ表示
                </span>
              </label>
            </div>
          )}
        </aside>

        {/* Map */}
        <main
          className={`flex-1 ${activeTab !== "map" ? "hidden sm:block" : ""}`}
        >
          {loading && places.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-sm text-gray-400">読み込み中...</p>
              </div>
            </div>
          ) : places.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center px-8">
                <div className="text-6xl mb-4">🗺️</div>
                <p className="text-lg font-medium text-gray-600 mb-2">
                  スポットがまだありません
                </p>
                <p className="text-sm text-gray-400 mb-4">
                  Google TakeoutファイルをインポートするかURLを追加してください
                </p>
                <button
                  onClick={() => setActiveTab("import")}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  スポットを追加する
                </button>
              </div>
            </div>
          ) : (
            <MapView
              places={places}
              selectedIds={selectedIds}
              onSelectPlace={(p) => handleToggleSelect(p.id)}
              selectionMode={selectionMode}
              onBoundingBoxChange={handleBoundingBoxChange}
              onVisiblePlacesChange={setVisibleIds}
              highlightedId={highlightedId}
              sessionId={sessionId}
              onPlaceAdded={() => loadPlaces(sessionId)}
              focusedPlaceId={focusedPlaceId}
              onClearFocus={() => setFocusedPlaceId(null)}
            />
          )}
        </main>

        {/* Mobile panels */}
        {activeTab === "list" && (
          <div className="sm:hidden flex-1 bg-white overflow-hidden flex flex-col">
            <PlacesList
              places={places}
              selectedIds={selectedIds}
              visibleIds={visibleIds}
              onToggleSelect={handleToggleSelect}
              onSelectAll={handleSelectAll}
              onClearSelection={handleClearSelection}
              onHover={setHighlightedId}
              onDelete={handleDelete}
              onFocusPlace={(id) => { setFocusedPlaceId(id); setActiveTab("map"); }}
            />
          </div>
        )}
        {activeTab === "import" && (
          <div className="sm:hidden flex-1 bg-white overflow-y-auto">
            <ImportPanel
              sessionId={sessionId}
              onImportComplete={() => loadPlaces(sessionId)}
            />
          </div>
        )}
      </div>

      {showShare && (
        <SharePanel
          selectedPlaces={selectedPlaces}
          allVisiblePlaces={visiblePlaces}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Mobile FAB */}
      <div className="sm:hidden fixed bottom-4 right-4 flex flex-col gap-2">
        {activeTab === "map" && (
          <>
            <button
              onClick={() => setSelectionMode(!selectionMode)}
              className={`p-3 rounded-full shadow-lg text-lg ${
                selectionMode ? "bg-blue-600 text-white" : "bg-white"
              }`}
            >
              ✂️
            </button>
            <button
              onClick={() => setShowShare(true)}
              disabled={selectedIds.size === 0 && visibleIds.size === 0}
              className="p-3 bg-green-600 text-white rounded-full shadow-lg text-lg disabled:opacity-40"
            >
              🔗
            </button>
          </>
        )}
      </div>
    </div>
  );
}
