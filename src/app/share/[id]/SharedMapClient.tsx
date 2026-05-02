"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { SharedList, Place } from "@/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

interface Props {
  share: SharedList;
}

export default function SharedMapClient({ share }: Props) {
  const places = share.places_snapshot as Place[];
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"map" | "list">("map");

  const handleFocusPlace = (id: string) => {
    setFocusedPlaceId(id);
    setActiveTab("map");
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3 px-4 h-14">
          <span className="text-2xl">🗺️</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">
              {share.title || "共有スポットリスト"}
            </h1>
            <p className="text-xs text-gray-400">
              {places.length}件のスポット
              {share.expires_at && (
                <span>
                  {" "}・{new Date(share.expires_at).toLocaleDateString("ja-JP")}まで有効
                </span>
              )}
            </p>
          </div>
          <button
            onClick={handleCopyUrl}
            className="flex-shrink-0 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            URLをコピー
          </button>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="sm:hidden flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setActiveTab("map")}
          className={`flex-1 py-2.5 text-sm font-medium ${
            activeTab === "map"
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-gray-500"
          }`}
        >
          マップ
        </button>
        <button
          onClick={() => setActiveTab("list")}
          className={`flex-1 py-2.5 text-sm font-medium ${
            activeTab === "list"
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-gray-500"
          }`}
        >
          リスト
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* List panel */}
        <aside className="hidden sm:block w-80 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-3 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500">
              {places.length}件のスポット
            </p>
          </div>
          {places.map((place) => (
            <SharedPlaceRow
              key={place.id}
              place={place}
              isHighlighted={place.id === highlightedId}
              onHover={setHighlightedId}
              onFocus={handleFocusPlace}
            />
          ))}
        </aside>

        {/* Map */}
        <main className={`flex-1 ${activeTab !== "map" ? "hidden sm:block" : ""}`}>
          <MapView
            places={places}
            selectedIds={new Set()}
            onSelectPlace={() => {}}
            selectionMode={false}
            highlightedId={highlightedId}
            focusedPlaceId={focusedPlaceId}
            onClearFocus={() => setFocusedPlaceId(null)}
            readOnly
          />
        </main>

        {/* Mobile list */}
        {activeTab === "list" && (
          <div className="sm:hidden flex-1 bg-white overflow-y-auto">
            {places.map((place) => (
              <SharedPlaceRow
                key={place.id}
                place={place}
                isHighlighted={place.id === highlightedId}
                onHover={setHighlightedId}
                onFocus={handleFocusPlace}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SharedPlaceRow({
  place,
  isHighlighted,
  onHover,
  onFocus,
}: {
  place: Place;
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
  onFocus: (id: string) => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 px-3 py-3 border-b border-gray-100 transition-colors cursor-pointer ${
        isHighlighted ? "bg-yellow-50" : "hover:bg-gray-50"
      }`}
      onMouseEnter={() => onHover(place.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onFocus(place.id)}
    >
      {place.photo_url ? (
        <img
          src={place.photo_url}
          alt={place.name || ""}
          className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-2xl">
          📍
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">
          {place.name || "名称不明"}
        </p>
        {place.category && (
          <span className="inline-block text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 mt-0.5">
            {place.category}
          </span>
        )}
        {place.address && (
          <p className="text-xs text-gray-500 mt-1 truncate">{place.address}</p>
        )}
        {place.rating != null && (
          <p className="text-xs text-yellow-600 mt-0.5">⭐ {place.rating}</p>
        )}
        {place.note && (
          <p className="text-xs text-gray-400 mt-0.5 italic truncate">
            {place.note}
          </p>
        )}
        <a
          href={place.url || `https://www.google.com/maps?q=${place.lat},${place.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline mt-1 inline-block"
          onClick={(e) => e.stopPropagation()}
        >
          Googleマップで開く →
        </a>
      </div>
    </div>
  );
}
