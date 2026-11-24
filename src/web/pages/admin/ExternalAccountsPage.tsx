// Admin page: external POP3/IMAP accounts pulled into a local mailbox.
// Accounts are checked every 10 minutes by the Worker cron; "Fetch now" runs
// the same fetch for one account immediately.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleX, Download, Ellipsis, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { del, get, patch, post } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAction, useInvalidate } from '../../lib/hooks';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type { ExternalAccount, MailboxAdmin } from '../../lib/types';
import { Button, IconButton } from '../../components/ui/button';
import { Checkbox, Field, Input, PasswordInput, SegmentedControl, Select, Switch } from '../../components/ui/form';
import { Card, EmptyState, IconTile, PageHeader, PageSpinner } from '../../components/ui/misc';
import { ConfirmDialog, Dialog, Menu, MenuItem, useToast } from '../../components/ui/overlay';

interface FetchResult {
  fetched: number;
  skipped: number;
  duplicates: number;
  capped: boolean;
  error?: string;
}

function defaultPort(protocol: 'pop3' | 'imap', security: string): number {
  if (protocol === 'pop3') return security === 'tls' ? 995 : 110;
  return security === 'tls' ? 993 : 143;
}

export function ExternalAccountsPage() {
  const t = useT();
  const accounts = useQuery({ queryKey: ['admin', 'external-accounts'], queryFn: () => get<ExternalAccount[]>('/admin/external-accounts') });
  const mailboxes = useQuery({ queryKey: ['admin', 'mailboxes'], queryFn: () => get<MailboxAdmin[]>('/admin/mailboxes') });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ExternalAccount | null>(null);
  const invalidate = useInvalidate();
  const refresh = () => invalidate(['admin', 'external-accounts'], ['admin', 'overview']);
  if (accounts.isLoading) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('admin.externalTitle')}
        description={t('admin.externalDesc')}
        actions={
          <Button variant="primary" icon={<Plus className="h-[15px] w-[15px]" />} onClick={() => setAdding(true)}>
            {t('admin.externalAdd')}
          </Button>
        }
      />
      <p className="-mt-2 text-xs text-muted">{t('admin.externalScheduleNote')}</p>
      {accounts.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Download />}
            title={t('admin.externalEmpty')}
            action={
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
                {t('admin.externalAdd')}
              </Button>
            }
          >
            {t('admin.externalEmptyBody')}
          </EmptyState>
        </Card>
      ) : (
        accounts.data?.map((a) => <AccountCard key={a.id} account={a} onChanged={refresh} onEdit={() => setEditing(a)} />)
      )}
      {adding && (
        <AccountDialog
          key="new"
          mailboxes={mailboxes.data ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <AccountDialog
          key={editing.id}
          account={editing}
          mailboxes={mailboxes.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AccountCard({ account: a, onChanged, onEdit }: { account: ExternalAccount; onChanged: () => void; onEdit: () => void }) {
  const t = useT();
  const { run, busy } = useAction();
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const capped = a.lastStatus === 'capped';
  const tone = !a.enabled ? 'neutral' : a.lastStatus === 'error' ? 'danger' : capped ? 'warning' : a.lastStatus === 'ok' ? 'success' : 'neutral';

  const fetchNow = () =>
    run('fetch', async () => {
      const r = await post<FetchResult>(`/admin/external-accounts/${a.id}/fetch`);
      onChanged();
      if (r.error) throw new Error(r.error);
      toast.success(r.fetched === 0 ? t('admin.externalFetchedNone') : t('admin.externalFetched', { n: r.fetched, s: r.fetched === 1 ? '' : 's' }));
    });

  const test = () =>
    run('test', async () => {
      const r = await post<{ ok: boolean; message: string }>(`/admin/external-accounts/${a.id}/test`);
      onChanged();
      if (!r.ok) throw new Error(r.message);
      toast.success(r.message);
    });

  return (
    <Card className={cn(tone === 'warning' && 'border-[color-mix(in_oklch,var(--warning)_35%,var(--border))]', tone === 'danger' && 'border-[color-mix(in_oklch,var(--danger)_35%,var(--border))]')}>
      <div className="flex flex-wrap items-center gap-3.5 px-5 py-[18px]">
        <IconTile tone={tone} size={36}>
          <Download />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">
            {a.name || a.host} <span className="font-normal text-muted">· {a.protocol.toUpperCase()} {a.host}:{a.port}</span>
          </div>
          <div className="mt-[3px] flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
            <span>
              {a.username} {t('admin.externalInto', { address: a.mailboxAddress })}
            </span>
            <span>
              {a.maxImport > 0 ? t('admin.externalImportedOf', { imported: a.importedCount, cap: a.maxImport }) : t('admin.externalImportedUnlimited', { imported: a.importedCount })}
            </span>
            <span>{a.lastFetchedAt ? t('admin.externalLastFetch', { time: timeAgo(a.lastFetchedAt) }) : t('admin.externalNeverFetched')}</span>
            {a.lastFetchedAt ? <span>{t('admin.externalLastFetchedCount', { n: a.lastFetchedCount, s: a.lastFetchedCount === 1 ? '' : 's' })}</span> : null}
            {!a.enabled && (
              <span className="flex items-center gap-1 text-warning">
                <TriangleAlert className="h-3.5 w-3.5" />
                {a.lastStatus === 'error' ? t('admin.externalAutoDisabled') : t('admin.externalDisabled')}
              </span>
            )}
          </div>
          {capped && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-warning">
              <TriangleAlert className="h-3.5 w-3.5" />
              {t('admin.externalCapReached')}
            </div>
          )}
          {a.lastStatus === 'error' && a.lastError && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-danger">
              <CircleX className="h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{t('admin.externalLastError', { error: a.lastError })}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="xs" icon={<Download />} loading={busy === 'fetch'} onClick={fetchNow}>
            {t('admin.externalFetchNow')}
          </Button>
          <Button size="xs" icon={<RefreshCw />} loading={busy === 'test'} onClick={test}>
            {t('admin.externalTest')}
          </Button>
          <Menu trigger={({ onClick }) => <IconButton label={t('admin.externalEdit')} onClick={onClick} icon={<Ellipsis />} />}>
            <MenuItem icon={<Pencil />} onClick={onEdit}>
              {t('admin.externalEdit')}
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger onClick={() => setRemoving(true)}>
              {t('admin.externalRemove')}
            </MenuItem>
          </Menu>
        </div>
      </div>
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={t('admin.externalRemove')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => run('remove', () => del(`/admin/external-accounts/${a.id}`).then(onChanged), t('admin.externalRemoved'))}
      >
        {t('admin.externalRemoveBody', { host: a.host })}
      </ConfirmDialog>
    </Card>
  );
}

function AccountDialog({ account, mailboxes, onClose, onSaved }: { account?: ExternalAccount; mailboxes: MailboxAdmin[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { run, busy } = useAction();
  const [protocol, setProtocol] = useState<'pop3' | 'imap'>(account?.protocol ?? 'pop3');
  const [name, setName] = useState(account?.name ?? '');
  const [host, setHost] = useState(account?.host ?? '');
  const [port, setPort] = useState(String(account?.port ?? defaultPort(protocol, account?.security ?? 'tls')));
  const [security, setSecurity] = useState(account?.security ?? 'tls');
  const [username, setUsername] = useState(account?.username ?? '');
  const [password, setPassword] = useState('');
  const [mailboxId, setMailboxId] = useState(String(account?.mailboxId ?? mailboxes[0]?.id ?? ''));
  const [folder, setFolder] = useState(account?.folder ?? 'INBOX');
  const [deleteAfterFetch, setDeleteAfterFetch] = useState(account?.deleteAfterFetch ?? false);
  const [markSeen, setMarkSeen] = useState(account?.markSeen ?? false);
  const [maxImport, setMaxImport] = useState(String(account?.maxImport ?? 5000));
  const [enabled, setEnabled] = useState(account?.enabled ?? true);

  const save = () =>
    run(account ? 'save' : 'add', async () => {
      const portNum = Number(port);
      if (!host.trim() || !username.trim() || !mailboxId || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error(t('admin.externalInvalid'));
      }
      if (!account && !password) throw new Error(t('admin.externalPasswordRequired'));
      const body: Record<string, unknown> = {
        protocol,
        name: name.trim(),
        host: host.trim(),
        port: portNum,
        security,
        username: username.trim(),
        mailboxId: Number(mailboxId),
        folder: folder.trim() || 'INBOX',
        deleteAfterFetch,
        markSeen: protocol === 'imap' ? markSeen : false,
        maxImport: Math.max(0, Math.floor(Number(maxImport) || 0)),
        enabled,
      };
      if (password) body.password = password;
      if (account) await patch(`/admin/external-accounts/${account.id}`, body);
      else await post('/admin/external-accounts', body);
      onSaved();
    }, account ? t('admin.externalSaved') : t('admin.externalAdded'));

  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? t('admin.externalEdit') : t('admin.externalAdd')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy === 'save' || busy === 'add'} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('admin.externalProtocol')}>
          <SegmentedControl
            value={protocol}
            options={[
              { value: 'pop3', label: 'POP3' },
              { value: 'imap', label: 'IMAP' },
            ]}
            onChange={(v) => {
              setProtocol(v);
              setPort(String(defaultPort(v, security)));
            }}
          />
        </Field>
        <Field label={t('admin.externalName')} hint={t('admin.externalNameHint')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label={t('admin.externalHost')}>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="pop3.example.com" />
          </Field>
          <Field label={t('admin.externalPort')}>
            <Input value={port} onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
          </Field>
        </div>
        <Field label={t('admin.externalSecurity')}>
          <Select
            value={security}
            onChange={(e) => {
              setSecurity(e.target.value as 'tls' | 'starttls' | 'plain');
              setPort(String(defaultPort(protocol, e.target.value)));
            }}
          >
            <option value="tls">{t('admin.externalSecurityTls')}</option>
            <option value="starttls">{t('admin.externalSecurityStarttls')}</option>
            <option value="plain">{t('admin.externalSecurityPlain')}</option>
          </Select>
        </Field>
        <Field label={t('admin.externalUsername')}>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </Field>
        <Field label={t('admin.externalPassword')} hint={account ? t('admin.externalPasswordHint') : undefined}>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label={t('admin.externalMailbox')} hint={t('admin.externalMailboxHint')}>
          <Select value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.address}
              </option>
            ))}
          </Select>
        </Field>
        {protocol === 'imap' && (
          <Field label={t('admin.externalFolder')} hint={t('admin.externalFolderHint')}>
            <Input value={folder} onChange={(e) => setFolder(e.target.value)} />
          </Field>
        )}
        <Field label={t('admin.externalMaxImport')} hint={t('admin.externalMaxImportHint')}>
          <Input value={maxImport} onChange={(e) => setMaxImport(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
        </Field>
        <Checkbox label={t('admin.externalDeleteAfterFetch')} hint={t('admin.externalDeleteAfterFetchHint')} checked={deleteAfterFetch} onChange={setDeleteAfterFetch} />
        {protocol === 'imap' && <Checkbox label={t('admin.externalMarkSeen')} hint={t('admin.externalMarkSeenHint')} checked={markSeen} onChange={setMarkSeen} />}
        <Switch label={t('admin.externalEnabled')} checked={enabled} onChange={setEnabled} />
      </div>
    </Dialog>
  );
}
