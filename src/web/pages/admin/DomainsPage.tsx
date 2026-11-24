import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleCheck, CircleDashed, CircleX, Ellipsis, ExternalLink, Globe, ImageUp, ListChecks, LoaderCircle, Lock, Plus, RefreshCw, RotateCw, Trash2, TriangleAlert, Wrench, X } from 'lucide-react';
import { del, get, patch, post, put, errorText } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAction, useInvalidate } from '../../lib/hooks';
import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import { runDomainSetup } from '../../lib/domain-setup';
import { PROVIDER_INFO } from '../../../shared/constants';
import type { DomainInfo, DomainSetupStep, MailboxAdmin, ProviderInfo, SenderLogo, ZoneInspection } from '../../lib/types';
import { Button, IconButton } from '../../components/ui/button';
import { Checkbox, Field, Input, Select } from '../../components/ui/form';
import { Alert, Card, EmptyState, IconTile, PageHeader, PageSpinner } from '../../components/ui/misc';
import { ConfirmDialog, Dialog, Menu, MenuItem } from '../../components/ui/overlay';

export function DomainsPage() {
  const t = useT();
  const domains = useQuery({ queryKey: ['admin', 'domains'], queryFn: () => get<DomainInfo[]>('/admin/domains') });
  const mailboxes = useQuery({ queryKey: ['admin', 'mailboxes'], queryFn: () => get<MailboxAdmin[]>('/admin/mailboxes') });
  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => get<ProviderInfo[]>('/admin/providers') });
  const [adding, setAdding] = useState(false);
  const invalidate = useInvalidate();
  const refresh = () => invalidate(['admin', 'domains'], ['admin', 'overview'], ['admin', 'providers']);
  if (domains.isLoading) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('admin.domainsTitle')}
        description={t('admin.domainsDesc')}
        actions={
          <Button variant="primary" icon={<Plus className="h-[15px] w-[15px]" />} onClick={() => setAdding(true)}>
            {t('admin.domainsAdd')}
          </Button>
        }
      />
      {domains.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Globe />}
            title={t('admin.domainsEmpty')}
            action={
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
                {t('admin.domainsAdd')}
              </Button>
            }
          >
            {t('admin.domainsEmptyBody')}
          </EmptyState>
        </Card>
      ) : (
        domains.data?.map((d) => <DomainCard key={d.id} domain={d} mailboxes={mailboxes.data ?? []} providers={providers.data ?? []} onChanged={refresh} />)
      )}
      {adding && (
        <AddDomainDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function StepList({ steps, running }: { steps: DomainSetupStep[]; running?: boolean }) {
  const active = steps.findIndex((s) => s.status !== 'done' && s.status !== 'skipped');
  return (
    <div className="flex flex-col">
      {steps.map((s, i) => {
        const state = s.status === 'done' || s.status === 'skipped' ? 'done' : s.status === 'error' ? 'err' : running && i === active ? 'run' : 'wait';
        const tile = { done: 'bg-success-soft text-success', err: 'bg-danger-soft text-danger', run: 'bg-primary-soft text-primary-text', wait: 'bg-surface-2 text-faint' }[state];
        return (
          <div key={s.id} className="relative flex gap-3 pb-3.5 last:pb-0">
            {i < steps.length - 1 && <span className="absolute top-[24px] bottom-0.5 left-[10.5px] w-px bg-border" />}
            <span className={cn('relative grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full [&>svg]:h-[13px] [&>svg]:w-[13px]', tile)}>
              {state === 'done' ? <Check /> : state === 'err' ? <X /> : state === 'run' ? <LoaderCircle className="animate-spin" /> : <CircleDashed />}
            </span>
            <div className="min-w-0 flex-1 pt-px leading-snug">
              <div className={cn('text-[13px]', state === 'run' || state === 'err' ? 'font-semibold' : 'font-[450]', state === 'wait' && 'text-faint')}>{s.label}</div>
              {s.message && <div className={cn('mt-0.5 text-xs break-words', state === 'err' ? 'text-danger' : 'text-muted')}>{s.message}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Status({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-[5px] whitespace-nowrap [&>svg]:h-[13px] [&>svg]:w-[13px]">
      {icon}
      {children}
    </span>
  );
}

function DomainCard({ domain: d, mailboxes, providers, onChanged }: { domain: DomainInfo; mailboxes: MailboxAdmin[]; providers: ProviderInfo[]; onChanged: () => void }) {
  const t = useT();
  const { run, busy } = useAction();
  const [steps, setSteps] = useState<DomainSetupStep[] | null>(null);
  const [running, setRunning] = useState(false);
  const [appDomain, setAppDomain] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const health = d.health;
  const shownSteps = steps ?? d.setup.steps;

  const finish = async () => {
    setRunning(true);
    try {
      await runDomainSetup(d.id, setSteps);
    } finally {
      setRunning(false);
      onChanged();
    }
  };

  // Sending is verified per provider; the domain sends once any provider has verified it, or once a
  // provider that has no domain API (Cloudflare, SMTP) is connected.
  const sending = providers.flatMap((p) => p.domains.filter((x) => x.domainId === d.id));
  const noDomainApi = providers.some((p) => !PROVIDER_INFO[p.type].hasDomainApi);
  const sendState = sending.some((x) => x.status === 'verified') ? 'ok' : sending.some((x) => x.status === 'pending') ? 'pending' : noDomainApi ? 'ok' : 'off';
  const issues = health?.items.filter((h) => h.status !== 'ok') ?? [];
  const errors = issues.filter((h) => h.status === 'error');
  const tone = d.status === 'error' || errors.length ? 'danger' : !d.setup.done || d.status === 'pending' || issues.length ? 'warning' : d.status === 'active' ? 'success' : 'neutral';

  return (
    <Card className={cn(tone === 'warning' && 'border-[color-mix(in_oklch,var(--warning)_35%,var(--border))]', tone === 'danger' && 'border-[color-mix(in_oklch,var(--danger)_35%,var(--border))]')}>
      <div className="flex flex-wrap items-center gap-3.5 px-5 py-[18px]">
        <IconTile tone={tone} size={36}>
          <Globe />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{d.name}</div>
          <div className="mt-[3px] flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
            <Status icon={d.status === 'active' ? <CircleCheck className="text-success" /> : d.status === 'error' ? <CircleX className="text-danger" /> : <CircleDashed className="text-warning" />}>
              {d.status === 'active' ? t('admin.domainsReceiving') : d.status === 'error' ? t('admin.domainsNotReceiving') : d.status === 'disabled' ? t('admin.domainsDisabled') : t('admin.domainsReceivingPending')}
            </Status>
            <Status icon={sendState === 'ok' ? <CircleCheck className="text-success" /> : sendState === 'pending' ? <CircleDashed className="text-warning" /> : <CircleX className="text-faint" />}>
              {sendState === 'ok' ? t('admin.domainsSending') : sendState === 'pending' ? t('admin.domainsSendingPending') : t('admin.domainsNotSending')}
            </Status>
            {health && (
              <Status icon={!issues.length ? <CircleCheck className="text-success" /> : errors.length ? <CircleX className="text-danger" /> : <TriangleAlert className="text-warning" />}>
                {!issues.length ? t('admin.domainsDnsRecords') : t('admin.domainsIssues', { n: issues.length, s: issues.length === 1 ? '' : 's' })}
              </Status>
            )}
            <span>
              {t('admin.domainsAddresses', { n: d.addresses, es: d.addresses === 1 ? '' : 'es' })}
              {d.healthCheckedAt ? t('admin.domainsChecked', { time: timeAgo(d.healthCheckedAt) }) : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="xs" icon={<ListChecks />} onClick={() => setShowHealth((s) => !s)} className={cn(showHealth && 'bg-surface-2')}>
            {t('admin.domainsDnsRecords')}
          </Button>
          <Button size="xs" icon={<Wrench />} loading={busy === 'repair'} onClick={() => run('repair', () => post(`/admin/domains/${d.id}/repair`).then(onChanged), t('admin.domainsRepairFinished'))}>
            {t('admin.domainsRepair')}
          </Button>
          <Menu trigger={({ onClick }) => <IconButton label={t('admin.domainsMore')} onClick={onClick} icon={<Ellipsis />} />}>
            <MenuItem icon={<RefreshCw />} onClick={() => run('check', () => post(`/admin/domains/${d.id}/check`).then(onChanged), t('admin.domainsCheckedToast'))}>
              {t('admin.domainsCheckHealth')}
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger disabled={d.addresses > 0} onClick={() => setRemoving(true)}>
              {d.addresses > 0 ? t('admin.domainsRemoveDisabled') : t('admin.domainsRemove')}
            </MenuItem>
          </Menu>
        </div>
      </div>

      {!d.setup.done && (
        <div className="mx-5 mb-[18px] flex flex-col gap-3 rounded-lg bg-warning-soft px-3.5 py-3">
          <div className="flex items-start gap-2.5 text-[12.5px]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span className="flex-1">
              <b className="font-semibold">{t('admin.domainsSetupUnfinished')}</b> {t('admin.domainsSetupUnfinishedBody')}
            </span>
            <Button size="xs" variant="primary" icon={<RotateCw />} loading={running} onClick={finish}>
              {t('admin.domainsRerunSetup')}
            </Button>
          </div>
          <div className="rounded-lg bg-surface px-3.5 py-3">
            <StepList steps={shownSteps} running={running} />
          </div>
        </div>
      )}

      {showHealth && (
        <div className="mx-5 mb-[18px] overflow-hidden rounded-lg border border-border">
          {health?.items?.length ? (
            health.items.map((h) => (
              <div key={h.key} className="flex gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0">
                {h.status === 'ok' ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : h.status === 'warn' ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> : <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />}
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{h.label}</div>
                  <div className="text-xs break-words text-muted">{h.detail}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-[13px] text-muted">
              {t('admin.domainsNotChecked')}
              <Button size="xs" loading={busy === 'check'} onClick={() => run('check', () => post(`/admin/domains/${d.id}/check`).then(onChanged))}>
                {t('admin.domainsCheckNow')}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-x-6 gap-y-[18px] border-t border-border px-5 pt-[18px] pb-5 md:grid-cols-2">
        <Field label={t('admin.domainsSendThrough')} hint={t('admin.domainsSendThroughHint')}>
          <Select value={d.providerId ?? ''} onChange={(e) => run('provider', () => patch(`/admin/domains/${d.id}`, { providerId: e.target.value ? Number(e.target.value) : null }).then(onChanged), t('admin.domainsSaved'))}>
            <option value="">{t('admin.domainsDefaultProvider')}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.domainsCatchAll')} hint={t('admin.domainsCatchAllHint')}>
          <Select
            value={d.catchAllMailboxId ?? ''}
            onChange={(e) => run('catchall', () => patch(`/admin/domains/${d.id}`, { catchAllMailboxId: e.target.value ? Number(e.target.value) : null }).then(onChanged), t('admin.domainsCatchAllUpdated'))}
          >
            <option value="">{t('admin.domainsCatchAllOff')}</option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {t('admin.domainsDeliverTo', { address: m.address })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.domainsAppAddress')} hint={t('admin.domainsAppAddressHint')}>
          {d.appHostname ? (
            <div className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[13px]">
              <a href={`https://${d.appHostname}`} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 truncate hover:underline">
                {d.appHostname}
                <ExternalLink className="h-3 w-3 shrink-0 text-faint" />
              </a>
              <span className="flex items-center gap-[5px] text-xs font-medium text-success">
                <Lock className="h-3 w-3" />
                {t('admin.domainsActive')}
              </span>
            </div>
          ) : (
            <div>
              <Button size="sm" onClick={() => setAppDomain(true)}>
                {t('admin.domainsUseMail', { domain: d.name })}
              </Button>
            </div>
          )}
        </Field>
        <Field label={t('admin.domainsSenderLogo')} hint={t('admin.domainsSenderLogoHint')}>
          <div className="flex items-center gap-2.5">
            {d.logoUpdatedAt && <img src={`/api/bimi/${d.name}/logo-${d.logoUpdatedAt}.svg`} alt="" className="h-9 w-9 rounded-md border border-border bg-white object-contain" />}
            <Button size="sm" icon={d.logoUpdatedAt ? undefined : <ImageUp />} onClick={() => setLogoOpen(true)}>
              {d.logoUpdatedAt ? t('admin.domainsChange') : t('admin.domainsAddLogo')}
            </Button>
          </div>
        </Field>
        <Field label={t('admin.domainsBypass')} hint={t('admin.domainsBypassHint')}>
          {health?.conflicts?.length ? (
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border px-2 py-[5px]">
              {health.conflicts.map((c) => (
                <span key={c.address} title={`${c.address} → ${c.action}`} className="inline-flex h-6 items-center gap-[5px] rounded-md bg-surface-2 pr-1 pl-2 text-[12.5px]">
                  {c.address}
                  <button
                    type="button"
                    aria-label={t('admin.domainsSendToOpenInbox', { address: c.address })}
                    title={t('admin.domainsDisableRuleTitle')}
                    className="grid h-4 w-4 place-items-center rounded text-faint hover:text-fg"
                    onClick={() => run('rule', () => post(`/admin/domains/${d.id}/disable-rule`, { address: c.address }).then(() => post(`/admin/domains/${d.id}/check`)).then(onChanged), t('admin.domainsRuleDisabled'))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="flex h-9 items-center rounded-lg border border-dashed border-border px-3 text-[13px] text-faint">{t('admin.domainsNone')}</div>
          )}
        </Field>
      </div>
      {logoOpen && (
        <SenderLogoDialog
          domain={d}
          onClose={() => {
            setLogoOpen(false);
            onChanged();
          }}
        />
      )}
      {appDomain && (
        <AppDomainDialog
          domain={d}
          onClose={() => setAppDomain(false)}
          onDone={() => {
            setAppDomain(false);
            onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={removing}
        danger
        icon={<Trash2 />}
        onClose={() => setRemoving(false)}
        title={t('admin.domainsRemoveTitle', { name: d.name })}
        confirmLabel={t('admin.domainsRemove')}
        loading={busy === 'remove'}
        onConfirm={() =>
          run(
            'remove',
            () =>
              del(`/admin/domains/${d.id}`).then(() => {
                setRemoving(false);
                onChanged();
              }),
            t('admin.domainsRemoved'),
          )
        }
      >
        {t('admin.domainsRemoveBody')}
      </ConfirmDialog>
    </Card>
  );
}

const readFile = (f: File) => f.text();

// BIMI: the domain's logo, its optional mark certificate, and what still keeps mail apps from
// showing it.
function SenderLogoDialog({ domain, onClose }: { domain: DomainInfo; onClose: () => void }) {
  const t = useT();
  const status = useQuery({ queryKey: ['admin', 'logo', domain.id], queryFn: () => get<SenderLogo>(`/admin/domains/${domain.id}/logo`) });
  const [svg, setSvg] = useState<{ name: string; text: string; preview: string } | null>(null);
  // undefined keeps the stored certificate, null removes it.
  const [cert, setCert] = useState<{ name: string; text: string } | null | undefined>(undefined);
  const [error, setError] = useState('');
  const svgInput = useRef<HTMLInputElement>(null);
  const certInput = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  const invalidate = useInvalidate();
  const [enforcing, setEnforcing] = useState(false);
  const s = status.data;
  const preview = svg?.preview ?? s?.logo?.url;
  const refresh = () => invalidate(['admin', 'logo', domain.id]);
  // One click for each problem the checks find. The record is written again as Save does.
  const rewriteRecord = () => put(`/admin/domains/${domain.id}/logo`, {});
  const enforceDmarc = () =>
    run(
      'dmarc',
      async () => {
        await post(`/admin/domains/${domain.id}/dmarc/enforce`);
        setEnforcing(false);
        await refresh();
      },
      t('admin.domainsDmarcEnforced'),
    );
  // Only when this page itself is served over HTTPS: that address is known to work.
  const httpsOrigin = location.protocol === 'https:' ? location.origin : null;
  const switchToHttps = () =>
    run(
      'https',
      async () => {
        await patch('/admin/settings', { appUrl: httpsOrigin });
        if (s?.logo) await rewriteRecord();
        await refresh();
      },
      t('admin.domainsAppAddressSet', { url: httpsOrigin ?? '' }),
    );
  const hasCert = cert === undefined ? !!s?.logo?.certificateUrl : !!cert;

  useEffect(() => () => (svg ? URL.revokeObjectURL(svg.preview) : undefined), [svg]);

  const takeSvg = (name: string, text: string) => setSvg({ name, text, preview: URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })) });
  const pickSvg = async (f: File | undefined) => {
    if (f) takeSvg(f.name, await readFile(f));
  };
  // A logo at an address: the server fetches and checks it; Save then stores it like a file.
  const [logoUrl, setLogoUrl] = useState('');
  const loadUrl = () =>
    run('url', async () => {
      setError('');
      try {
        const r = await post<{ svg: string }>(`/admin/domains/${domain.id}/logo/fetch`, { url: logoUrl.trim() });
        takeSvg(logoUrl.trim(), r.svg);
        setLogoUrl('');
      } catch (e) {
        setError(errorText(e));
      }
    });
  const save = () =>
    run('save', async () => {
      setError('');
      try {
        await put(`/admin/domains/${domain.id}/logo`, { ...(svg ? { svg: svg.text } : {}), ...(cert !== undefined ? { certificate: cert?.text ?? null } : {}) });
        onClose();
      } catch (e) {
        setError(errorText(e));
      }
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin.domainsLogoTitle', { name: domain.name })}
      description={t('admin.domainsLogoDesc')}
      footerStart={
        s?.logo ? (
          <Button variant="ghost" icon={<Trash2 />} loading={busy === 'remove'} onClick={() => run('remove', () => del(`/admin/domains/${domain.id}/logo`).then(onClose), t('admin.domainsLogoRemoved'))}>{t('admin.domainsRemoveBtn')}</Button>
        ) : undefined
      }
      footer={
        <>
          <Button onClick={onClose}>{t('admin.domainsCancel')}</Button>
          <Button variant="primary" loading={busy === 'save'} disabled={!svg && cert === undefined} onClick={save}>
            {t('admin.domainsSave')}
          </Button>
        </>
      }
    >
      {status.isLoading ? (
        <PageSpinner />
      ) : (
        <div className="flex flex-col gap-4">
          {status.error ? <Alert tone="danger">{errorText(status.error)}</Alert> : null}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex items-center gap-3.5">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white">
              {preview ? <img src={preview} alt={t('admin.domainsLogoPreview')} className="h-full w-full object-contain" /> : <ImageUp className="h-5 w-5 text-faint" />}
            </div>
            <div className="min-w-0 flex-1 text-[12.5px] text-muted">
              {t('admin.domainsLogoSvgBefore')}<b className="font-medium text-fg">SVG Tiny PS</b>{t('admin.domainsLogoSvgAfter')}
              {svg && <div className="mt-1 truncate text-fg">{svg.name}</div>}
            </div>
            <Button size="sm" onClick={() => svgInput.current?.click()}>
              {preview ? t('admin.domainsReplace') : t('admin.domainsChooseSvg')}
            </Button>
            <input ref={svgInput} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => pickSvg(e.target.files?.[0])} />
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (logoUrl.trim()) loadUrl();
            }}
          >
            <Input type="url" aria-label={t('admin.domainsLogoAddress')} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder={t('admin.domainsLogoUrlPlaceholder')} className="flex-1" />
            <Button size="sm" type="submit" loading={busy === 'url'} disabled={!logoUrl.trim()}>
              {t('admin.domainsLoad')}
            </Button>
          </form>
          <div className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 text-[12.5px]">
            <span className="min-w-0 flex-1 text-muted">
              <b className="font-medium text-fg">{t('admin.domainsMarkCert')}</b>{t('admin.domainsMarkCertDesc')}
              {hasCert && <span className="ml-1 text-fg">{cert ? cert.name : t('admin.domainsOnFile')}</span>}
            </span>
            {hasCert && (
              <Button size="xs" variant="ghost" onClick={() => setCert(null)}>{t('admin.domainsRemoveBtn')}</Button>
            )}
            <Button size="xs" onClick={() => certInput.current?.click()}>
              {hasCert ? t('admin.domainsReplace') : t('admin.domainsAddCert')}
            </Button>
            <input
              ref={certInput}
              type="file"
              accept=".pem,.crt,application/x-pem-file"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCert({ name: f.name, text: await readFile(f) });
              }}
            />
          </div>
          {s && (
            <div className="overflow-hidden rounded-lg border border-border">
              <LogoCheck
                ok={s.dmarc.enforced}
                label={s.dmarc.enforced ? t('admin.domainsDmarcEnforcedLabel') : t('admin.domainsDmarcNotEnforced')}
                action={
                  !s.dmarc.enforced &&
                  !enforcing && (
                    <Button size="xs" icon={<Wrench />} onClick={() => setEnforcing(true)}>{t('admin.domainsFix')}</Button>
                  )
                }
              >
                {s.dmarc.enforced
                  ? s.dmarc.record
                  : (<>{t('admin.domainsDmarcOnly')} {s.dmarc.record ? t('admin.domainsDmarcIs', { record: s.dmarc.record }) : t('admin.domainsDmarcNone')}</>)}
                {enforcing && s.dmarc.fix && (
                  <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2.5">
                    <div>
                      {t('admin.domainsDmarcBecomes', { domain: domain.name })} <span className="font-mono text-fg">{s.dmarc.fix}</span>
                    </div>
                    <div>
                      {t('admin.domainsDmarcWarn', { domain: domain.name })}
                      {s.dmarc.record && /rua=/i.test(s.dmarc.record) ? t('admin.domainsDmarcRua') : ''}
                    </div>
                    <div className="flex gap-2">
                      <Button size="xs" variant="primary" loading={busy === 'dmarc'} onClick={enforceDmarc}>
                        {t('admin.domainsEnforceDmarc')}
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setEnforcing(false)}>{t('admin.domainsCancel')}</Button>
                    </div>
                  </div>
                )}
              </LogoCheck>
              <LogoCheck
                ok={s.https}
                label={s.https ? t('admin.domainsServedHttps') : t('admin.domainsNotServedHttps')}
                action={
                  !s.https &&
                  httpsOrigin && (
                    <Button size="xs" icon={<Wrench />} loading={busy === 'https'} onClick={switchToHttps}>{t('admin.domainsFix')}</Button>
                  )
                }
              >
                {s.https
                  ? (s.logo?.url ?? t('admin.domainsFromAppAddress'))
                  : httpsOrigin
                    ? t('admin.domainsHttpsFix', { url: httpsOrigin })
                    : t('admin.domainsHttpsSet')}
              </LogoCheck>
              {s.logo && (
                <LogoCheck
                  ok={s.record.current === s.record.expected}
                  label={s.record.current === s.record.expected ? t('admin.domainsRecordInPlace', { name: s.record.name }) : t('admin.domainsRecordMismatch', { name: s.record.name })}
                  action={
                    s.record.current !== s.record.expected && (
                      <Button size="xs" icon={<Wrench />} loading={busy === 'record'} onClick={() => run('record', () => rewriteRecord().then(refresh), t('admin.domainsRecordRewritten', { name: s.record.name }))}>{t('admin.domainsFix')}</Button>
                    )
                  }
                >
                  {s.record.current === s.record.expected ? s.record.current : t('admin.domainsRecordExpected', { expected: s.record.expected ?? t('admin.domainsNoneValue'), found: s.record.current ?? t('admin.domainsNoneValue') })}
                </LogoCheck>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function LogoCheck({ ok, label, action, children }: { ok: boolean; label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0">
      {ok ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-xs break-words text-muted">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function AppDomainDialog({ domain, onClose, onDone }: { domain: DomainInfo; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [sub, setSub] = useState('mail');
  const [result, setResult] = useState<string | null>(null);
  const { run, busy } = useAction();
  return (
    <Dialog
      open
      onClose={result ? onDone : onClose}
      title={t('admin.domainsAppAddress')}
      description={t('admin.domainsAppAddressHint')}
      footer={
        result ? (
          <Button variant="primary" onClick={onDone}>{t('admin.domainsDone')}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('admin.domainsCancel')}</Button>
            <Button variant="primary" loading={!!busy} onClick={() => run('attach', async () => setResult((await post<{ url: string }>(`/admin/domains/${domain.id}/app-domain`, { subdomain: sub })).url))}>
              {t('admin.domainsAttach')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <Alert tone="success" title={t('admin.domainsAttached')}>
          {t('admin.domainsAttachBodyBefore')}
          <a href={result} className="font-medium underline" target="_blank" rel="noreferrer">
            {result}
          </a>
          {t('admin.domainsAttachBodyAfter')}
        </Alert>
      ) : (
        <Field label={t('admin.domainsAddress')}>
          <div className="flex h-9 overflow-hidden rounded-lg border border-border text-[13px] focus-within:border-primary focus-within:ring-3 focus-within:ring-[var(--ring)]">
            <input className="min-w-0 flex-1 bg-surface px-3 outline-none" value={sub} onChange={(e) => setSub(e.target.value.trim())} aria-label={t('admin.domainsSubdomain')} />
            <span className="flex items-center border-l border-border bg-surface-2 px-3 text-muted">.{domain.name}</span>
          </div>
        </Field>
      )}
    </Dialog>
  );
}

function AddDomainDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const t = useT();
  const zones = useQuery({ queryKey: ['admin', 'zones'], queryFn: () => get<{ id: string; name: string; status: string; connected: boolean; usable: boolean | null }[]>('/admin/zones') });
  const all = zones.data ?? [];
  const available = all.filter((z) => !z.connected && z.usable !== false);
  const [zoneId, setZoneId] = useState('');
  const [replaceMx, setReplaceMx] = useState(false);
  const [domainId, setDomainId] = useState<number | null>(null);
  const [steps, setSteps] = useState<DomainSetupStep[] | null>(null);
  const [error, setError] = useState<{ message: string; step?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!zoneId && available[0]) setZoneId(available[0].id);
  }, [available, zoneId]);
  const inspection = useQuery({ queryKey: ['admin', 'zone', zoneId], queryFn: () => get<ZoneInspection>(`/admin/zones/${zoneId}`), enabled: !!zoneId && !steps });
  const mx = inspection.data;
  const zone = all.find((z) => z.id === zoneId);

  const setup = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      const r = await runDomainSetup(id, setSteps);
      if (r.done) setDone(true);
      else if (r.error) setError({ message: r.error, step: r.step });
    } catch (e) {
      setError({ message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await post<{ id: number }>('/admin/domains', { zoneId, replaceMx });
      setDomainId(id);
      await setup(id);
    } catch (e) {
      setError({ message: errorText(e) });
      setBusy(false);
    }
  };

  if (steps)
    return (
      <Dialog
        open
        onClose={onAdded}
        title={done ? t('admin.domainsReady', { name: zone?.name ?? t('admin.domainsTheDomain') }) : t('admin.domainsSettingUp', { name: zone?.name ?? t('admin.domainsTheDomainLower') })}
        description={done ? t('admin.domainsReadyDesc') : t('admin.domainsSettingUpDesc')}
        footer={
          <Button variant="primary" onClick={onAdded} disabled={busy}>
            {done ? t('admin.domainsDone') : t('admin.domainsClose')}
          </Button>
        }
      >
        <StepList steps={steps} running={busy} />
        {error && (
          <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-danger-soft px-3 py-2.5 text-[12.5px]">
            <CircleX className="h-[15px] w-[15px] shrink-0 text-danger" />
            <span className="min-w-0 flex-1">
              <b className="font-semibold">{t('admin.domainsSetupStopped')}</b>
              {error.step ? t('admin.domainsSetupStoppedAt', { step: error.step }) : ''}. {error.message}
            </span>
            {domainId && (
              <Button size="xs" icon={<RotateCw />} onClick={() => setup(domainId)}>{t('admin.domainsRetry')}</Button>
            )}
          </div>
        )}
      </Dialog>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin.domainsAdd')}
      description={t('admin.domainsAddDesc')}
      footer={
        available.length ? (
          <>
            <Button onClick={onClose}>{t('admin.domainsCancel')}</Button>
            <Button variant="primary" loading={busy} disabled={!zoneId || (mx?.mxState === 'other' && !replaceMx)} onClick={add}>
              {t('admin.domainsSetUp', { name: zone?.name ?? t('admin.domainsDomainWord') })}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('admin.domainsClose')}</Button>
        )
      }
    >
      {zones.isLoading ? (
        <PageSpinner />
      ) : available.length === 0 ? (
        <EmptyState icon={<Globe />} tone="warning" title={t('admin.domainsNoMore')}>
          {all.some((z) => !z.connected)
            ? t('admin.domainsTokenCantManage', { names: all.filter((z) => !z.connected).map((z) => z.name).join(', '), them: all.filter((z) => !z.connected).length === 1 ? t('admin.domainsIt') : t('admin.domainsThem') })
            : t('admin.domainsAllConnected')}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {error && <Alert tone="danger">{error.message}</Alert>}
          {all.map((z) => {
            const on = z.id === zoneId;
            const desc = z.connected ? t('admin.domainsAlreadySetUp') : z.usable === false ? t('admin.domainsTokenCantManageOne') : on ? (inspection.isLoading ? t('admin.domainsCheckingMail') : mx?.mxState === 'none' ? t('admin.domainsNoMailYet') : mx?.mxState === 'cloudflare' ? t('admin.domainsRoutingOn') : mx?.mxState === 'other' ? t('admin.domainsMxPointsTo', { host: mx.mx[0]?.host }) : '') : '';
            return (
              <button
                key={z.id}
                type="button"
                disabled={z.connected || z.usable === false}
                onClick={() => {
                  setZoneId(z.id);
                  setReplaceMx(false);
                }}
                className={cn('flex items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors disabled:opacity-50', on ? 'border-primary bg-primary-soft' : 'border-border enabled:hover:bg-surface-2')}
              >
                <span className={cn('h-4 w-4 shrink-0 rounded-full', on ? 'border-[5px] border-primary' : 'border-[1.5px] border-border-strong')} />
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block text-[13.5px] font-medium">{z.name}</span>
                  {desc && <span className="block truncate text-xs text-muted">{desc}</span>}
                </span>
                {on && mx?.mxState === 'other' && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] font-medium text-warning">{t('admin.domainsMxElsewhere')}</span>}
              </button>
            );
          })}
          {mx?.mxState === 'other' && (
            <div className="mt-2 flex flex-col gap-3 rounded-[10px] border border-[color-mix(in_oklch,var(--warning)_35%,var(--border))] p-3.5">
              <div className="text-[13px]">
                <b className="font-semibold text-warning">{t('admin.domainsMailElsewhere')}</b> <span className="text-muted">{t('admin.domainsMailKeepsGoing')}</span>
              </div>
              <div className="overflow-hidden rounded-lg border border-border font-mono text-[12.5px]">
                <div className="grid grid-cols-[60px_70px_1fr] bg-surface-2 px-3 py-2 font-sans text-xs font-medium text-faint">
                  <span>{t('admin.domainsType')}</span>
                  <span>{t('admin.domainsPriority')}</span>
                  <span>{t('admin.domainsValue')}</span>
                </div>
                {mx.mx.map((r) => (
                  <div key={r.host} className="grid grid-cols-[60px_70px_1fr] border-t border-border px-3 py-2">
                    <span>MX</span>
                    <span>{r.priority ?? '–'}</span>
                    <span className="truncate">{r.host}</span>
                  </div>
                ))}
              </div>
              <Checkbox checked={replaceMx} onChange={setReplaceMx} label={t('admin.domainsReplaceMx')} />
            </div>
          )}
          {!!mx?.conflicts.length && <Alert tone="neutral">{t('admin.domainsConflicts', { addresses: mx.conflicts.map((c) => c.address).join(', ') })}</Alert>}
          <p className="mt-1 text-xs text-faint">{t('admin.domainsSetupUnfinishedBody')}</p>
        </div>
      )}
    </Dialog>
  );
}
