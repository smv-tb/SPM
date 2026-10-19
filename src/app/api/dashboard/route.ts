export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDashboardDataForApi } from "@/lib/dashboard";
import { projectFilterForRequest } from "@/lib/current-project";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const where = await projectFilterForRequest(session.user.id, req, { allowAll: true });
  const data = await getDashboardDataForApi(where);
  return NextResponse.json(data);
}
