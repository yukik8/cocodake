import { NextRequest, NextResponse } from "next/server";

// 軽量proxy: セッションcookieをそのまま通すだけ
// getUser()のネットワーク通信は行わない
export function proxy(req: NextRequest) {
  return NextResponse.next({ request: req });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
