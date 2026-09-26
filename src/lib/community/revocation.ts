import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Suppress leased as well as queued jobs. A worker independently re-checks its lease immediately
 * before SMTP delivery, so clearing a lease is a best-effort cancellation rather than a send race.
 */
export async function suppressPostMailJobs(
  tx: Transaction,
  input: { subscriberId?: string; documentId?: string; reason: 'RECIPIENT_UNSUBSCRIBED' | 'POST_UNPUBLISHED' },
): Promise<void> {
  const clauses = [sql`"kind" = 'post'`, sql`"status" in ('queued', 'processing')`];
  if (input.subscriberId) clauses.push(sql`"metadata" ->> 'subscriberId' = ${input.subscriberId}`);
  if (input.documentId) clauses.push(sql`"metadata" ->> 'documentId' = ${input.documentId}`);
  if (!input.subscriberId && !input.documentId) throw new Error('A mail suppression target is required.');
  const now = new Date();
  const nowIso = now.toISOString();
  await tx.execute(sql`
    update "mail_jobs"
    set "status" = 'suppressed',
        "locked_at" = null,
        "locked_by" = null,
        "last_error" = ${input.reason},
        "updated_at" = ${nowIso}
    where ${sql.join(clauses, sql` and `)}
  `);
}

export async function suppressApplicationMailJobs(
  tx: Transaction,
  applicationId: string,
  reason: 'APPLICATION_WITHDRAWN' | 'APPLICATION_REMOVED',
): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  await tx.execute(sql`
    update "mail_jobs"
    set "status" = 'suppressed',
        "locked_at" = null,
        "locked_by" = null,
        "last_error" = ${reason},
        "updated_at" = ${nowIso}
    where "kind" in ('application-copy', 'application-notification')
      and "status" in ('queued', 'processing')
      and "metadata" ->> 'applicationId' = ${applicationId}
  `);
}
