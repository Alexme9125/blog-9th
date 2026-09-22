import {
  assertAuthConfigured,
  AuthConfigurationError,
  getAuth,
  getSessionUserFromRequestHeaders,
} from "@/lib/auth/server";
import { DatabaseConfigurationError, assertDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailableResponse(error: unknown): Response {
  const message =
    error instanceof DatabaseConfigurationError ||
    error instanceof AuthConfigurationError
      ? error.message
      : "Authentication is temporarily unavailable. Check the database and Better Auth configuration.";

  return Response.json({ error: message }, { status: 503 });
}

async function handleAuthRequest(request: Request): Promise<Response> {
  try {
    assertDatabaseConfigured();
    assertAuthConfigured();

    // Better Auth validates that the session exists, but application account state lives in the
    // user table. Resolve it before every endpoint so disabling an account immediately makes its
    // existing cookie unusable. For a disabled user this removes the database session; the handler
    // then observes the missing session and emits the normal expired-cookie response.
    await getSessionUserFromRequestHeaders(request.headers);
    return await getAuth().handler(request);
  } catch (error) {
    return unavailableResponse(error);
  }
}

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
export const PATCH = handleAuthRequest;
export const PUT = handleAuthRequest;
export const DELETE = handleAuthRequest;
