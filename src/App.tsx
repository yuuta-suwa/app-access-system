import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { configError } from './lib/supabase';
import { Loading, NotAvailable } from './components/ui';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import { PendingPage, SuspendedPage, NoProfilePage } from './pages/StatusPages';
import HomePage from './pages/HomePage';
import CategoryPage from './pages/CategoryPage';
import PurposePage from './pages/PurposePage';
import AppDetailPage from './pages/AppDetailPage';
import SearchPage from './pages/SearchPage';
import SelfPage from './pages/SelfPage';
import SubmitPage from './pages/SubmitPage';
import AdminLayout from './pages/admin/AdminLayout';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminUserDetailPage from './pages/admin/AdminUserDetailPage';
import AdminAppsPage from './pages/admin/AdminAppsPage';
import AdminSubmissionsPage from './pages/admin/AdminSubmissionsPage';
import AdminPresetsPage from './pages/admin/AdminPresetsPage';
import AdminAuditPage from './pages/admin/AdminAuditPage';

export default function App() {
  const { state } = useAuth();

  if (configError) {
    return (
      <div className="notice">
        <h1>設定エラー</h1>
        <p>{configError}</p>
      </div>
    );
  }
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'signedOut') return <LoginPage message={state.message} />;

  const access = state.access;
  if (!access) return <NoProfilePage />;
  if (access.status === 'pending') return <PendingPage />;
  if (access.status === 'suspended') return <SuspendedPage />;

  const isAdmin = access.roles.includes('admin');
  const isCreator = isAdmin || access.roles.includes('creator');

  // key: 利用者・権限が変わると全画面を再マウントし、前の利用者/権限のメモリ上データを残さない (T10)
  return (
    <Routes key={`${access.user_id}:${state.epoch}`}>
      <Route path="/auth/callback" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="c/:code" element={<CategoryPage />} />
        <Route path="c/:code/p/:purposeId" element={<PurposePage />} />
        <Route path="apps/:id" element={<AppDetailPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="self" element={<SelfPage />} />
        <Route path="submit" element={isCreator ? <SubmitPage /> : <NotAvailable />} />
        <Route path="admin" element={isAdmin ? <AdminLayout /> : <NotAvailable />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="users/:id" element={<AdminUserDetailPage />} />
          <Route path="apps" element={<AdminAppsPage />} />
          <Route path="submissions" element={<AdminSubmissionsPage />} />
          <Route path="presets" element={<AdminPresetsPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
        </Route>
        <Route path="*" element={<NotAvailable />} />
      </Route>
    </Routes>
  );
}
