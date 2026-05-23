*日本語は下に記載しています。*

# cocodake

> **Cocodake** — Crop any area from your saved spots and share just those places with friends.

When deciding where to go with friends, you could share your entire saved list — but there was no way to crop just "the spots around Shibuya" and send only those. Cocodake solves that.

**App Store**: [apps.apple.com/jp/app/cocodake/id6766069547](https://apps.apple.com/jp/app/cocodake/id6766069547)

---

## Features

- **Save spots** — Search for places and add them to your list with notes
- **Crop an area** — Drag to select a region on the map and extract only the spots within it
- **Share instantly** — Generate a time-limited share URL; recipients don't need to log in
- **Import** — Bulk import from Google Takeout JSON or Google Maps URLs (for onboarding)
- **Place enrichment** — Auto-fetch photos, ratings, addresses, and categories via Google Places API
- **Tabelog support** — Paste a Tabelog URL to automatically scrape its metadata
- **Mobile companion** — React Native iOS/Android app sharing the same backend; add spots directly from the OS share sheet

---

## Tech Stack

| | |
|---|---|
| Web | Next.js (App Router) · TypeScript · Tailwind CSS |
| Map | MapLibre GL · Supercluster (clustering) |
| DB | Supabase · PostgreSQL + PostGIS (spatial queries) |
| Native | React Native / Expo (iOS/Android) |
| Native Bridge | Custom Swift / Kotlin share extensions |

---

## Setup

### 1. Create a Supabase project

1. Create an account at [supabase.com](https://supabase.com) and start a new project
2. Open **SQL Editor** and run `supabase/schema.sql`
3. Go to **Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Set environment variables

```bash
cp .env.local.example .env.local
# Fill in the values
```

### 3. (Optional) Google Places API

Used for auto-fetching place metadata. Core features work without it.

1. Enable Places API in [Google Cloud Console](https://console.cloud.google.com)
2. Set the key as `GOOGLE_PLACES_API_KEY`

### 4. (Optional) MapTiler

Higher quality map tiles with Japanese labels. Falls back to MapLibre demo tiles if unset.

1. Create a free account at [cloud.maptiler.com](https://cloud.maptiler.com)
2. Set the key as `NEXT_PUBLIC_MAPTILER_KEY`

### 5. Run

```bash
npm install
npm run dev
```

→ http://localhost:3000

---

## Usage

### Adding spots

- **Search in-app**: Search for a place and save it to your list
- **Google Takeout**: takeout.google.com → Google Maps → Saved places → Download → drop the JSON
- **Direct URL**: Paste a Google Maps URL to add a spot

### Crop and share

1. Click **✂️ Select area** and drag to select a region — spots within it are highlighted
2. Or click **Select visible** to select all spots in the current map view
3. Click **🔗 Share N spots** → copy the URL → send to friends (no login required, link expires)

---

---
---

# cocodake（日本語）

> **ここだけ** — 自分が保存したスポットから、行きたいエリアだけを切り取って友達に送れるアプリ。

友達とどこに行くか決めるとき、保存したスポット全体は送れても、
「渋谷周辺だけ」「このエリアのここだけ」とピンポイントで切り取って送る方法がなかった。
cocodakeはその問題を解決する。

---

## 機能

- **スポット保存** — 場所を検索して自分のリストに追加、メモや編集も可能
- **エリア切り取り** — 地図上をドラッグして範囲を選択、その中にあるスポットだけを抽出
- **表示範囲選択** — 現在の地図の表示範囲内スポットをワンタップで一括選択
- **ワンタップシェア** — 期限付き共有URLを生成、受け取り側はログイン不要
- **インポート** — Google Takeout JSONまたはGoogle Maps URLからスポットを一括取り込み（初期セットアップ用）
- **スポット補完** — Google Places APIで写真・評価・住所・カテゴリを自動取得
- **Tabelogサポート** — TabelogのURLを貼るとメタデータを自動スクレイピング
- **モバイルアプリ連携** — React Nativeアプリ（iOS/Android）と同一バックエンドを共有、OSのシェアシートから直接追加可能

---

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
npm install
npm run dev
```

→ http://localhost:3000

---

## 使い方

### スポットを追加する

- **アプリ内で検索して追加**: 場所を検索してリストに保存
- **Google Takeout**: takeout.google.com → Googleマップ → 保存済みの場所 → ダウンロード → JSONをドロップ
- **URL直接追加**: GoogleマップのURLをペーストして追加

### 切り取って送る

1. 「✂️ エリア選択」でドラッグ → 範囲内スポットが選択される
2. 「表示中を選択」で地図の表示範囲内スポットを一括選択
3. 「🔗 N件をシェア」→ URLを生成 → 友人に送る（ログイン不要・有効期限付き）
