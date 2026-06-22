'use client';

/**
 * app/(app)/admin/page.tsx
 *
 * Admin dashboard — migrated from backend/public/admin.html.
 * Protected: only users with is_admin=true can access.
 *  - Edge: middleware.ts gates /admin (and /admin/:path*) on a valid
 *    vachix_at cookie before this component ever renders.
 *  - Layout: (app)/layout.tsx wraps this page in ProtectedRoute, which
 *    fetches /me and redirects unauthenticated/unverified sessions.
 *  - Layout: admin/layout.tsx wraps it again with requireAdmin, which
 *    bounces non-admin users (is_admin=false) to /dashboard. This used
 *    to live in this file as a second nested ProtectedRoute — moved to
 *    a layout so it only mounts once per navigation, not once per render.
 */

import { useEffect, useState, useCallback } from 'react';
import { apiCall } from '@/lib/api';

interface OverviewStats {
  total_users:       number;
  pro_users:         number;
  elite_users:       number;
  total_sessions:    number;
  revenue_estimate:  number;
  new_users_7d:      number;
}

interface AdminUser {
  id:         string;
  name:       string;
  email:      string;
  plan:       string;
  ai_calls:   number;
  created_at: string;
}

export default function AdminPage() {
  return <AdminDashboard />;
}

function AdminDashboard() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [users,    setUsers]    = useState<AdminUser[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<'overview' | 'users' | 'leads'>('overview');

  const load = useCallback(async () => {
    setLoading(true);
    const [ovRes, usersRes] = await Promise.all([
      apiCall<{ stats: OverviewStats }>('/admin/overview'),
      apiCall<{ users: AdminUser[] }>('/admin/users'),
    ]);
    if (ovRes.ok)    setOverview(ovRes.data.stats);
    if (usersRes.ok) setUsers(usersRes.data.users);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="min-h-screen bg-[#0E0F14] text-white font-sans">
      <header className="border-b border-white/[0.07] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-extrabold">
            Vachix{' '}
            <span className="text-white/40 font-normal text-sm ml-1">Admin</span>
          </h1>
        </div>
        <button
          onClick={load}
          className="text-xs bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors"
        >
          ↻ Refresh
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          {(['overview', 'users', 'leads'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-[#4F8EF7] text-white'
                  : 'bg-white/[0.04] text-white/50 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#4F8EF7]" />
          </div>
        ) : (
          <>
            {tab === 'overview' && overview && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { label: 'Total Users',    value: overview.total_users },
                  { label: 'Pro Users',      value: overview.pro_users },
                  { label: 'Elite Users',    value: overview.elite_users },
                  { label: 'Total Sessions', value: overview.total_sessions },
                  { label: 'New (7d)',        value: overview.new_users_7d },
                  { label: 'Revenue Est.',   value: `₹${overview.revenue_estimate?.toLocaleString('en-IN') ?? 0}` },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-white/[0.07] bg-[#16181F] p-4">
                    <p className="text-xs text-white/40 mb-1">{label}</p>
                    <p className="text-2xl font-extrabold">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {tab === 'users' && (
              <div className="rounded-xl border border-white/[0.07] bg-[#16181F] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-white/[0.07]">
                    <tr className="text-white/40 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Email</th>
                      <th className="px-4 py-3 text-left">Plan</th>
                      <th className="px-4 py-3 text-left">AI Calls</th>
                      <th className="px-4 py-3 text-left">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-medium">{u.name}</td>
                        <td className="px-4 py-3 text-white/60">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.plan === 'elite'   ? 'bg-purple-500/20 text-purple-400' :
                            u.plan === 'pro'     ? 'bg-[#4F8EF7]/20 text-[#4F8EF7]' :
                            u.plan === 'starter' ? 'bg-green-500/20 text-green-400' :
                            'bg-white/[0.06] text-white/40'
                          }`}>
                            {u.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/60">{u.ai_calls ?? 0}</td>
                        <td className="px-4 py-3 text-white/40 text-xs">
                          {new Date(u.created_at).toLocaleDateString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'leads' && (
              <p className="text-white/40 text-sm py-8 text-center">
                B2B leads view — connect to <code className="text-[#4F8EF7]">/api/admin/leads</code>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
