import type { DocumentData } from '@/lib/cms/types';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// The callback is deferred until Drizzle resolves foreign keys, after schema.ts has initialized
// `documents`. The explicit suffix also keeps Node's TypeScript bootstrap loader resolvable.
import { documents } from './schema.ts';

/** A subscriber is retained after opting out so queued jobs can be suppressed safely. */
export const communitySubscriberStatusEnum = pgEnum('community_subscriber_status', [
  'pending',
  'confirmed',
  'unsubscribed',
]);

/** Review state is deliberately separate from email ownership verification. */
export const communityApplicationStatusEnum = pgEnum('community_application_status', [
  'pending',
  'reviewing',
  'accepted',
  'declined',
  'withdrawn',
]);

export const communityActionTokenPurposeEnum = pgEnum('community_action_token_purpose', [
  'subscription_confirmation',
  'unsubscribe',
  'application_receipt',
]);

export const communitySubscribers = pgTable(
  'community_subscribers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Lower-cased and trimmed before it is written. */
    email: text('email').notNull(),
    status: communitySubscriberStatusEnum('status').notNull().default('pending'),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('community_subscribers_email_unique').on(table.email),
    index('community_subscribers_status_index').on(table.status, table.createdAt),
  ],
);

export const communityApplications = pgTable(
  'community_applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    /** Lower-cased and trimmed before it is written. */
    email: text('email').notNull(),
    interests: jsonb('interests').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    introduction: text('introduction').notNull(),
    status: communityApplicationStatusEnum('status').notNull().default('pending'),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    /** Null until the owner follows the one-time receipt-confirmation link. */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('community_applications_status_created_index').on(table.status, table.createdAt),
    index('community_applications_email_index').on(table.email, table.createdAt),
  ],
);

/**
 * Only SHA-256 token digests are stored. A token can refer to exactly one community record,
 * and becomes unusable after the atomic `used_at` update performed by the action service.
 */
export const communityActionTokens = pgTable(
  'community_action_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull(),
    purpose: communityActionTokenPurposeEnum('purpose').notNull(),
    subscriberId: uuid('subscriber_id').references(() => communitySubscribers.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => communityApplications.id, { onDelete: 'cascade' }),
    /** Subscription confirmation and application receipt links expire; unsubscribe links do not. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'community_action_tokens_target_check',
      sql`(${table.subscriberId} is not null and ${table.applicationId} is null) or (${table.subscriberId} is null and ${table.applicationId} is not null)`,
    ),
    uniqueIndex('community_action_tokens_hash_unique').on(table.tokenHash),
    index('community_action_tokens_subscriber_index').on(table.subscriberId, table.purpose),
    index('community_action_tokens_application_index').on(table.applicationId, table.purpose),
    index('community_action_tokens_expiry_index').on(table.expiresAt),
  ],
);

/** Fixed-window counters are updated with one conflict-safe statement inside the caller transaction. */
export const communityRateLimits = pgTable(
  'community_rate_limits',
  {
    scope: text('scope').notNull(),
    bucket: text('bucket').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.bucket, table.windowStartedAt] }),
    index('community_rate_limits_window_index').on(table.windowStartedAt),
  ],
);

/**
 * An insert-only record of the first public post snapshot. It intentionally survives unpublish
 * and prevents a later republish from becoming a second newsletter event.
 */
export const communityPublications = pgTable(
  'community_publications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    snapshot: jsonb('snapshot').$type<DocumentData>().notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    initialPublishedAt: timestamp('initial_published_at', { withTimezone: true }).notNull(),
    automaticNoticeQueuedAt: timestamp('automatic_notice_queued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('community_publications_document_unique').on(table.documentId),
    index('community_publications_initial_published_index').on(table.initialPublishedAt),
  ],
);

export type CommunitySubscriberStatus = (typeof communitySubscriberStatusEnum.enumValues)[number];
export type CommunityApplicationStatus = (typeof communityApplicationStatusEnum.enumValues)[number];
export type CommunityActionTokenPurpose = (typeof communityActionTokenPurposeEnum.enumValues)[number];
