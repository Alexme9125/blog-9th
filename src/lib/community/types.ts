export type PublicCommunityActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; code?: string };

export type CommunityApplicationStatus = 'pending' | 'reviewing' | 'accepted' | 'declined' | 'withdrawn';
export type CommunitySubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed';

export type AdminCommunitySubscriber = {
  id: string;
  email: string;
  status: CommunitySubscriberStatus;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
};

/** Fields are deliberately redacted while an applicant has not proved ownership of their email. */
export type AdminCommunityApplication = {
  id: string;
  status: CommunityApplicationStatus;
  emailVerified: boolean;
  name: string | null;
  email: string | null;
  interests: string[];
  introduction: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminCommunity = {
  subscriberCount: number;
  confirmedSubscriberCount: number;
  subscribers: AdminCommunitySubscriber[];
  applicationCount: number;
  applications: AdminCommunityApplication[];
};

export type ManualPushPreview = {
  documentId: string;
  title: string;
  excerpt: string;
  slug: string;
  publishedAt: string;
  snapshotHash: string;
  recipientCount: number;
};
