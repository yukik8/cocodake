# MapShare

Googleマップの保存済みスポットから特定エリアを切り取ってシェアできるWebアプリ。

## セットアップ

### 1. Supabaseプロジェクトを作成

1. [supabase.com](https://supabase.com) でアカウント作成 → 新規プロジェクト作成
2. **SQL Editor** を開いて `supabase/schema.sql` の内容を実行
3. **Settings → API** から以下を取得:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. 環境変数を設定

```bash
cp .env.local.example .env.local
# .env.local を編集して値を入力
```

### 3. （オプション）Google Places API

店名・写真・評価の自動取得に使用。未設定でも基本機能は動作します。

1. [Google Cloud Console](https://console.cloud.google.com) → Places API を有効化
2. APIキーを取得 → `GOOGLE_PLACES_API_KEY` に設定

### 4. （オプション）MapTiler

より高品質な地図タイル（日本語対応）。未設定ではMapLibreデモタイルを使用。

1. [cloud.maptiler.com](https://cloud.maptiler.com) → 無料アカウント作成
2. APIキー → `NEXT_PUBLIC_MAPTILER_KEY` に設定

### 5. 起動

```bash
npm run dev
```

→ http://localhost:3000

---

## 使い方

### インポート
- **Google Takeout**: takeout.google.com → Googleマップ → 保存済みの場所 → DL → JSONをドロップ
- **URL直接追加**: GoogleマップのURLをペーストして追加

### エリア選択 & シェア
1. 「✂️ エリア選択」でドラッグ → 範囲内スポットが選択される
2. 「表示中を選択」で地図の表示範囲内スポットを一括選択
3. 「🔗 N件をシェア」→ URLを生成 → 友人に送る（ログイン不要）

---

## Getting Started (original)

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
