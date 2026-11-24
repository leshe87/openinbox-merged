import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router';
import { Activity, Download, Globe, Inbox, LayoutGrid, Plug, Settings, UsersRound, Waypoints } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useT } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { useOverview } from './data';
import { OverviewPage } from './OverviewPage';
import { UserDetailPage, UsersPage } from './UsersPage';
import { InboxDetailPage, InboxesPage } from './InboxesPage';
import { DomainsPage } from './DomainsPage';
import { IntegrationsPage } from './IntegrationsPage';
import { ExternalAccountsPage } from './ExternalAccountsPage';
import { MailFlowPage } from './MailFlowPage';
import { ActivityPage } from './ActivityPage';
import { AdminSettingsPage } from './AdminSettingsPage';

const items = [
  { to: '/admin', label: 'admin.navOverview', Icon: LayoutGrid, end: true },
  { to: '/admin/inboxes', label: 'admin.navInboxes', Icon: Inbox },
  { to: '/admin/users', label: 'admin.navUsers', Icon: UsersRound },
  { to: '/admin/domains', label: 'admin.navDomains', Icon: Globe },
  { to: '/admin/integrations', label: 'admin.navIntegrations', Icon: Plug },
  { to: '/admin/external-accounts', label: 'admin.navExternalAccounts', Icon: Download },
  { to: '/admin/mailflow', label: 'admin.navMailFlow', Icon: Waypoints },
  { to: '/admin/activity', label: 'admin.navActivity', Icon: Activity },
  { to: '/admin/settings', label: 'admin.navSettings', Icon: Settings },
];

function AdminLayout() {
  const t = useT();
  const { data: session } = useSession();
  // Problem counts for the Mail flow badge and the status card.
  const { data: o } = useOverview();
  const problems = o ? o.problems.unparsed + o.problems.failed + o.problems.domainErrors + o.problems.providerErrors : 0;
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-bg md:w-[232px] md:border-r md:border-b-0">
        <nav className="scroll-thin flex gap-px overflow-x-auto p-2 md:flex-col md:px-2.5 md:py-3.5">
          <div className="hidden h-[26px] items-center px-2.5 text-[11.5px] font-medium text-faint md:flex">{t('admin.navTitle')}</div>
          {items.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-8 shrink-0 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] transition-colors',
                  isActive ? 'bg-primary-soft font-semibold text-primary-text [&>svg]:text-primary-text' : 'text-muted hover:bg-surface-2 hover:text-fg [&>svg]:text-faint',
                )
              }
            >
              <Icon className="h-[15px] w-[15px]" />
              <span className="flex-1">{t(label)}</span>
              {to === '/admin/mailflow' && problems > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger-soft px-[5px] text-[11px] font-semibold text-danger">{problems}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mx-2.5 mt-auto mb-3.5 hidden flex-col gap-0.5 rounded-[10px] border border-border bg-surface p-2.5 text-xs text-muted md:flex">
          {o && (
            <span className="flex items-center gap-1.5 font-medium text-fg">
              <span className={cn('h-[7px] w-[7px] rounded-full', problems ? 'bg-warning' : 'bg-success')} />
              {problems ? t('admin.problemsNeedAttention', { n: problems, s: problems === 1 ? '' : 's', verb: problems === 1 ? 'needs' : 'need' }) : t('admin.allSystemsNormal')}
            </span>
          )}
          <span className="truncate">
            OpenInbox {session?.version} · {location.host}
          </span>
        </div>
      </aside>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-4 pt-6 pb-12 sm:px-8 lg:px-12 lg:pt-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="inboxes" element={<InboxesPage />} />
        <Route path="inboxes/:id" element={<InboxDetailPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="domains" element={<DomainsPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="external-accounts" element={<ExternalAccountsPage />} />
        <Route path="mailflow" element={<MailFlowPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
