"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";

interface ImportPanelProps {
  sessionId: string;
  onImportComplete: (count: number) => void;
}

export default function ImportPanel({
  sessionId,
  onImportComplete,
}: ImportPanelProps) {
  const [mode, setMode] = useState<"file" | "url">("file");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // File upload
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const file = acceptedFiles[0];
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("session", sessionId);

        const res = await fetch("/api/import", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "インポートに失敗しました");
          return;
        }

        setSuccess(`${data.imported}件のスポットをインポートしました`);
        onImportComplete(data.imported);

        // Trigger background enrichment
        fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: sessionId, limit: 50 }),
        }).catch(() => {});
      } catch {
        setError("通信エラーが発生しました");
      } finally {
        setLoading(false);
      }
    },
    [sessionId, onImportComplete]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/json": [".json"],
      "text/csv": [".csv"],
      "text/plain": [".txt"],
    },
    maxFiles: 1,
    disabled: loading,
  });

  // URL add
  const handleAddUrl = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/places/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), session: sessionId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "追加に失敗しました");
        return;
      }

      setSuccess(`「${data.place.name}」を追加しました`);
      setUrl("");
      onImportComplete(1);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Mode tabs */}
      <div className="flex rounded-lg overflow-hidden border border-gray-200">
        <button
          onClick={() => setMode("file")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mode === "file"
              ? "bg-blue-600 text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          Takeoutファイル
        </button>
        <button
          onClick={() => setMode("url")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mode === "url"
              ? "bg-blue-600 text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          URL直接追加
        </button>
      </div>

      {/* File upload */}
      {mode === "file" && (
        <div className="space-y-3">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? "border-blue-500 bg-blue-50"
                : loading
                ? "border-gray-200 bg-gray-50 cursor-not-allowed"
                : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
            }`}
          >
            <input {...getInputProps()} />
            {loading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500">インポート中...</p>
              </div>
            ) : (
              <>
                <div className="text-4xl mb-3">📂</div>
                <p className="text-sm font-medium text-gray-700">
                  {isDragActive
                    ? "ドロップしてください"
                    : "ファイルをドロップ or クリックして選択"}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  JSON / CSV（Google Takeout形式）
                </p>
              </>
            )}
          </div>

          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700">
              Google Takeoutの使い方
            </summary>
            <ol className="mt-2 ml-4 space-y-1 list-decimal">
              <li>
                <a
                  href="https://takeout.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 underline"
                >
                  takeout.google.com
                </a>{" "}
                を開く
              </li>
              <li>「Googleマップ」のみ選択</li>
              <li>「保存済みの場所」にチェック</li>
              <li>エクスポート実行 → メールリンクからDL</li>
              <li>解凍して「保存済みの場所.json」をここにアップロード</li>
            </ol>
          </details>
        </div>
      )}

      {/* URL input */}
      {mode === "url" && (
        <div className="space-y-3">
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`GoogleマップまたはTabelog（食べログ）のURLを貼り付け\n例: https://maps.app.goo.gl/xxx\n例: https://www.google.com/maps/place/...\n例: https://tabelog.com/tokyo/.../13123456/`}
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            disabled={loading}
          />
          <button
            onClick={handleAddUrl}
            disabled={!url.trim() || loading}
            className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "追加中..." : "追加"}
          </button>
        </div>
      )}

      {/* Status messages */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {success}
        </div>
      )}
    </div>
  );
}
