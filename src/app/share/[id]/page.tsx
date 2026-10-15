import { Metadata } from "next";
import { getSharedList } from "@/lib/sharedList";
import SharedMapClient from "./SharedMapClient";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = await getSharedList(id);
  const share = result.status === "ok" ? result.share : null;

  const title = share?.title || "共有スポットリスト";
  const count = share?.places_snapshot.length ?? 0;

  return {
    title: `${title} - cocodake`,
    description: `${count}件のスポットが共有されています`,
  };
}

export default async function SharePage({ params }: Props) {
  const { id } = await params;
  const result = await getSharedList(id);

  if (result.status === "not_found") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center px-8">
          <div className="text-6xl mb-4">😕</div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            リストが見つかりません
          </h1>
          <p className="text-sm text-gray-500">
            URLが間違っているか、リストが削除された可能性があります。
          </p>
        </div>
      </div>
    );
  }

  if (result.status === "expired") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center px-8">
          <div className="text-6xl mb-4">⏰</div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            このリンクは期限切れです
          </h1>
          <p className="text-sm text-gray-500">
            共有リンクの有効期限が過ぎています。
          </p>
        </div>
      </div>
    );
  }

  return <SharedMapClient share={result.share} />;
}
