// Google Places API (New) integration

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export interface PlacesResult {
  name: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  photo_url: string | null;
  place_id: string | null;
  lat: number | null;
  lng: number | null;
}

// 座標 + 名前で Find Place → place_id → Details
export async function enrichPlaceByCoords(
  lat: number,
  lng: number,
  name?: string | null
): Promise<PlacesResult | null> {
  if (!PLACES_API_KEY) {
    console.warn("GOOGLE_PLACES_API_KEY not set, skipping enrichment");
    return null;
  }
  if (!name) return null; // 名前なしでは精度が出ないので諦める

  try {
    // Find Place from Text: 名前 + 座標バイアスで place_id を取得
    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
    );
    url.searchParams.set("input", name);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set("locationbias", `circle:100@${lat},${lng}`);
    url.searchParams.set("fields", "place_id,name");
    url.searchParams.set("language", "ja");
    url.searchParams.set("key", PLACES_API_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate?.place_id) return null;

    return await enrichPlaceById(candidate.place_id);
  } catch (err) {
    console.error("Places API error:", err);
    return null;
  }
}

// Places API (New) — Place Details by Place ID
export async function enrichPlaceById(
  placeId: string
): Promise<PlacesResult | null> {
  if (!PLACES_API_KEY) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,types,rating,photos,geometry&language=ja&key=${PLACES_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const result = data.result;
    if (!result) return null;

    let photo_url: string | null = null;
    if (result.photos?.[0]?.photo_reference) {
      photo_url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${result.photos[0].photo_reference}&key=${PLACES_API_KEY}`;
    }

    return {
      name: result.name || null,
      address: result.formatted_address || null,
      category: humanizeCategory(result.types),
      rating: result.rating || null,
      photo_url,
      place_id: placeId,
      lat: result.geometry?.location?.lat ?? null,
      lng: result.geometry?.location?.lng ?? null,
    };
  } catch (err) {
    console.error("Places API error:", err);
    return null;
  }
}

// 名前（+ オプションで座標）で Find Place → Details（食べログ等URLから追加する際に使用）
export async function enrichPlaceByName(
  name: string,
  lat?: number | null,
  lng?: number | null
): Promise<PlacesResult | null> {
  if (!PLACES_API_KEY) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
    url.searchParams.set("input", name);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set("fields", "place_id,name");
    url.searchParams.set("language", "ja");
    if (lat != null && lng != null) {
      url.searchParams.set("locationbias", `circle:300@${lat},${lng}`);
    }
    url.searchParams.set("key", PLACES_API_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate?.place_id) return null;

    return await enrichPlaceById(candidate.place_id);
  } catch (err) {
    console.error("enrichPlaceByName error:", err);
    return null;
  }
}

const CATEGORY_MAP: Record<string, string> = {
  // 飲食店
  restaurant: "レストラン",
  food: "飲食店",
  cafe: "カフェ",
  bar: "バー",
  night_club: "ナイトクラブ",
  bakery: "ベーカリー",
  meal_takeaway: "テイクアウト",
  meal_delivery: "デリバリー",
  // 和食系
  japanese_restaurant: "和食",
  izakaya: "居酒屋",
  ramen_restaurant: "ラーメン",
  sushi_restaurant: "寿司",
  yakitori_restaurant: "焼き鳥",
  tempura_restaurant: "天ぷら",
  tonkatsu_restaurant: "とんかつ",
  shabu_shabu_restaurant: "しゃぶしゃぶ",
  sukiyaki_restaurant: "すき焼き",
  kaiseki_restaurant: "懐石料理",
  udon_restaurant: "うどん",
  soba_restaurant: "そば",
  teppanyaki_restaurant: "鉄板焼き",
  yakiniku_restaurant: "焼肉",
  curry_restaurant: "カレー",
  // アジア・その他
  chinese_restaurant: "中華料理",
  korean_restaurant: "韓国料理",
  thai_restaurant: "タイ料理",
  italian_restaurant: "イタリア料理",
  french_restaurant: "フランス料理",
  american_restaurant: "アメリカ料理",
  hamburger_restaurant: "ハンバーガー",
  pizza_restaurant: "ピザ",
  seafood_restaurant: "シーフード",
  steak_house: "ステーキ",
  vegetarian_restaurant: "ベジタリアン",
  // 宿泊
  lodging: "宿泊",
  hotel: "ホテル",
  motel: "モーテル",
  guest_house: "ゲストハウス",
  // 観光・文化
  tourist_attraction: "観光スポット",
  museum: "美術館・博物館",
  art_gallery: "ギャラリー",
  zoo: "動物園",
  aquarium: "水族館",
  amusement_park: "遊園地",
  park: "公園",
  natural_feature: "自然・景勝地",
  // ショッピング
  shopping_mall: "ショッピングモール",
  store: "ショップ",
  clothing_store: "ファッション",
  shoe_store: "靴屋",
  book_store: "本屋",
  electronics_store: "家電",
  furniture_store: "家具",
  home_goods_store: "ホームグッズ",
  jewelry_store: "ジュエリー",
  grocery_or_supermarket: "スーパー",
  convenience_store: "コンビニ",
  drugstore: "ドラッグストア",
  department_store: "デパート",
  // 生活・サービス
  spa: "スパ",
  beauty_salon: "美容院",
  hair_care: "ヘアケア",
  gym: "ジム",
  laundry: "コインランドリー",
  // 医療
  hospital: "病院",
  pharmacy: "薬局",
  doctor: "クリニック",
  dentist: "歯科",
  // 金融
  bank: "銀行",
  atm: "ATM",
  // 交通
  gas_station: "ガソリンスタンド",
  transit_station: "駅・交通機関",
  subway_station: "地下鉄駅",
  train_station: "鉄道駅",
  bus_station: "バス停",
  airport: "空港",
  parking: "駐車場",
  // その他施設
  library: "図書館",
  school: "学校",
  university: "大学",
  church: "教会",
  place_of_worship: "寺院・神社",
  stadium: "スタジアム",
  movie_theater: "映画館",
  bowling_alley: "ボウリング",
};

// 汎用タグ（スキップ）
const GENERIC_TYPES = new Set([
  "establishment",
  "point_of_interest",
  "premise",
  "political",
  "geocode",
  // 飲食系の汎用タグ（より具体的なタイプが見つかれば後回し）
  "food",
  "restaurant",
  "store",
  "lodging",
]);

function humanizeCategory(types?: string[]): string | null {
  if (!types?.length) return null;

  // パス1: 具体的なタイプを優先（汎用タグをスキップ）
  for (const type of types) {
    if (GENERIC_TYPES.has(type)) continue;
    const mapped = CATEGORY_MAP[type];
    if (mapped) return mapped;
  }

  // パス2: 汎用タグでも CATEGORY_MAP にあれば使う（food → 飲食店 など）
  for (const type of types) {
    const mapped = CATEGORY_MAP[type];
    if (mapped) return mapped;
  }

  return null;
}
