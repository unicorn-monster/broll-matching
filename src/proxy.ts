import { NextRequest, NextResponse } from "next/server";

// Auth protection removed — app is single-user, no login required.
export async function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
