import { NextResponse } from "next/server";

import { getMedia, uploadMedia } from "@/lib/cms/media";
import {
  getSessionUserFromRequestHeaders,
  getTrustedRequestOrigins,
} from "@/lib/auth/server";
import { isTrustedMutationOrigin } from "@/lib/auth/request-origin";

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
  const trustedOrigins = await getTrustedRequestOrigins();
  if (!isTrustedMutationOrigin(request, trustedOrigins)) {
    return NextResponse.json(
      {
        ok: false,
        error: "上传来源与站点配置不匹配，请从后台设置的站点地址进入后重试。",
        code: "INVALID_ORIGIN",
      },
      { status: 403 },
    );
  }
  if (user.mustChangePassword) {
    return NextResponse.json(
      {
        ok: false,
        error: "请先修改初始密码，再上传图片。",
        code: "PASSWORD_CHANGE_REQUIRED",
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
