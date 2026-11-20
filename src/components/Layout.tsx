// App frame: top bar + bottom tab bar (phone) that shows only the sections
// this person is allowed to open.
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useChats } from '../lib/chats';
import { Avatar } from './ui';

export default function Layout() {
  const { can, me } = useAuth();
  const { totalUnread } = useChats();
  const { pathname } = useLocation();

  // Every page opens at the top (otherwise it keeps the last page's scroll spot).
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const tabs = [
    { to: '/', label: 'Home', icon: '⌂', show: true, badge: 0 },
    { to: '/board', label: 'Board', icon: '▦', show: can('section.board'), badge: 0 },
    { to: '/chat', label: 'Chat', icon: '💬', show: can('section.chat'), badge: totalUnread },
    { to: '/insights', label: 'Insights', icon: '📈', show: can('section.insights'), badge: 0 },
    { to: '/admin', label: 'Admin', icon: '⚙', show: can('team.manage'), badge: 0 },
    { to: '/me', label: 'Me', icon: '◉', show: true, badge: 0 },
  ].filter((t) => t.show);

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="pt-safe bg-ink text-cream sticky top-0 z-20 print:hidden">
        <div className="mx-auto max-w-5xl px-safe h-14 flex items-center justify-between">
          <NavLink to="/" className="flex items-center gap-2" aria-label="Picklr Media Hub home">
            <img src="picklr-wordmark-white.png" alt="Picklr" className="h-[18px] w-auto" />
            <span className="h-display text-xl text-blue tracking-wide">Media Hub</span>
          </NavLink>
          <nav className="hidden md:flex items-center gap-5 text-sm font-semibold">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'}
                className={({ isActive }) => (isActive ? 'text-blue' : 'text-cream/80 hover:text-cream')}>
                {t.label}
                {t.badge > 0 && <span className="ml-1 rounded-full bg-red-600 text-white text-[10px] px-1.5 py-0.5">{t.badge}</span>}
              </NavLink>
            ))}
            <Avatar person={me ?? undefined} />
          </nav>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-safe pt-5 pb-tabbar">
        <Outlet />
      </main>

      {/* Bottom tab bar on phones */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-ink text-cream pb-safe print:hidden">
        <div className="flex" style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === '/'}
              className={({ isActive }) =>
                `flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? 'text-blue' : 'text-cream/70'}`}>
              <span className="relative text-xl leading-none">
                {t.icon}
                {t.badge > 0 && (
                  <span className="absolute -top-1.5 -right-3 min-w-[18px] rounded-full bg-red-600 text-white text-[10px] font-bold px-1 leading-[18px] text-center">
                    {t.badge > 99 ? '99+' : t.badge}
                  </span>
                )}
              </span>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
