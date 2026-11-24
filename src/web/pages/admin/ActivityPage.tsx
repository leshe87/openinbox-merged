import type { ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity, AtSign, Forward, Globe, HardDrive, Inbox, Key, KeyRound, LogIn, Plug, Rocket, Settings, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react';
import { get } from '../../lib/api';
import { t as translate, useT } from '../../lib/i18n';
import { fullDate, timeAgo } from '../../lib/format';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Avatar, Card, EmptyState, PageHeader, PageSpinner } from '../../components/ui/misc';

interface AuditEntry {
  id: number;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  at: number;
  by: string | null;
}

const LABELS: Record<string, string> = {
  'setup.claimed': 'admin.activityClaimed',
  'auth.login': 'admin.activitySignedIn',
  'auth.owner_recovered': 'admin.activityOwnerRecovered',
  'account.password_changed': 'admin.activityPasswordChanged',
  'account.2fa_enabled': 'admin.activity2faEnabled',
  'account.2fa_disabled': 'admin.activity2faDisabled',
  'account.sessions_revoked': 'admin.activitySessionsRevoked',
  'user.created': 'admin.activityUserCreated',
  'user.updated': 'admin.activityUserUpdated',
  'user.deleted': 'admin.activityUserDeleted',
  'user.password_reset': 'admin.activityPasswordReset',
  'user.2fa_reset': 'admin.activity2faReset',
  'mailbox.created': 'admin.activityMailboxCreated',
  'mailbox.deleted': 'admin.activityMailboxDeleted',
  'mailbox.members_changed': 'admin.activityMembersChanged',
  'alias.created': 'admin.activityAliasCreated',
  'domain.added': 'admin.activityDomainAdded',
  'domain.removed': 'admin.activityDomainRemoved',
  'domain.app_domain': 'admin.activityAppDomain',
  'provider.connected': 'admin.activityProviderConnected',
  'provider.removed': 'admin.activityProviderRemoved',
  'cloudflare.token_replaced': 'admin.activityCfTokenReplaced',
  'storage.r2_enabled': 'admin.activityR2Enabled',
  'storage.mode': 'admin.activityStorageMode',
  'settings.updated': 'admin.activitySettingsUpdated',
  'crypto.reencrypted': 'admin.activityReencrypted',
  'forwarding.added': 'admin.activityForwardingAdded',
};

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function actionLabel(action: string, t: TFn = translate): string {
  const key = LABELS[action];
  return key ? t(key) : action;
}

// "Maya Chen added a user": the label reads as a sentence after the name.
export function actionPhrase(action: string, t: TFn = translate): string {
  const l = actionLabel(action, t);
  return LABELS[action] ? l[0].toLowerCase() + l.slice(1) : l;
}

const ICONS: Record<string, ReactNode> = {
  setup: <Rocket />,
  auth: <LogIn />,
  account: <ShieldCheck />,
  user: <UserRound />,
  mailbox: <Inbox />,
  alias: <AtSign />,
  domain: <Globe />,
  provider: <Plug />,
  cloudflare: <KeyRound />,
  storage: <HardDrive />,
  settings: <Settings />,
  crypto: <Key />,
  forwarding: <Forward />,
};

// Green for additions, red for removals, indigo for sign-in and security, grey for changes.
function actionTile(action: string): { icon: ReactNode; cls: string } {
  const [area] = action.split('.');
  if (/deleted|removed|disabled/.test(action)) return { icon: <Trash2 />, cls: 'bg-danger-soft text-danger' };
  if (/created|added|connected|enabled|claimed/.test(action)) return { icon: action === 'user.created' ? <UserPlus /> : (ICONS[area] ?? <Activity />), cls: 'bg-success-soft text-success' };
  if (area === 'auth' || area === 'account' || /2fa|password/.test(action)) return { icon: ICONS[area] ?? <ShieldCheck />, cls: 'bg-primary-soft text-primary-text' };
  return { icon: ICONS[area] ?? <Activity />, cls: 'bg-surface-2 text-muted' };
}

function dayLabel(ms: number, t: TFn): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return t('admin.activityToday');
  if (d.toDateString() === yesterday.toDateString()) return t('admin.activityYesterday');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function ActivityRow({ entry: r, ip = true, relative }: { entry: Pick<AuditEntry, 'action' | 'target' | 'at' | 'by'> & { ip?: string | null }; ip?: boolean; relative?: boolean }) {
  const t = useT();
  const tile = actionTile(r.action);
  return (
    <div className={cn('grid min-h-[50px] items-center gap-3 border-b border-border px-5 py-2 text-[13px] last:border-b-0', ip ? 'grid-cols-[28px_26px_minmax(0,1fr)_auto] md:grid-cols-[28px_26px_minmax(0,1fr)_130px_70px]' : 'grid-cols-[28px_26px_minmax(0,1fr)_auto]')}>
      <Avatar name={r.by ?? t('admin.activitySystem')} address={r.by ?? 'system'} size={28} />
      <span className={cn('grid h-[26px] w-[26px] place-items-center rounded-[7px] [&>svg]:h-[13px] [&>svg]:w-[13px]', tile.cls)}>{tile.icon}</span>
      <span className="min-w-0 truncate">
        <b className="font-semibold">{r.by ?? t('admin.activitySystem')}</b> <span className="text-muted">{actionPhrase(r.action, t)}</span> {r.target && <span className="font-medium">{r.target}</span>}
      </span>
      {ip && <span className="hidden truncate font-mono text-[11.5px] text-faint md:block">{r.ip}</span>}
      <span className="text-right text-xs text-faint tabular-nums" title={fullDate(r.at)}>
        {relative ? timeAgo(r.at) : new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </span>
    </div>
  );
}

export function ActivityPage() {
  const t = useT();
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => get<AuditEntry[]>(`/admin/audit${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].at : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  const days: { day: string; items: AuditEntry[] }[] = [];
  for (const r of rows) {
    const day = dayLabel(r.at, t);
    if (days[days.length - 1]?.day === day) days[days.length - 1].items.push(r);
    else days.push({ day, items: [r] });
  }
  return (
    <div>
      <PageHeader title={t('admin.activityTitle')} description={t('admin.activityDesc')} />
      {q.isLoading ? (
        <PageSpinner />
      ) : !rows.length ? (
        <Card>
          <EmptyState icon={<Activity />} title={t('admin.activityEmpty')}>
            {t('admin.activityEmptyBody')}
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {days.map((d) => (
            <div key={d.day} className="flex flex-col gap-2">
              <div className="pl-0.5 text-xs font-medium text-faint">{d.day}</div>
              <Card className="overflow-hidden">
                {d.items.map((r) => (
                  <ActivityRow key={r.id} entry={r} />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
            {t('admin.activityLoadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
