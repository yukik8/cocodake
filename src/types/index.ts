export interface Place {
  id: string;
  user_session: string;
  place_id: string | null;
  name: string | null;
  url: string | null;
  lat: number;
  lng: number;
  address: string | null;
  category: string | null;
  rating: number | null;
  photo_url: string | null;
  note: string | null;
  enriched: boolean;
  created_at: string;
}

export interface SharedList {
  id: string;
  title: string | null;
  place_ids: string[];
  places_snapshot: Place[];
  expires_at: string | null;
  created_at: string;
}

export interface BoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export type ImportMode = "takeout" | "url";
