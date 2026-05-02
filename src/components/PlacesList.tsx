"use client";

import { useState } from "react";
import type { Place } from "@/types";

interface PlacesListProps {
  places: Place[];
  selectedIds: Set<string>;
  visibleIds?: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onHover: (id: string | null) => void;
  onDelete: (id: string) => void;
  onFocusPlace?: (id: string) => void;
  filterToVisible?: boolean;
}

export default function PlacesList({
  places,
  selectedIds,
  visibleIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onHover,
  onDelete,
  onFocusPlace,
  filterToVisible = false,
}: PlacesListProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "rating" | "recent">("recent");

  const displayPlaces = places
    .filter((p) => {
      if (filterToVisible && visibleIds && !visibleIds.has(p.id)) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.name?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q) ||
        p.note?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div className="flex flex-col h-full">
      {/* Search & sort */}
      <div className="p-3 border-b border-gray-200 space-y-2">
        <input
          type="text"
          placeholder="店名・カテゴリで検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center justify-between gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
          >
            <option value="recent">追加順</option>
            <option value="name">名前順</option>
            <option value="rating">評価順</option>
          </select>
          <div className="flex gap-1 text-xs">
            <button
              onClick={onSelectAll}
              className="px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              全選択
            </button>
            <button
              onClick={onClearSelection}
              className="px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
            >
              解除
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          {displayPlaces.length}件表示
          {selectedIds.size > 0 && (
            <span className="ml-2 text-blue-600 font-medium">
              {selectedIds.size}件選択中
            </span>
          )}
        </p>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1">
        {displayPlaces.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {places.length === 0
              ? "まだスポットがありません"
              : "検索結果がありません"}
          </div>
        ) : (
          displayPlaces.map((place) => (
            <PlaceRow
              key={place.id}
              place={place}
              isSelected={selectedIds.has(place.id)}
              onToggle={() => onToggleSelect(place.id)}
              onHover={onHover}
              onDelete={() => onDelete(place.id)}
              onFocus={() => onFocusPlace?.(place.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PlaceRow({
  place,
  isSelected,
  onToggle,
  onHover,
  onDelete,
  onFocus,
}: {
  place: Place;
  isSelected: boolean;
  onToggle: () => void;
  onHover: (id: string | null) => void;
  onDelete: () => void;
  onFocus: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className={`flex items-start gap-3 px-3 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer group transition-colors ${
        isSelected ? "bg-blue-50 hover:bg-blue-50" : ""
      }`}
      onClick={onFocus}
      onMouseEnter={() => {
        onHover(place.id);
        setShowDelete(true);
      }}
      onMouseLeave={() => {
        onHover(null);
        setShowDelete(false);
      }}
    >
      {/* Checkbox — クリックで選択トグル（行クリックとは独立） */}
      <div
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${
          isSelected
            ? "bg-blue-500 border-blue-500"
            : "border-gray-300"
        }`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        {isSelected && (
          <svg
            className="w-3 h-3 text-white"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M2 6l3 3 5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Photo */}
      {place.photo_url ? (
        <img
          src={place.photo_url}
          alt={place.name || ""}
          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-300 text-xl">
          📍
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <a
          href={place.url || `https://www.google.com/maps?q=${place.lat},${place.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-medium text-gray-900 truncate hover:text-blue-600 hover:underline block"
        >
          {place.name || "名称不明"}
        </a>
        {place.category && (
          <p className="text-xs text-blue-600 truncate">{place.category}</p>
        )}
        {place.address && (
          <p className="text-xs text-gray-500 truncate mt-0.5">{place.address}</p>
        )}
        {place.note && (
          <p className="text-xs text-gray-400 truncate mt-0.5 italic">
            {place.note}
          </p>
        )}
        {place.rating != null && (
          <p className="text-xs text-yellow-600 mt-0.5">
            {"⭐".repeat(Math.round(place.rating))} {place.rating}
          </p>
        )}
      </div>

      {/* Delete button */}
      {showDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex-shrink-0 p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
          title="削除"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
