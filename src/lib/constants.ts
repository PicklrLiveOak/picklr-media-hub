// Fixed lists used across the app. Keep these in sync with the CHECK
// constraints in supabase/migrations/*_core.sql.

export const REQUEST_TYPES = ['Video', 'Reel', 'Graphic', 'Story', 'Livestream', 'Ad', 'Photo', 'Other'] as const;

export const STATUSES = [
  'New', 'In Strategy', 'Ready for Execution', 'In Production', 'Scheduled', 'Posted', 'On Hold',
] as const;

export const PILLARS = [
  'People of The Picklr', 'Event Hype + Recap', 'Play Here', 'Gear + Tips', 'Offers + Bookings',
] as const;

export const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const;
export const SECTIONS = ['Strategy', 'Execution'] as const;

export type Status = (typeof STATUSES)[number];

// Tailwind classes for status chips
export const STATUS_STYLE: Record<string, string> = {
  'New': 'bg-blue text-white',
  'In Strategy': 'bg-violet-100 text-violet-900',
  'Ready for Execution': 'bg-amber-100 text-amber-900',
  'In Production': 'bg-orange-100 text-orange-900',
  'Scheduled': 'bg-sky-100 text-sky-900',
  'Posted': 'bg-emerald-100 text-emerald-900',
  'On Hold': 'bg-stone-200 text-stone-700',
};

export const PRIORITY_STYLE: Record<string, string> = {
  Low: 'text-stone-500', Normal: 'text-stone-700', High: 'text-orange-600 font-semibold', Urgent: 'text-red-600 font-bold',
};

// Every permission toggle shown on the Team page. `key` must match what the
// database policies check with has_perm().
export const PERMISSIONS: { group: string; key: string; label: string }[] = [
  { group: 'Sections they can open', key: 'section.requests', label: 'Requests' },
  { group: 'Sections they can open', key: 'section.board', label: 'Board' },
  { group: 'Sections they can open', key: 'section.calendar', label: 'Calendar' },
  { group: 'Sections they can open', key: 'section.chat', label: 'Chat' },
  { group: 'Sections they can open', key: 'section.insights', label: 'Insights' },
  { group: 'Requests', key: 'requests.view_dept', label: "See all of their department's requests" },
  { group: 'Requests', key: 'requests.view_all', label: 'See every request' },
  { group: 'Requests', key: 'requests.manage', label: 'Manage requests (status, assignees, brief, tags)' },
  { group: 'Requests', key: 'requests.internal', label: 'See internal media-team comments' },
  { group: 'Other', key: 'calendar.edit', label: 'Create & edit calendar items' },
  { group: 'Other', key: 'chat.create_groups', label: 'Create group chats' },
  { group: 'Other', key: 'insights.manage', label: 'Upload insights / connect Instagram' },
  { group: 'Other', key: 'team.manage', label: 'Manage team & see audit log (admin)' },
];

export const TIMEZONE = 'America/Chicago'; // San Antonio
