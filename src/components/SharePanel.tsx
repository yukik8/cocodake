"use client";

import { useState } from "react";
import type { Place } from "@/types";

interface SharePanelProps {
  selectedPlaces: Place[];
  allVisiblePlaces: Place[];
  onClose: () => void;
}

export default function SharePanel({
  selectedPlaces,
  allVisiblePlaces,
  onClose,
}: SharePanelProps) {
  const [title, setTitle] = useState("");
  const [expiresIn, setExpiresIn] = useState(30);
  const [useVisible, setUseVisible] = useState(selectedPlaces.length === 0);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const targetPlaces = useVisible ? allVisiblePlaces : selectedPlaces;

  const handleCreate = async () => {
    if (targetPlaces.length === 0) return;
    setLoading(true);

    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_ids: targetPlaces.map((p) => p.id),
          title: title || undefined,
          expires_in_days: expiresIn,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "エラーが発生しました");
        return;
      }

      const url = `${window.location.origin}/share/${data.share.id}`;
      setShareUrl(url);
    } catch {
      alert("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold text-gray-900">
            共有リストを作成
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!shareUrl ? (
            <>
              {/* Which places */}
              {selectedPlaces.length > 0 && allVisiblePlaces.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">対象スポット</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setUseVisible(false)}
                      className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                        !useVisible
                          ? "bg-blue-50 border-blue-500 text-blue-700"
                          : "border-gray-200 text-gray-600"
                      }`}
                    >
                      選択中 ({selectedPlaces.length}件)
                    </button>
                    <button
                      onClick={() => setUseVisible(true)}
                      className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                        useVisible
                          ? "bg-blue-50 border-blue-500 text-blue-700"
                          : "border-gray-200 text-gray-600"
                      }`}
                    >
                      表示中 ({allVisiblePlaces.length}件)
                    </button>
                  </div>
                </div>
              )}

              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-700">
                  <span className="font-medium">{targetPlaces.length}件</span>
                  のスポットを共有
                </p>
                <div className="mt-2 max-h-24 overflow-y-auto">
                  {targetPlaces.slice(0, 5).map((p) => (
                    <p key={p.id} className="text-xs text-gray-500 truncate">
                      • {p.name}
                    </p>
                  ))}
                  {targetPlaces.length > 5 && (
                    <p className="text-xs text-gray-400">
                      ...他 {targetPlaces.length - 5}件
                    </p>
                  )}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="text-sm font-medium text-gray-700">
                  タイトル（任意）
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 渋谷のランチ候補"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Expiry */}
              <div>
                <label className="text-sm font-medium text-gray-700">
                  有効期限
                </label>
                <select
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(Number(e.target.value))}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={7}>7日間</option>
                  <option value={30}>30日間</option>
                  <option value={90}>90日間</option>
                  <option value={0}>無期限</option>
                </select>
              </div>

              <button
                onClick={handleCreate}
                disabled={loading || targetPlaces.length === 0}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "作成中..." : "共有URLを生成"}
              </button>
            </>
          ) : (
            /* Share URL result */
            <div className="space-y-4">
              <div className="flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mx-auto">
                <svg className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 12V22H4V12" />
                  <path d="M22 7H2v5h20V7z" />
                  <path d="M12 22V7" />
                  <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
                  <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
                </svg>
              </div>
              <p className="text-center text-sm text-gray-700 font-medium">
                共有リンクが生成されました
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700"
                />
                <button
                  onClick={handleCopy}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    copied
                      ? "bg-green-500 text-white"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {copied ? "コピー済" : "コピー"}
                </button>
              </div>

              <p className="text-xs text-gray-400 text-center">
                URLを知っている人なら誰でもログインなしで閲覧できます
                {expiresIn > 0 ? `（${expiresIn}日間有効）` : "（無期限）"}
              </p>

              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center py-2 text-sm text-blue-600 hover:underline"
              >
                プレビューを確認 →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
