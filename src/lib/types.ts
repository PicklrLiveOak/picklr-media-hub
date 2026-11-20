// Shapes of rows coming back from Supabase.

export type Department = { id: number; name: string; sort: number };
export type RolePreset = { role: string; label: string; permissions: string[] };

export type Profile = {
  id: string;
  username: string;
  full_name: string;
  role: string;
  department_id: number | null;
  phone: string | null;
  contact_email: string | null;
  avatar_path: string | null;
  permissions: string[];
  is_service_account: boolean;
  active: boolean;
};

export type DriveLink = { label: string; url: string };

export type MediaRequest = {
  id: string;
  number: number;
  title: string;
  requester_id: string;
  department_id: number | null;
  department_label: string | null;
  type: string;
  event_name: string | null;
  event_date: string | null;
  needed_by: string | null;
  details: string | null;
  status: string;
  section: string;
  pillar: string | null;
  priority: string;
  brief: string | null;
  drive_links: DriveLink[];
  created_by: string;
  created_at: string;
  updated_at: string;
  request_assignees?: { user_id: string }[];
};

export type RequestFile = {
  id: string;
  request_id: string;
  storage_path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
};

// ---- Chat ----
export type ChatRow = {
  id: string;
  kind: 'dm' | 'group' | 'request';
  name: string | null;
  request_id: string | null;
  request_number: number | null;
  request_title: string | null;
  last_message_at: string;
  last_body: string | null;
  last_author: string | null;
  unread: number;
  mentioned: boolean;
  other_user: string | null;
  member_count: number;
  is_default: boolean;
};

export type Message = {
  id: string;
  chat_id: string;
  author_id: string;
  body: string;
  mentions: string[];
  attachment_path: string | null;
  link_url: string | null;
  internal: boolean;
  created_at: string;
};

// ---- Admin ----
export type Activity = {
  id: number;
  at: string;
  actor_id: string | null;
  source: 'app' | 'mcp' | 'system';
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string;
  details: Record<string, unknown> | null;
};

// ---- Insights ----
export type SocialAccount = {
  platform: 'instagram' | 'facebook';
  external_id: string;
  name: string | null;
  username: string | null;
  followers: number | null;
  connected_at: string;
  last_synced_at: string | null;
  last_error: string | null;
  token_status: 'ok' | 'warning' | 'invalid' | 'unknown';
  token_message: string | null;
  token_checked_at: string | null;
  token_expires_at: string | null;
};
export type SocialDaily = { platform: string; day: string; followers: number | null; reach: number | null; views: number | null; interactions: number | null };
export type SocialPost = {
  id: string; platform: 'instagram' | 'facebook'; external_id: string; posted_at: string; media_type: string | null;
  caption: string | null; permalink: string | null; thumbnail_url: string | null;
  views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null;
  saves: number | null; reposts: number | null; interactions: number | null; pillar: string | null; request_id: string | null;
};

// ---- Setup lists (editable on Admin → Setup) ----
export type Pillar = { name: string; color: string; sort: number; active: boolean };
export type RequestType = { name: string; sort: number; active: boolean };

// ---- Calendar ----
export type CalendarItem = {
  id: string; type: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean;
  location: string | null; notes: string | null; request_id: string | null; platform: string | null;
  caption_draft: string | null; post_status: string | null; created_by: string | null;
  calendar_assignees?: { user_id: string }[];
};

// ---- Notifications ----
export type Notice = { id: number; user_id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };
