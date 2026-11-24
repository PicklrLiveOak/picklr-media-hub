// Routes. Hash routing (/#/board) so every link works on GitHub Pages.
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import NewRequest from './pages/NewRequest';
import Board from './pages/Board';
import RequestDetail from './pages/RequestDetail';
import Admin from './pages/Admin';
import Chats from './pages/Chats';
import ChatRoom from './pages/ChatRoom';
import Insights from './pages/Insights';
import InsightsReport from './pages/InsightsReport';
import { ChatsProvider } from './lib/chats';
import { NotificationsProvider } from './lib/notifications';
import Calendar from './pages/Calendar';
import Notifications from './pages/Notifications';
import Me from './pages/Me';
import OAuthConsent from './pages/OAuthConsent';

// Hides a page unless the person has the permission (the database also blocks the data).
function Gate({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <Navigate to="/" replace />;
}

function Shell() {
  const { session, loading, me } = useAuth();
  if (!session) return <Login />;
  if (loading) return <div className="min-h-dvh grid place-items-center h-display text-2xl">Loading…</div>;
  if (!me) return <Login note="Your account has no profile yet — ask Nehemiah to finish setting it up." />;

  return (
    <ChatsProvider>
    <NotificationsProvider>
    <Routes>
      <Route path="oauth" element={<OAuthConsent />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="new" element={<Gate perm="section.requests"><NewRequest /></Gate>} />
        <Route path="board" element={<Gate perm="section.board"><Board /></Gate>} />
        <Route path="r/:number" element={<RequestDetail />} />
        <Route path="chat" element={<Gate perm="section.chat"><Chats /></Gate>} />
        <Route path="chat/:id" element={<ChatRoom />} />
        <Route path="insights" element={<Gate perm="section.insights"><Insights /></Gate>} />
        <Route path="insights/report" element={<Gate perm="section.insights"><InsightsReport /></Gate>} />
        <Route path="calendar" element={<Gate perm="section.calendar"><Calendar /></Gate>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="admin" element={<Gate perm="team.manage"><Admin /></Gate>} />
        <Route path="team" element={<Navigate to="/admin?tab=people" replace />} />
        <Route path="me" element={<Me />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </NotificationsProvider>
    </ChatsProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </AuthProvider>
  );
}
