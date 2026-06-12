// Domain types mirroring the Supabase schema (supabase/migrations/0001_init.sql).

export type Platform = "linkedin";
export type CampaignStatus = "draft" | "active" | "completed";
// Linear content readiness. scheduled_at is a separate field, not a status.
export type PostStatus = "pending" | "generated" | "approved" | "posted";

export type UserRole = "admin" | "member";

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  timezone: string;
  created_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  platform: Platform;
  display_name: string;
  linkedin_url: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  account_id: string;
  title: string;
  description: string;
  // Free-text guidance steering tone/voice of generated posts & themes.
  ai_instructions: string;
  status: CampaignStatus;
  created_at: string;
}

// One SDR-reported performance snapshot. Reports append; latest wins in the UI.
export interface PostStats {
  id: string;
  post_id: string;
  views: number;
  likes: number;
  comments: number;
  recorded_at: string;
  recorded_by: string | null;
}

export interface Post {
  id: string;
  campaign_id: string;
  theme: string;
  position: number;
  body: string;
  image_url: string | null;
  // Link to the live LinkedIn post, once published.
  linkedin_url: string | null;
  status: PostStatus;
  scheduled_at: string | null;
  posted_at: string | null;
  created_at: string;
}
