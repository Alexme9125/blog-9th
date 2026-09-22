import { readMediaForRequest } from "@/lib/cms/media";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/media/[id]">,
) {
  const { id } = await context.params;
  const result = await readMediaForRequest(id);
  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: result.status === 401 ? "需要登录。" : "媒体文件不可用。",
      },
      {
        status: result.status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  const body = new Uint8Array(result.bytes).buffer;
  return new Response(body, {
    headers: {
      "Content-Type": result.item.mimeType,
      "Content-Length": String(result.item.size),
      // A publication can be withdrawn at any time, so every request re-checks authorization.
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="media"; filename*=UTF-8''${encodeURIComponent(result.item.filename)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
