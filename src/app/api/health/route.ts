import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await sql`select 1`;
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
