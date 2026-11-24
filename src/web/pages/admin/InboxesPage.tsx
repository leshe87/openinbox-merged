import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, AtSign, ChevronRight, Inbox, Plus, Search, Trash2, UsersRound, X } from 'lucide-react';
import { del, get, patch, post, put, errorText } from '../../lib/api';
import { num } from '../../lib/format';
import { useAction, useInvalidate } from '../../lib/hooks';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type { DomainInfo, MailboxAdmin, UserSummary } from '../../lib/types';
import { Button, IconButton } from '../../components/ui/button';
import { AddressInput, ChoiceCards, Field, Input, SegmentedControl, Switch, Tick } from '../../components/ui/form';
import { Alert, Avatar, Card, CardHeader, EmptyState, PageHeader, PageSpinner } from '../../components/ui/misc';
import { Dialog } from '../../components/ui/overlay';

const KIND_OPTIONS = [
  { value: 'personal' as const, label: 'admin.inboxesPersonal', hint: 'admin.inboxesPersonalHint' },
  { value: 'shared' as const, label: 'admin.inboxesShared', hint: 'admin.inboxesSharedHint' },
];

const grid = 'grid grid-cols-[minmax(0,1fr)_20px] items-center gap-4 px-5 md:grid-cols-[minmax(0,2.2fr)_110px_150px_minmax(0,1.4fr)_70px_20px]';

function useMailboxesAdmin() {
  return useQuery({ queryKey: ['admin', 'mailboxes'], queryFn: () => get<MailboxAdmin[]>('/admin/mailboxes') });
}
function useDomains() {
  return useQuery({ queryKey: ['admin', 'domains'], queryFn: () => get<DomainInfo[]>('/admin/domains') });
}
function useRefresh() {
  const invalidate = useInvalidate();
  return () => invalidate(['admin', 'mailboxes'], ['admin', 'users'], ['mailboxes'], ['admin', 'overview']);
}

function TypeChip({ kind }: { kind: MailboxAdmin['kind'] }) {
  const t = useT();
  return <span className={cn('inline-flex h-[22px] items-center rounded-md px-2 text-xs font-medium', kind === 'shared' ? 'bg-primary-soft text-primary-text' : 'bg-surface-2 text-muted')}>{kind === 'shared' ? t('admin.inboxesShared') : t('admin.inboxesPersonal')}</span>;
}

function AvatarStack({ people, max = 4 }: { people: { name: string; email: string }[]; max?: number }) {
  const t = useT();
  if (!people.length) return <span className="text-[12.5px] text-faint">{t('admin.inboxesNobody')}</span>;
  return (
    <div className="flex items-center">
      {people.slice(0, max).map((p) => (
        <span key={p.email} className="-mr-1.5 rounded-full ring-2 ring-surface" title={p.name || p.email}>
          <Avatar name={p.name} address={p.email} size={26} />
        </span>
      ))}
      {people.length > max && <span className="ml-3 text-xs text-faint">+{people.length - max}</span>}
    </div>
  );
}

export function InboxesPage() {
  const t = useT();
  const mailboxes = useMailboxesAdmin();
  const domains = useDomains();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<'all' | 'personal' | 'shared'>('all');
  const refresh = useRefresh();
  const list = useMemo(() => mailboxes.data ?? [], [mailboxes.data]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return list.filter((m) => (kind === 'all' || m.kind === kind) && (!q || m.address.includes(q) || m.displayName.toLowerCase().includes(q) || m.aliases.some((a) => a.address.includes(q))));
  }, [list, filter, kind]);
  if (mailboxes.isLoading) return <PageSpinner />;
  const counts = { all: list.length, personal: list.filter((m) => m.kind === 'personal').length, shared: list.filter((m) => m.kind === 'shared').length };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('admin.inboxesTitle')}
        description={t('admin.inboxesDesc')}
        actions={
          <Button variant="primary" icon={<Plus className="h-[15px] w-[15px]" />} onClick={() => setCreating(true)} disabled={!domains.data?.length}>
            {t('admin.inboxesNew')}
          </Button>
        }
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<Inbox />} title={t('admin.inboxesEmpty')}>
            {domains.data?.length ? t('admin.inboxesEmptyWithDomain') : t('admin.inboxesEmptyNoDomain')}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-[34px] w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-[var(--ring)] sm:w-[280px]">
              <Search className="h-[15px] w-[15px] text-faint" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('admin.inboxesFilter')} aria-label={t('admin.inboxesFilter')} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
            </div>
            <SegmentedControl
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: t('admin.inboxesAll'), count: counts.all },
                { value: 'personal', label: t('admin.inboxesPersonal'), count: counts.personal },
                { value: 'shared', label: t('admin.inboxesShared'), count: counts.shared },
              ]}
            />
          </div>
          <Card className="overflow-hidden">
            <div className={cn(grid, 'hidden h-[38px] border-b border-border bg-surface-2 text-xs font-medium text-faint md:grid')}>
              <span>{t('admin.inboxesAddress')}</span>
              <span>{t('admin.inboxesType')}</span>
              <span>{t('admin.inboxesMembers')}</span>
              <span>{t('admin.inboxesAliases')}</span>
              <span className="text-right">{t('admin.inboxesUnread')}</span>
              <span />
            </div>
            {shown.map((m) => (
              <button key={m.id} type="button" onClick={() => navigate(`/admin/inboxes/${m.id}`)} className={cn(grid, 'min-h-[58px] w-full border-b border-border py-2 text-left text-[13px] transition-colors last:border-b-0 hover:bg-surface-2')}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">{m.kind === 'shared' ? <UsersRound className="h-[15px] w-[15px]" /> : <AtSign className="h-[15px] w-[15px]" />}</span>
                  <div className="min-w-0 leading-snug">
                    <div className="flex items-center gap-1.5 truncate font-semibold">
                      {m.address}
                      {m.isCatchAll && <span className="rounded-[5px] bg-surface-3 px-1.5 py-px text-[11px] font-medium text-muted">{t('admin.inboxesCatchAll')}</span>}
                    </div>
                    <div className="truncate text-[12.5px] text-muted">{m.displayName || t('admin.inboxesNoDisplayName')}</div>
                  </div>
                </div>
                <span className="hidden md:block">
                  <TypeChip kind={m.kind} />
                </span>
                <span className="hidden md:block">
                  <AvatarStack people={m.members} />
                </span>
                <span className={cn('hidden truncate text-[12.5px] md:block', m.aliases.length ? 'text-muted' : 'text-faint')}>{m.aliases.length ? m.aliases.map((a) => a.address).join(', ') : t('admin.inboxesNoAliasesYet')}</span>
                <span className={cn('hidden text-right tabular-nums md:block', m.unread ? 'font-semibold' : 'text-faint')}>{num(m.unread)}</span>
                <ChevronRight className="h-[15px] w-[15px] text-faint" />
              </button>
            ))}
            {!shown.length && <div className="px-5 py-8 text-center text-[13px] text-muted">{t('admin.inboxesNoMatch')}</div>}
          </Card>
        </>
      )}
      {creating && domains.data && (
        <CreateInboxDialog
          domains={domains.data}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function MembersEditor({ value, onChange }: { value: { userId: number; canSend: boolean }[]; onChange: (v: { userId: number; canSend: boolean }[]) => void }) {
  const t = useT();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => get<UserSummary[]>('/admin/users') });
  return (
    <div className="scroll-thin max-h-64 overflow-y-auto rounded-lg border border-border">
      {(users.data ?? []).map((u) => {
        const m = value.find((x) => x.userId === u.id);
        const toggle = (v: boolean) => onChange(v ? [...value, { userId: u.id, canSend: true }] : value.filter((x) => x.userId !== u.id));
        return (
          <div key={u.id} className="flex h-11 cursor-pointer items-center gap-2.5 border-b border-border px-3 text-[13px] last:border-b-0" onClick={() => toggle(!m)}>
            <Tick checked={!!m} onChange={toggle} label={u.name || u.email} />
            <Avatar name={u.name} address={u.email} size={24} />
            <span className="min-w-0 flex-1 truncate">
              {u.name || u.email}
              <span className="ml-2 text-xs text-faint">{u.email}</span>
            </span>
            {m && (
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted" onClick={(e) => e.stopPropagation()}>
                {t('admin.inboxesCanSend')}
                <Switch checked={m.canSend} onChange={(c) => onChange(value.map((x) => (x.userId === u.id ? { ...x, canSend: c } : x)))} label={t('admin.inboxesCanSend')} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CreateInboxDialog({ domains, onClose, onCreated }: { domains: DomainInfo[]; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const [localPart, setLocalPart] = useState('');
  const [domainId, setDomainId] = useState(domains[0]?.id ?? 0);
  const [displayName, setDisplayName] = useState('');
  const [kind, setKind] = useState<'personal' | 'shared'>('shared');
  const [members, setMembers] = useState<{ userId: number; canSend: boolean }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/admin/mailboxes', { localPart, domainId, displayName, kind, members });
      onCreated();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin.inboxesNew')}
      description={t('admin.inboxesCreateDesc')}
      footer={
        <>
          <Button onClick={onClose}>{t('admin.inboxesCancel')}</Button>
          <Button variant="primary" type="submit" form="create-inbox" loading={busy} disabled={!localPart}>
            {t('admin.inboxesCreate')}
          </Button>
        </>
      }
    >
      <form id="create-inbox" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('admin.inboxesAddress')} id="addr">
          <AddressInput id="addr" local={localPart} onLocal={setLocalPart} domainId={domainId} onDomain={setDomainId} domains={domains} placeholder="support" autoFocus />
        </Field>
        <Field label={t('admin.inboxesDisplayName')} id="dn" hint={t('admin.inboxesDisplayNameHint')}>
          <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme Support" />
        </Field>
        <Field label={t('admin.inboxesType')} hint={t('admin.inboxesSharedHint')}>
          <div className="flex">
            <SegmentedControl
              value={kind}
              onChange={setKind}
              options={[
                { value: 'personal', label: t('admin.inboxesPersonal') },
                { value: 'shared', label: t('admin.inboxesShared') },
              ]}
            />
          </div>
        </Field>
        <Field label={t('admin.inboxesMembers')}>
          <MembersEditor value={members} onChange={setMembers} />
        </Field>
      </form>
    </Dialog>
  );
}

export function InboxDetailPage() {
  const t = useT();
  const { id } = useParams();
  const mailboxes = useMailboxesAdmin();
  const domains = useDomains();
  const mailbox = mailboxes.data?.find((m) => m.id === Number(id));
  if (mailboxes.isLoading) return <PageSpinner />;
  if (!mailbox)
    return (
      <Card>
        <EmptyState icon={<Inbox />} title={t('admin.inboxesNotFound')} action={<Link to="/admin/inboxes" className="text-[13px] font-medium text-primary-text hover:underline">{t('admin.inboxesBack')}</Link>} />
      </Card>
    );
  return <InboxDetail key={mailbox.id} mailbox={mailbox} domains={domains.data ?? []} />;
}

function InboxDetail({ mailbox, domains }: { mailbox: MailboxAdmin; domains: DomainInfo[] }) {
  const t = useT();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [displayName, setDisplayName] = useState(mailbox.displayName);
  const [kind, setKind] = useState(mailbox.kind);
  const [alias, setAlias] = useState('');
  const [aliasDomain, setAliasDomain] = useState(mailbox.domainId);
  const [editMembers, setEditMembers] = useState(false);
  const [members, setMembers] = useState(mailbox.members.map((m) => ({ userId: m.userId, canSend: m.canSend })));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const { run, busy } = useAction();
  const saveMembers = (next: { userId: number; canSend: boolean }[]) => run('members', () => put(`/admin/mailboxes/${mailbox.id}/members`, { members: next }).then(refresh), t('admin.inboxesMembersSaved'));

  return (
    <div className="flex flex-col gap-5">
      <Link to="/admin/inboxes" className="-mb-3 flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('admin.inboxesTitle')}
      </Link>
      <PageHeader
        title={mailbox.address}
        description={t('admin.inboxesDetailDesc', { kind: mailbox.kind === 'shared' ? t('admin.inboxesSharedInbox') : t('admin.inboxesPersonalInbox'), date: new Date(mailbox.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), n: num(mailbox.threads), s: mailbox.threads === 1 ? '' : 's', catchAll: mailbox.isCatchAll ? t('admin.inboxesCatchAllSuffix') : '' })}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={t('admin.inboxesGeneral')} />
            <div className="grid gap-x-5 gap-y-4 px-5 py-[18px] sm:grid-cols-2">
              <Field label={t('admin.inboxesAddress')}>
                <Input value={mailbox.address} disabled />
              </Field>
              <Field label={t('admin.inboxesDisplayName')} id="mdn" hint={t('admin.inboxesDisplayNameHint')}>
                <Input id="mdn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </Field>
              <Field label={t('admin.inboxesType')} className="sm:col-span-2">
                <ChoiceCards value={kind} onChange={setKind} options={KIND_OPTIONS.map((o) => ({ ...o, label: t(o.label), hint: t(o.hint) }))} />
              </Field>
            </div>
            <div className="flex justify-end border-t border-border px-5 py-3">
              <Button variant="primary" size="sm" loading={busy === 'general'} onClick={() => run('general', () => patch(`/admin/mailboxes/${mailbox.id}`, { displayName, kind }).then(refresh), t('admin.inboxesSaved'))}>
                {t('admin.inboxesSave')}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('admin.inboxesAliases')} description={t('admin.inboxesAliasesDesc')} />
            {mailbox.aliases.length === 0 ? (
              <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5 text-[13px] text-muted">
                <AtSign className="h-3.5 w-3.5 text-faint" />
                {t('admin.inboxesNoAliases')}
              </div>
            ) : (
              mailbox.aliases.map((a) => (
                <div key={a.id} className="flex h-[46px] items-center gap-2.5 border-b border-border pr-3 pl-5 text-[13px]">
                  <AtSign className="h-3.5 w-3.5 text-faint" />
                  <span className="min-w-0 flex-1 truncate font-medium">{a.address}</span>
                  <IconButton label={t('admin.inboxesRemoveAlias')} onClick={() => run('rm', () => del(`/admin/mailboxes/${mailbox.id}/aliases/${a.id}`).then(refresh), t('admin.inboxesAliasRemoved'))} icon={<X />} className="h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5" />
                </div>
              ))
            )}
            <form
              className="flex gap-2 px-5 py-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  'alias',
                  () =>
                    post(`/admin/mailboxes/${mailbox.id}/aliases`, { localPart: alias, domainId: aliasDomain }).then(() => {
                      setAlias('');
                      refresh();
                    }),
                  t('admin.inboxesAliasAdded'),
                );
              }}
            >
              <div className="min-w-0 flex-1">
                <AddressInput local={alias} onLocal={setAlias} domainId={aliasDomain} onDomain={setAliasDomain} domains={domains} placeholder="new-alias" />
              </div>
              <Button type="submit" icon={<Plus className="h-3.5 w-3.5" />} loading={busy === 'alias'} disabled={!alias} className="h-9">
                {t('admin.inboxesAddAlias')}
              </Button>
            </form>
          </Card>

          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[color-mix(in_oklch,var(--danger)_30%,var(--border))] bg-surface px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-danger">{t('admin.inboxesDeleteHeading')}</div>
              <div className="text-[12.5px] text-muted text-pretty">
                {t('admin.inboxesDeleteBody', { n: num(mailbox.threads), m: mailbox.aliases.length, es: mailbox.aliases.length === 1 ? '' : 'es' })}
              </div>
            </div>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t('admin.inboxesDeleteButton')}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader
            title={
              <>
                {t('admin.inboxesMembers')} <span className="font-normal text-faint">{mailbox.members.length}</span>
              </>
            }
            action={
              <button type="button" className="text-[12.5px] font-medium text-primary-text hover:underline" onClick={() => setEditMembers(true)}>
                {mailbox.members.length ? t('admin.inboxesEdit') : t('admin.inboxesAdd')}
              </button>
            }
          />
          {mailbox.members.length === 0 && <div className="px-5 py-5 text-[13px] text-muted">{t('admin.inboxesNoMembers')}</div>}
          {mailbox.members.map((m) => (
            <div key={m.userId} className="flex items-center gap-2.5 border-b border-border py-2.5 pr-3 pl-5 last:border-b-0">
              <Avatar name={m.name} address={m.email} size={30} />
              <div className="min-w-0 flex-1 leading-snug">
                <div className="truncate text-[13px] font-medium">{m.name || m.email}</div>
                <div className="truncate text-xs text-faint">
                  {m.email}
                  {!m.canSend && t('admin.inboxesReadOnly')}
                </div>
              </div>
              <IconButton
                label={t('admin.inboxesRemoveMember')}
                onClick={() => saveMembers(mailbox.members.filter((x) => x.userId !== m.userId).map((x) => ({ userId: x.userId, canSend: x.canSend })))}
                icon={<X />}
                className="h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5"
              />
            </div>
          ))}
          <p className="px-5 pt-1 pb-4 text-xs text-faint text-pretty">{t('admin.inboxesAdminsDontSee')}</p>
        </Card>
      </div>

      <Dialog
        open={editMembers}
        onClose={() => setEditMembers(false)}
        title={t('admin.inboxesMembers')}
        description={t('admin.inboxesMembersDesc')}
        footer={
          <>
            <Button onClick={() => setEditMembers(false)}>{t('admin.inboxesCancel')}</Button>
            <Button
              variant="primary"
              loading={busy === 'members'}
              onClick={async () => {
                await saveMembers(members);
                setEditMembers(false);
              }}
            >
              {t('admin.inboxesSaveMembers')}
            </Button>
          </>
        }
      >
        <MembersEditor value={members} onChange={setMembers} />
      </Dialog>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        icon={<Trash2 />}
        tone="danger"
        title={t('admin.inboxesDeleteTitle', { address: mailbox.address })}
        description={t('admin.inboxesDeleteDesc', { n: num(mailbox.threads), m: mailbox.aliases.length, es: mailbox.aliases.length === 1 ? '' : 'es' })}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>{t('admin.inboxesCancel')}</Button>
            <Button
              variant="danger"
              disabled={confirmText.trim().toLowerCase() !== mailbox.address}
              loading={busy === 'delete'}
              onClick={() =>
                run(
                  'delete',
                  () =>
                    del(`/admin/mailboxes/${mailbox.id}?confirm=${encodeURIComponent(confirmText.trim())}`).then(() => {
                      refresh();
                      navigate('/admin/inboxes');
                    }),
                  t('admin.inboxesDeleted'),
                )
              }
            >
              {t('admin.inboxesDeleteInboxAndMail')}
            </Button>
          </>
        }
      >
        <Field label={t('admin.inboxesTypeAddress')} id="confirm-addr">
          <Input id="confirm-addr" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={mailbox.address} className="focus:border-danger focus:ring-[color-mix(in_oklch,var(--danger)_25%,transparent)]" />
        </Field>
      </Dialog>
    </div>
  );
}
