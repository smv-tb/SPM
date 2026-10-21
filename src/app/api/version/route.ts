import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/** The version the server is running now; open pages poll it to learn a newer one has been deployed. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ version: APP_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
