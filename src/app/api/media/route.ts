import { NextResponse } from "next/server";

import { getMedia, uploadMedia } from "@/lib/cms/media";
import { getSessionUserFromRequestHeaders } from "@/lib/auth/server";
import { isSameOriginMutation } from "@/lib/auth/request-origin";

export const runtime = "nodejs";

function statusFor(code: string | undefined): number {
  if (code === "VALIDATION") return 400;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "CONFLICT" || code === "REFERENCED") return 409;
  return 500;
}

export async function GET() {
  const data = await getMedia();
  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request) {
  // Reject requests before allocating/decoding their multipart bodies.
  const user = await getSessionUserFromRequestHeaders(request.headers);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "请先登录后再上传。", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  if (user.mustChangePassword || !isSameOriginMutation(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "请完成密码修改，并从当前站点上传。",
        code: "FORBIDDEN",
      },
      { status: 403 },
    );
  }
  try {
    const formData = await request.formData();
    const result = await uploadMedia(formData);
    return NextResponse.json(result, {
      status: result.ok ? 201 : statusFor(result.code),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "上传请求无效。", code: "VALIDATION" },
      { status: 400 },
    );
  }
}
