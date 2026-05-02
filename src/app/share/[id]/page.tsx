import { Metadata } from "next";
import { createServerClient } from "@/lib/supabase";
import SharedMapClient from "./SharedMapClient";
import type { SharedList } from "@/types";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerClient();
  const { data } = await supabase
    .from("shared_lists")
    .select("title, places_snapshot")
    .eq("id", id)
    .single();

  const title = data?.title || "共有スポットリスト";
  const count = Array.isArray(data?.places_snapshot)
    ? data.places_snapshot.length
    : 0;

  return {
    title: `${title} - MapShare`,
    description: `${count}件のスポットが共有されています`,
  };
}

export default async function SharePage({ params }: Props) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("shared_lists")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
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

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
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

  return <SharedMapClient share={data as SharedList} />;
}
