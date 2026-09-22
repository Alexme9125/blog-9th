'use client';

import { createAuthClient } from 'better-auth/react';

// Authentication lives in this application. Keep requests and host-only cookies on the
// address the administrator is visiting, including newly configured domain aliases.
export const authClient = createAuthClient();
