import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, AtSign, ChevronRight, CircleCheck, Clock, Copy, Crown, KeyRound, Minus, Search, ShieldCheck, ShieldOff, UserPlus, UsersRound } from 'lucide-react';
import { del, get, patch, post, put, errorText } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAction, useInvalidate } from '../../lib/hooks';
import { useUser } from '../../lib/session';
import { useT } from '../../lib/i18n';
import { cn, copyText } from '../../lib/utils';
import type { DomainInfo, MailboxAdmin, UserSummary } from '../../lib/types';
import { Button } from '../../components/ui/button';
import { AddressInput, ChoiceCards, Field, Input, SegmentedControl, Select, Switch, Tick } from '../../components/ui/form';
import { Alert, Avatar, Badge, Card, CardHeader, CopyButton, EmptyState, PageHeader, PageSpinner } from '../../components/ui/misc';
import { ConfirmDialog, Dialog, useToast } from '../../components/ui/overlay';

const grid = 'grid grid-cols-[minmax(0,1fr)_20px] items-center gap-4 px-5 md:grid-cols-[minmax(0,2.2fr)_90px_minmax(0,1.5fr)_80px_minmax(0,1fr)_20px]';

type RoleFilter = 'all' | 'admins' | 'members' | 'disabled';

function useUsers() {
  return useQuery({ queryKey: ['admin', 'users'], queryFn: () => get<UserSummary[]>('/admin/users') });
}
function useRefresh() {
  const invalidate = useInvalidate();
  return () => invalidate(['admin', 'users'], ['admin', 'mailboxes'], ['mailboxes'], ['admin', 'overview']);
}

function RoleChip({ role }: { role: UserSummary['role'] }) {
  return (
    <span className={cn('inline-flex h-[22px] items-center rounded-md px-2 text-xs font-medium capitalize', role === 'owner' ? 'bg-primary-soft text-primary-text' : role === 'admin' ? 'bg-surface-3 text-muted' : 'bg-surface-2 text-muted')}>
      {role}
    </span>
  );
}

function lastSignIn(u: UserSummary, t: (key: string, vars?: Record<string, string | number>) => string): string {
  return u.lastLoginAt ? timeAgo(u.lastLoginAt) : u.mustChangePassword ? t('admin.usersNotSignedInYet') : t('admin.usersNeverSignedIn');
}

export function UsersPage() {
  const t = useT();
  const me = useUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const users = useUsers();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const refresh = useRefresh();
  const list = useMemo(() => users.data ?? [], [users.data]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return list.filter(
      (u) =>
        (role === 'all' || (role === 'admins' ? u.role !== 'member' : role === 'members' ? u.role === 'member' : u.status === 'disabled')) &&
        (!q || u.email.includes(q) || u.name.toLowerCase().includes(q) || u.mailboxes.some((m) => m.address.includes(q))),
    );
  }, [list, filter, role]);

  // "Invite people" on the overview links here with ?add=1.
  useEffect(() => {
    if (params.get('add')) {
      setCreating(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  if (users.isLoading) return <PageSpinner />;
  const counts = {
    all: list.length,
    admins: list.filter((u) => u.role !== 'member').length,
    members: list.filter((u) => u.role === 'member').length,
    disabled: list.filter((u) => u.status === 'disabled').length,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('admin.usersTitle')}
        description={t('admin.usersDesc')}
        actions={
          <Button variant="primary" icon={<UserPlus className="h-[15px] w-[15px]" />} onClick={() => setCreating(true)}>
            {t('admin.usersAdd')}
          </Button>
        }
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<UsersRound />} title={t('admin.usersEmpty')} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-[34px] w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-[var(--ring)] sm:w-[280px]">
              <Search className="h-[15px] w-[15px] text-faint" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('admin.usersFilter')} aria-label={t('admin.usersFilter')} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
            </div>
            <SegmentedControl
              value={role}
              onChange={setRole}
              options={[
                { value: 'all', label: t('admin.usersAll'), count: counts.all },
                { value: 'admins', label: t('admin.usersAdmins'), count: counts.admins },
                { value: 'members', label: t('admin.usersMembers'), count: counts.members },
                ...(counts.disabled ? [{ value: 'disabled' as const, label: t('admin.usersDisabled'), count: counts.disabled }] : []),
              ]}
            />
          </div>
          <Card className="overflow-hidden">
            <div className={cn(grid, 'hidden h-[38px] border-b border-border bg-surface-2 text-xs font-medium text-faint md:grid')}>
              <span>{t('admin.usersPerson')}</span>
              <span>{t('admin.usersRole')}</span>
              <span>{t('admin.usersInboxes')}</span>
              <span>{t('admin.usersTwoFactor')}</span>
              <span>{t('admin.usersLastSignIn')}</span>
              <span />
            </div>
            {shown.map((u) => (
              <button key={u.id} type="button" onClick={() => navigate(`/admin/users/${u.id}`)} className={cn(grid, 'min-h-[58px] w-full border-b border-border py-2 text-left text-[13px] transition-colors last:border-b-0 hover:bg-surface-2')}>
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={u.name} address={u.email} size={32} />
                  <div className="min-w-0 leading-snug">
                    <div className="flex items-center gap-1.5 truncate font-semibold">
                      <span className="truncate">{u.name || u.email}</span>
                      {u.id === me?.id && <span className="font-normal text-faint">{t('admin.usersYou')}</span>}
                      {u.status === 'disabled' && (
                        <Badge tone="danger" pill>
                          {t('admin.usersDisabled')}
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-[12.5px] text-muted">{u.email}</div>
                  </div>
                </div>
                <span className="hidden md:block">
                  <RoleChip role={u.role} />
                </span>
                <span className={cn('hidden truncate text-[12.5px] md:block', u.mailboxes.length ? 'text-muted' : 'text-faint')}>
                  {u.mailboxes.length ? (
                    <>
                      {u.mailboxes[0].address}
                      {u.mailboxes.length > 1 && <span className="text-faint"> +{u.mailboxes.length - 1}</span>}
                    </>
                  ) : (
                    t('admin.usersNoInboxes')
                  )}
                </span>
                <span className="hidden md:block" title={u.totpEnabled ? t('admin.usersTwoFactorOn') : t('admin.usersTwoFactorOff')}>
                  {u.totpEnabled ? <ShieldCheck className="h-4 w-4 text-success" /> : <Minus className="h-4 w-4 text-faint" />}
                </span>
                <span className="hidden truncate text-[12.5px] text-muted md:block">{lastSignIn(u, t)}</span>
                <ChevronRight className="h-[15px] w-[15px] text-faint" />
              </button>
            ))}
            {!shown.length && <div className="px-5 py-8 text-center text-[13px] text-muted">{t('admin.usersNoMatch')}</div>}
          </Card>
        </>
      )}

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            setSecret(r);
            refresh();
          }}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

export function UserDetailPage() {
  const t = useT();
  const { id } = useParams();
  const users = useUsers();
  const user = users.data?.find((u) => u.id === Number(id));
  if (users.isLoading) return <PageSpinner />;
  if (!user)
    return (
      <Card>
        <EmptyState icon={<UsersRound />} title={t('admin.usersNotFound')} action={<Link to="/admin/users" className="text-[13px] font-medium text-primary-text hover:underline">{t('admin.usersBackToUsers')}</Link>} />
      </Card>
    );
  return <UserDetail key={user.id} user={user} users={users.data ?? []} />;
}

function UserDetail({ user, users }: { user: UserSummary; users: UserSummary[] }) {
  const t = useT();
  const me = useUser();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const mailboxes = useQuery({ queryKey: ['admin', 'mailboxes'], queryFn: () => get<MailboxAdmin[]>('/admin/mailboxes') });
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<'member' | 'admin'>(user.role === 'admin' ? 'admin' : 'member');
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { run, busy } = useAction();
  const isOwner = user.role === 'owner';
  const isMe = user.id === me?.id;
  const label = user.name || user.email;

  // Access is stored per inbox, so changing it rewrites that inbox's member list.
  const setAccess = (m: MailboxAdmin, access: { canSend: boolean } | null) => {
    const others = m.members.filter((x) => x.userId !== user.id).map((x) => ({ userId: x.userId, canSend: x.canSend }));
    const next = access ? [...others, { userId: user.id, canSend: access.canSend }] : others;
    return run(`access-${m.id}`, () => put(`/admin/mailboxes/${m.id}/members`, { members: next }).then(refresh), access ? undefined : t('admin.usersRemovedFrom', { address: m.address }));
  };

  return (
    <div className="flex flex-col gap-5">
      <Link to="/admin/users" className="-mb-3 flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('admin.usersTitle')}
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={user.name} address={user.email} size={52} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] leading-tight font-semibold tracking-[-0.02em]">
            <span className="truncate">{label}</span>
            <RoleChip role={user.role} />
            {user.status === 'disabled' && (
              <Badge tone="danger" pill>
                Disabled
              </Badge>
            )}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {user.email} · {t('admin.usersAdded', { date: new Date(user.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) })} · {user.lastLoginAt ? t('admin.usersLastSignedIn', { time: timeAgo(user.lastLoginAt) }) : t('admin.usersNeverSignedInLower')}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={t('admin.usersGeneral')} />
            <div className="grid gap-x-5 gap-y-4 px-5 py-[18px] sm:grid-cols-2">
              <Field label={t('admin.usersName')} id="uname">
                <Input id="uname" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('admin.usersSignInEmail')} id="uemail">
                <Input id="uemail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label={t('admin.usersRole')} className="sm:col-span-2" hint={isOwner ? t('admin.usersOwnerHint') : undefined}>
                {isOwner ? (
                  <div className="flex h-9 items-center gap-2 text-[13px] text-muted">
                    <Crown className="h-4 w-4 text-primary-text" /> {t('admin.usersOwnerLine')}
                  </div>
                ) : (
                  <ChoiceCards
                    value={role}
                    onChange={setRole}
                    options={[
                      { value: 'member', label: t('admin.usersMember'), hint: t('admin.usersMemberHint') },
                      { value: 'admin', label: t('admin.usersAdmin'), hint: t('admin.usersAdminHint') },
                    ]}
                  />
                )}
              </Field>
            </div>
            <div className="flex justify-end border-t border-border px-5 py-3">
              <Button variant="primary" size="sm" loading={busy === 'general'} onClick={() => run('general', () => patch(`/admin/users/${user.id}`, { name, email, ...(isOwner ? {} : { role }) }).then(refresh), t('admin.usersUpdated'))}>
                {t('admin.usersSave')}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('admin.usersInboxAccess')} description={t('admin.usersInboxAccessDesc')} />
            {mailboxes.isLoading ? (
              <div className="px-5 py-5 text-[13px] text-muted">{t('admin.usersLoadingInboxes')}</div>
            ) : !mailboxes.data?.length ? (
              <div className="px-5 py-5 text-[13px] text-muted">{t('admin.usersNoInboxesYet')}</div>
            ) : (
              mailboxes.data.map((m) => {
                const member = m.members.find((x) => x.userId === user.id);
                const working = busy === `access-${m.id}`;
                return (
                  <div
                    key={m.id}
                    className={cn('flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-border px-5 py-2 text-[13px] transition-colors last:border-b-0 hover:bg-surface-2', working && 'opacity-60')}
                    onClick={() => !working && setAccess(m, member ? null : { canSend: true })}
                  >
                    <Tick checked={!!member} onChange={(v) => setAccess(m, v ? { canSend: true } : null)} label={m.address} />
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">{m.kind === 'shared' ? <UsersRound className="h-3.5 w-3.5" /> : <AtSign className="h-3.5 w-3.5" />}</span>
                    <div className="min-w-0 flex-1 leading-snug">
                      <div className={cn('truncate font-medium', !member && 'text-muted')}>{m.address}</div>
                      <div className="truncate text-xs text-faint">
                        {m.kind === 'shared' ? t('admin.usersShared') : t('admin.usersPersonal')} · {t('admin.usersMemberCount', { n: m.members.length, s: m.members.length === 1 ? '' : 's' })}
                      </div>
                    </div>
                    {member && (
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted" onClick={(e) => e.stopPropagation()}>
                        {t('admin.usersCanSend')}
                        <Switch checked={member.canSend} onChange={(c) => setAccess(m, { canSend: c })} label={t('admin.usersCanSendFrom', { address: m.address })} disabled={working} />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </Card>

          {!isOwner && !isMe && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[color-mix(in_oklch,var(--danger)_30%,var(--border))] bg-surface px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-danger">{t('admin.usersDeleteHeading')}</div>
                <div className="text-[12.5px] text-muted text-pretty">{t('admin.usersDeleteBody')}</div>
              </div>
              <Button variant="danger" onClick={() => setDeleting(true)}>
                {t('admin.usersDeleteButton')}
              </Button>
            </div>
          )}
        </div>

        <Card>
          <CardHeader title={t('admin.usersSecurityTitle')} />
          <SecurityRow icon={<CircleCheck />} label={t('admin.usersSignIn')} value={user.status === 'active' ? t('admin.usersAllowed') : t('admin.usersDisabled')} tone={user.status === 'active' ? 'success' : 'danger'}>
            {!isOwner && (
              <Button size="xs" loading={busy === 'status'} onClick={() => run('status', () => patch(`/admin/users/${user.id}`, { status: user.status === 'active' ? 'disabled' : 'active' }).then(refresh), user.status === 'active' ? t('admin.usersSignInDisabled') : t('admin.usersSignInEnabled'))}>
                {user.status === 'active' ? t('admin.usersDisable') : t('admin.usersEnable')}
              </Button>
            )}
          </SecurityRow>
          <SecurityRow icon={<ShieldCheck />} label={t('admin.usersTwoFactor')} value={user.totpEnabled ? t('admin.usersOn') : t('admin.usersOff')} tone={user.totpEnabled ? 'success' : undefined}>
            {user.totpEnabled && (
              <Button size="xs" icon={<ShieldOff />} loading={busy === '2fa'} onClick={() => run('2fa', () => post(`/admin/users/${user.id}/reset-2fa`).then(refresh), t('admin.usersTwoFactorOffToast'))}>
                {t('admin.usersTurnOff')}
              </Button>
            )}
          </SecurityRow>
          <SecurityRow icon={<KeyRound />} label={t('admin.usersPassword')} value={user.mustChangePassword ? t('admin.usersTemporary') : t('admin.usersSet')}>
            <Button
              size="xs"
              disabled={isOwner && !isMe}
              loading={busy === 'reset'}
              onClick={() =>
                run('reset', async () => {
                  const r = await post<{ password: string }>(`/admin/users/${user.id}/reset-password`);
                  setSecret({ name: user.name, email: user.email, password: r.password });
                  await refresh();
                })
              }
            >
              {t('admin.usersReset')}
            </Button>
          </SecurityRow>
          <SecurityRow icon={<Clock />} label={t('admin.usersLastSignIn')} value={lastSignIn(user, t)} />
        </Card>
      </div>

      {deleting && (
        <DeleteUserDialog
          user={user}
          users={users}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            refresh();
            navigate('/admin/users');
          }}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function SecurityRow({ icon, label, value, tone, children }: { icon: ReactNode; label: string; value: string; tone?: 'success' | 'danger'; children?: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-b border-border py-2 pr-3 pl-5 text-[13px] last:border-b-0">
      <span className="text-faint [&>svg]:h-[15px] [&>svg]:w-[15px]">{icon}</span>
      <div className="min-w-0 flex-1 leading-snug">
        <div className="text-xs text-faint">{label}</div>
        <div className={cn('truncate font-medium', tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-fg')}>{value}</div>
      </div>
      {children}
    </div>
  );
}

function SecretDialog({ secret, onClose }: { secret: { name: string; email: string; password: string }; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const rows: [string, string, boolean][] = [
    [t('admin.usersSecretSignInAt'), location.host, false],
    [t('admin.usersSecretEmail'), secret.email, false],
    [t('admin.usersSecretPassword'), secret.password, true],
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      icon={<CircleCheck />}
      tone="success"
      title={t('admin.usersSecretTitle')}
      description={t('admin.usersSecretDesc', { name: secret.name?.split(' ')[0] || t('admin.usersSecretThem') })}
      footer={
        <>
          <Button
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => copyText(t('admin.usersCopyText', { origin: location.origin, email: secret.email, password: secret.password })).then(() => toast.success(t('admin.usersCopied')))}
          >
            {t('admin.usersCopyAll')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('admin.usersDone')}
          </Button>
        </>
      }
    >
      <div className="overflow-hidden rounded-[10px] border border-border text-[13px]">
        {rows.map(([k, v, mono]) => (
          <div key={k} className="flex min-h-11 items-center gap-2.5 border-b border-border py-1.5 pr-2 pl-3.5 last:border-b-0">
            <span className="w-[84px] shrink-0 text-[12.5px] text-faint">{k}</span>
            <span className={cn('min-w-0 flex-1 truncate', mono && 'font-mono tracking-[0.02em]')}>{v}</span>
            {mono && <CopyButton text={v} />}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: { name: string; email: string; password: string }) => void }) {
  const t = useT();
  const domains = useQuery({ queryKey: ['admin', 'domains'], queryFn: () => get<DomainInfo[]>('/admin/domains') });
  const mailboxes = useQuery({ queryKey: ['admin', 'mailboxes'], queryFn: () => get<MailboxAdmin[]>('/admin/mailboxes') });
  const [name, setName] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [localPart, setLocalPart] = useState('');
  const [domainId, setDomainId] = useState<number | ''>('');
  const [email, setEmail] = useState('');
  const [shared, setShared] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const domainList = domains.data ?? [];
  const domain = domainList.find((d) => d.id === domainId) ?? domainList[0];
  const suggested = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post<{ email: string; password: string }>('/admin/users', {
        name,
        role,
        email: mode === 'existing' ? email : undefined,
        newMailbox: mode === 'new' ? { localPart: localPart || suggested, domainId: domain?.id } : null,
        mailboxIds: shared,
      });
      onCreated({ name, ...r });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin.usersAdd')}
      description={t('admin.usersCreateDesc')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.usersCancel')}</Button>
          {/* The domains load with the dialog; until then a new inbox has no domain to go on. */}
          <Button variant="primary" type="submit" form="create-user" loading={busy} disabled={mode === 'new' && !domain}>
            {t('admin.usersAddUser')}
          </Button>
        </>
      }
    >
      <form id="create-user" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-[1fr_150px] gap-2.5">
          <Field label={t('admin.usersName')} id="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label={t('admin.usersRole')} id="role">
            <Select id="role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
              <option value="member">{t('admin.usersMember')}</option>
              <option value="admin">{t('admin.usersAdmin')}</option>
            </Select>
          </Field>
        </div>
        <p className="-mt-2 text-xs text-muted">{role === 'admin' ? t('admin.usersAdminHint') : t('admin.usersMemberHint')}</p>
        <ChoiceCards
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: t('admin.usersCreateNewInbox'), hint: t('admin.usersCreateNewInboxHint') },
            { value: 'existing', label: t('admin.usersSignInOnly'), hint: t('admin.usersSignInOnlyHint') },
          ]}
        />
        {mode === 'new' ? (
          <Field label={t('admin.usersTheirAddress')} id="local">
            <AddressInput id="local" local={localPart} onLocal={setLocalPart} domainId={domain?.id} onDomain={setDomainId} domains={domainList} placeholder={suggested || 'jane'} />
          </Field>
        ) : (
          <Field label={t('admin.usersSignInEmail')} id="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        )}
        {!!mailboxes.data?.length && (
          <Field label={t('admin.usersAlsoGiveAccess')}>
            <div className="scroll-thin flex max-h-40 flex-col gap-2 overflow-y-auto pt-0.5">
              {mailboxes.data.map((m) => {
                const on = shared.includes(m.id);
                const toggle = (v: boolean) => setShared((s) => (v ? [...s, m.id] : s.filter((x) => x !== m.id)));
                return (
                  <div key={m.id} className="flex cursor-pointer items-center gap-2.5 text-[13px]" onClick={() => toggle(!on)}>
                    <Tick checked={on} onChange={toggle} label={m.address} />
                    {m.address}
                    <span className="truncate text-faint">· {m.displayName || (m.kind === 'shared' ? t('admin.usersSharedInbox') : t('admin.usersPersonal'))}</span>
                  </div>
                );
              })}
            </div>
          </Field>
        )}
      </form>
    </Dialog>
  );
}

function DeleteUserDialog({ user, users, onClose, onDeleted }: { user: UserSummary; users: UserSummary[]; onClose: () => void; onDeleted: () => void }) {
  const t = useT();
  const [reassign, setReassign] = useState<number | ''>('');
  const { run, busy } = useAction();
  const target = users.find((u) => u.id === reassign);
  return (
    <ConfirmDialog
      open
      danger
      onClose={onClose}
      title={t('admin.usersDeleteConfirmTitle', { name: user.name || user.email })}
      confirmLabel={t('admin.usersDeleteButton')}
      loading={!!busy}
      onConfirm={() => run('delete', () => del(`/admin/users/${user.id}${reassign ? `?reassignTo=${reassign}` : ''}`).then(onDeleted), t('admin.usersDeleted'))}
    >
      <p>{t('admin.usersDeleteBodyShort')}</p>
      <div className="mt-4 text-fg">
        <Field label={t('admin.usersReassignLabel')} hint={target ? t('admin.usersReassignHint', { name: target.name || target.email }) : undefined}>
          <Select value={reassign} onChange={(e) => setReassign(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{t('admin.usersNobody')}</option>
            {users
              .filter((u) => u.id !== user.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
          </Select>
        </Field>
      </div>
    </ConfirmDialog>
  );
}
