// App frame: top bar + bottom tab bar (phone) that shows only the sections
// this person is allowed to open.
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Avatar } from './ui';

export default function Layout() {
  const { can, me } = useAuth();

  const tabs = [
    { to: '/', label: 'Home', icon: '⌂', show: true },
    { to: '/board', label: 'Board', icon: '▦', show: can('section.board') },
    { to: '/new', label: 'Request', icon: '＋', show: can('section.requests') },
    { to: '/team', label: 'Team', icon: '☺', show: can('team.manage') },
    { to: '/me', label: 'Me', icon: '◉', show: true },
  ].filter((t) => t.show);

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="pt-safe bg-ink text-cream sticky top-0 z-20">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <NavLink to="/" className="h-display text-xl tracking-wide">
            Picklr <span className="text-blue">Media Hub</span>
          </NavLink>
          <nav className="hidden md:flex items-center gap-5 text-sm font-semibold">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end
                className={({ isActive }) => (isActive ? 'text-blue' : 'text-cream/80 hover:text-cream')}>
                {t.label}
              </NavLink>
            ))}
            <Avatar person={me ?? undefined} />
          </nav>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 pt-5 pb-28 md:pb-10">
        <Outlet />
      </main>

      {/* Bottom tab bar on phones */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-ink text-cream pb-safe">
        <div className="flex">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? 'text-blue' : 'text-cream/70'}`}>
              <span className="text-xl leading-none">{t.icon}</span>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
