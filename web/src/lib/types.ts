// Client shapes. Database rows are snake_case; mapping happens once in data.ts.
// All instants are epoch milliseconds.

export type AppStatus = 'recruiting' | 'testing' | 'applied' | 'live'
export type TesterStatus = 'active' | 'left' | 'removed'
export type TesterMethod = 'google_group' | 'email_list'

/** A member's request to be added to an email-list app's Play Console list (ADR-011). No email here. */
export interface EmailListing {
  appId: string
  uid: string
  requestedAt: number
  listedAt: number | null
}

/** Creator-only view of a request, with the full address from app_email_listings(). */
export interface EmailListingRow extends EmailListing {
  displayName: string
  photoURL?: string | null
  email: string
}
export type BadgeTier = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum'

export interface AppDoc {
  id: string
  name: string
  description: string
  optInUrl: string
  storeUrl?: string | null
  packageName?: string | null
  creatorUid: string
  creatorName: string
  creatorPhotoURL?: string | null
  status: AppStatus
  /** local midnight of the start date */
  testStartDate?: number | null
  feedbackGuide?: string | null
  /** How testers are added to the Play Console closed track (ADR-011). */
  testerMethod: TesterMethod
  /** How many testers the app needs from TesBareng, 1–12 (ADR-012); its progress target. */
  testerSlots: number
  // computed by the app_stats view
  activeTesterCount: number
  eligibleCount: number
  /** days the slot-th most senior active tester has been in: the days Google counts (0 while seats are open) */
  countedDays: number
  feedbackSentCount: number
  feedbackVerifiedCount: number
  repliedCount: number
  buildCount: number
  lastBuildAt?: number | null
  creatorTestingCount?: number
  creatorFeedbackSentCount?: number
  creatorFeedbackVerifiedCount?: number
  creatorBadgeTier?: BadgeTier
  createdAt: number
  updatedAt?: number
  deleted: boolean
  /** when it was soft-deleted; null while live */
  deletedAt?: number | null
}

/** A tester entry with the name of its app, for the admin moderation list. */
export interface AdminTesterRow extends TesterDoc {
  appName: string
  appDeleted: boolean
}

export interface TesterDoc {
  id: string
  appId: string
  uid?: string | null
  displayName: string
  photoURL?: string | null
  maskedEmail: string
  optedInAt: number
  leftAt?: number | null
  status: TesterStatus
  addedBy: 'self' | 'creator'
  note?: string | null
  feedbackSent: boolean
  feedbackSentAt?: number | null
  feedbackSummary?: string | null
  feedbackVerified: boolean
  replied: boolean
}

export interface BuildDoc {
  id: string
  versionName: string
  uploadedAt: number
  changelog: string
}

export interface PublicProfile {
  id: string
  displayName: string
  photoURL?: string | null
  maskedEmail: string
  // computed by the profile_stats view
  appsCreatedCount: number
  testingCount: number
  feedbackSentCount: number
  feedbackVerifiedCount: number
  /** entries that reached 14+ days active (badge basis, PRD FR-27g) */
  appsTestedCount: number
  badgeTier: BadgeTier
  /** apps tested needed for the next tier; null at platinum */
  nextTierAt: number | null
  emailReminders: boolean
  createdAt?: number
}

/** The signed-in member. `email` comes from their own session, never from a table. */
export interface AppUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

export interface UserDoc {
  email: string | null
  displayName: string
  photoURL?: string | null
  role: 'member' | 'admin'
}
