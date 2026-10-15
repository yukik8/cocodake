export interface Place {
  id: string;
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

// The fields a share link exposes (see lib/places.ts toSharedPlace)
export type SharedPlace = Pick<
  Place,
  "id" | "place_id" | "name" | "url" | "lat" | "lng" | "address" | "category" | "rating" | "photo_url"
>;

export interface SharedList {
  id: string;
  title: string | null;
  places_snapshot: SharedPlace[];
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
