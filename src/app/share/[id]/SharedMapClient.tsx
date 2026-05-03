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
  const [copied, setCopied] = useState(false);

  const handleFocusPlace = (id: string) => {
    setFocusedPlaceId(id);
    setActiveTab("map");
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3 px-4 h-14">
          <span className="text-xl font-bold text-gray-900 tracking-tight flex-1 truncate">
            {share.title || "cocodake"}
          </span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {places.length}件
            {share.expires_at && (
              <span>・{new Date(share.expires_at).toLocaleDateString("ja-JP")}まで</span>
            )}
          </span>
          <button
            onClick={handleCopyUrl}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2563eb] text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            {copied ? "コピーした" : "リンクをコピー"}
          </button>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="sm:hidden flex border-b border-gray-100 bg-white">
        {(["map", "list"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab
                ? "text-[#2563eb] border-b-2 border-[#2563eb]"
                : "text-gray-400"
            }`}
          >
            {tab === "map" ? (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
                  <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
                </svg>
                マップ
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
                リスト
              </>
            )}
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop list panel */}
        <aside className="hidden sm:block w-72 bg-white border-r border-gray-100 overflow-y-auto">
          <div className="px-4 py-2.5 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400">{places.length}件のスポット</p>
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
            onSelectPlace={(place) => setFocusedPlaceId(place.id)}
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
      className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
        isHighlighted ? "bg-blue-50" : "hover:bg-gray-50"
      }`}
      onMouseEnter={() => onHover(place.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onFocus(place.id)}
    >
      {place.photo_url ? (
        <img
          src={place.photo_url}
          alt={place.name || ""}
          className="w-13 h-13 rounded-xl object-cover flex-shrink-0"
          style={{ width: 52, height: 52 }}
        />
      ) : (
        <div className="flex-shrink-0 rounded-xl bg-gray-100 flex items-center justify-center" style={{ width: 52, height: 52 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">
          {place.name || "名称不明"}
        </p>
        {place.category && (
          <p className="text-xs text-[#2563eb] mt-0.5 truncate">{place.category}</p>
        )}
        {place.address && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{place.address}</p>
        )}
        {place.rating != null && (
          <div className="flex items-center gap-1 mt-0.5">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#d97706" stroke="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span className="text-xs text-amber-600">{place.rating}</span>
          </div>
        )}
      </div>

      <a
        href={place.url || `https://www.google.com/maps?q=${place.lat},${place.lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-[#2563eb] hover:bg-blue-50 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </a>
    </div>
  );
}
