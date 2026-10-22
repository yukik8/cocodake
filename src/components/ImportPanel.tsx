"use client";

import { useState, useCallback } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import type { Place } from "@/types";
import { importResultMessage, notFoundPlaces } from "@/lib/importResult";
import { IMPORT_FILE_ERRORS, checkImportFileName } from "@/lib/importFileCheck";

interface ImportPanelProps {
  // place: the single spot added from a URL; absent after a file import (reload the list)
  onImportComplete: (result: { place?: Place }) => void;
}

export default function ImportPanel({
  onImportComplete,
}: ImportPanelProps) {
  const [mode, setMode] = useState<"file" | "url">("file");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "info" when nothing new was added (every place a duplicate, etc.): neither success green nor error red
  const [success, setSuccess] = useState<{
    text: string;
    tone: "success" | "info";
    notFound?: ReturnType<typeof notFoundPlaces>;
  } | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  // File upload
  const onDrop = useCallback(
    async (acceptedFiles: File[], rejections: FileRejection[]) => {
      // A file the drop zone turned away (a zip, an image…) used to do nothing at all; say why,
      // and check the size and type before uploading
      const file = acceptedFiles[0] ?? rejections[0]?.file;
      if (!file) return;
      setSuccess(null);
      const tooMany = rejections.some((r) => r.errors.some((e) => e.code === "too-many-files"));
      const problem = tooMany
        ? IMPORT_FILE_ERRORS.tooMany
        : (checkImportFileName(file.name, file.size) ?? (acceptedFiles[0] ? null : IMPORT_FILE_ERRORS.unsupported));
      if (problem) {
        setError(problem);
        return;
      }
      setLoading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "X-Stream": "true" },
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "インポートに失敗しました");
          return;
        }
        if (!res.body) throw new Error("no response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === "progress") {
              if (event.phase === "parsing") setProgressMsg("ファイルを解析中...");
              else if (event.phase === "geocoding") setProgressMsg(`座標を取得中... (${event.current} / ${event.total}件)`);
              else if (event.phase === "saving") setProgressMsg("データを保存中...");
            } else if (event.type === "done") {
              setProgressMsg(null);
              setSuccess({
                text: importResultMessage(event),
                tone: event.imported > 0 ? "success" : "info",
                notFound: notFoundPlaces(event),
              });
              onImportComplete({});
              fetch("/api/enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ limit: 50 }),
              }).catch(() => {});
            } else if (event.type === "error") {
              setProgressMsg(null);
              setError(event.message || "インポートに失敗しました");
            }
          }
        }
      } catch {
        setError("通信エラーが発生しました");
      } finally {
        setProgressMsg(null);
        setLoading(false);
      }
    },
    [onImportComplete]
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
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "追加に失敗しました");
        return;
      }

      setSuccess({ text: `「${data.place.name}」を追加しました`, tone: "success" });
      setUrl("");
      onImportComplete({ place: data.place });
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
                <p className="text-sm text-gray-500">{progressMsg ?? "インポート中..."}</p>
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

          {loading && progressMsg && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              {progressMsg}
            </div>
          )}

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
              <li>「すべて選択を解除」→「Saved（保存済み）」にチェック</li>
              <li>エクスポート実行 → メールリンクからDL</li>
              <li>解凍して「行ってみたい.csv」などをここにアップロード</li>
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
        <div
          className={`p-3 border rounded-lg text-sm ${
            success.tone === "success"
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-gray-50 border-gray-200 text-gray-700"
          }`}
        >
          {success.text}
        </div>
      )}
      {success?.notFound && success.notFound.places.length > 0 && (
        <div className="p-3 border border-gray-200 rounded-lg text-sm text-gray-700">
          <p className="font-medium">見つからなかったスポット</p>
          <p className="mt-1 text-xs text-gray-500">
            Googleマップで開いて「共有」からリンクをコピーし、「URL直接追加」に貼ると追加できることがあります
          </p>
          <ul className="mt-2 space-y-1">
            {success.notFound.places.map((p, i) => (
              <li key={i}>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                    {p.name}
                  </a>
                ) : (
                  p.name
                )}
              </li>
            ))}
          </ul>
          {success.notFound.more > 0 && <p className="mt-1 text-xs text-gray-500">ほか {success.notFound.more}件</p>}
        </div>
      )}
    </div>
  );
}
