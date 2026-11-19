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
import Team from './pages/Team';
import Me from './pages/Me';

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
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="new" element={<Gate perm="section.requests"><NewRequest /></Gate>} />
        <Route path="board" element={<Gate perm="section.board"><Board /></Gate>} />
        <Route path="r/:number" element={<RequestDetail />} />
        <Route path="team" element={<Gate perm="team.manage"><Team /></Gate>} />
        <Route path="me" element={<Me />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
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
