// Tick people to add to a group. "Add all" buttons per department make
// department chats quick to set up.
import { useAuth } from '../lib/auth';
import { Avatar } from './ui';

export default function MemberPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { team, departments } = useAuth();
  const people = team.filter((t) => t.active);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const addDept = (deptId: number) =>
    onChange([...new Set([...selected, ...people.filter((p) => p.department_id === deptId).map((p) => p.id)])]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="text-xs rounded-full border border-line bg-white px-2.5 py-1"
          onClick={() => onChange(people.map((p) => p.id))}>Everyone</button>
        {departments.filter((d) => people.some((p) => p.department_id === d.id)).map((d) => (
          <button key={d.id} type="button" className="text-xs rounded-full border border-line bg-white px-2.5 py-1"
            onClick={() => addDept(d.id)}>+ {d.name}</button>
        ))}
        {selected.length > 0 && (
          <button type="button" className="text-xs text-red-600 px-2" onClick={() => onChange([])}>Clear</button>
        )}
      </div>
      <ul className="card divide-y divide-line max-h-72 overflow-y-auto">
        {people.map((p) => (
          <li key={p.id}>
            <label className="flex items-center gap-3 px-3 py-2 cursor-pointer">
              <input type="checkbox" className="h-5 w-5 accent-[#0075E7]" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
              <Avatar person={p} size={28} />
              <span className="min-w-0 truncate">{p.full_name} <span className="text-stone-500 text-sm">@{p.username}</span></span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
