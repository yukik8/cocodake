import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      place_ids,
      title,
      expires_in_days = 30,
    } = body as {
      place_ids: string[];
      title?: string;
      expires_in_days?: number;
    };

    if (!place_ids || place_ids.length === 0) {
      return NextResponse.json(
        { error: "place_ids are required" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch the places to create a snapshot
    const { data: places, error: fetchError } = await supabase
      .from("places")
      .select("*")
      .in("id", place_ids);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const expires_at =
      expires_in_days > 0
        ? new Date(
            Date.now() + expires_in_days * 24 * 60 * 60 * 1000
          ).toISOString()
        : null;

    const { data, error } = await supabase
      .from("shared_lists")
      .insert({
        title: title || null,
        place_ids,
        places_snapshot: places,
        expires_at,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ share: data });
  } catch (err) {
    console.error("Share error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
