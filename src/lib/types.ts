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
