-- Earlier local builds applied 0004 while unsubscribe links still had an expiry.  The current
-- design deliberately keeps those links non-expiring, so existing databases need this forward
-- compatibility change even though fresh 0004 installs already create a nullable column.
ALTER TABLE "community_action_tokens" ALTER COLUMN "expires_at" DROP NOT NULL;
