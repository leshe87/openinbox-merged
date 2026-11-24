import { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Archive, CalendarClock, Check, ChevronDown, CircleCheck, Clock, Inbox, LoaderCircle, Mail, MailOpen, Menu as MenuIcon, OctagonAlert, Paperclip, RefreshCw, Search, SearchX, SquarePen, Star, Trash2, X } from 'lucide-react';
import { listDate } from '../../lib/format';
import { ownAddresses, participantLabel, snoozePresets, VIEW_LABELS } from '../../lib/mail';
import { cn, storageGet, storageSet } from '../../lib/utils';
import type { Mailbox, ThreadSummary } from '../../lib/types';
import { Button, IconButton } from '../../components/ui/button';
import { Tick } from '../../components/ui/form';
import { Avatar, Kbd, Skeleton } from '../../components/ui/misc';
import { ConfirmDialog, Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/ui/overlay';
import { labelChip } from './labels';
import { PickTimeDialog } from './PickTimeDialog';
import { useThreadActions, useThreads, type Action, type ActionOpts, type BulkProgress } from './data';
import { useT } from '../../lib/i18n';

const OPERATORS: [string, string][] = [
  ['from:', 'mail.searchOpSender'],
  ['to:', 'mail.searchOpRecipient'],
  ['subject:', 'mail.searchOpSubject'],
  ['has:attachment', 'mail.searchOpHasAttachment'],
  ['is:unread', 'mail.searchOpUnread'],
  ['in:anywhere', 'mail.searchOpAnywhere'],
  ['before:2026-01-31', 'mail.searchOpBefore'],
];

const RECENT_KEY = 'oi.recentSearches';

function timeHint(at: number): string {
  return new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function ThreadList({
  mailbox,
  view,
  query,
  mailboxes,
  activeId,
  focusIndex,
  setFocusIndex,
  selected,
  setSelected,
  allMatching,
  setAllMatching,
  matchCount,
  progress,
  onBulk,
  onOpen,
  onSearch,
  onMenu,
  onCompose,
  searchRef,
}: {
  mailbox: string;
  view: string;
  query: string;
  mailboxes: Mailbox[];
  activeId: number | null;
  focusIndex: number;
  setFocusIndex: (i: number) => void;
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  allMatching: boolean;
  setAllMatching: (v: boolean) => void;
  matchCount: { count: number; capped: boolean } | null;
  progress: BulkProgress | null;
  onBulk: (action: Action, opts?: ActionOpts, label?: string, whole?: boolean) => void;
  onOpen: (t: ThreadSummary) => void;
  onSearch: (q: string) => void;
  onMenu: () => void;
  onCompose: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  const q = useThreads(mailbox, view, query);
  const act = useThreadActions();
  const [search, setSearch] = useState(query);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => storageGet(RECENT_KEY, []));
  const [pickSnooze, setPickSnooze] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const list = useMemo(() => q.data?.pages.flatMap((p) => p.threads) ?? [], [q.data]);
  const own = useMemo(() => ownAddresses(mailboxes), [mailboxes]);
  const labelsById = useMemo(() => new Map(mailboxes.flatMap((m) => m.labels.map((l) => [l.id, l] as const))), [mailboxes]);
  const sentinel = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => setSearch(query), [query]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);

  // Keep the keyboard focus visible.
  useEffect(() => {
    container.current?.querySelector(`[data-index="${focusIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const runSearch = (text: string) => {
    const t = text.trim();
    if (t) {
      const next = [t, ...recent.filter((r) => r !== t)].slice(0, 5);
      setRecent(next);
      storageSet(RECENT_KEY, next);
    }
    setSearchOpen(false);
    searchRef.current?.blur();
    onSearch(t);
  };

  const ids = [...selected];
  const bulk = (action: Action, opts: ActionOpts = {}, label?: string) => {
    // Deleting a whole view forever asks first, like Empty Trash.
    if (allMatching && action === 'delete') setConfirmEmpty(true);
    else onBulk(action, opts, label);
  };
  const toggle = (id: number) => {
    // Unticking one row while the whole view is selected keeps the loaded rows, like Gmail.
    const n = new Set(allMatching ? list.map((t) => t.id) : selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };
  const allSelected = allMatching || (list.length > 0 && list.every((t) => selected.has(t.id)));
  const title = view.startsWith('label-') ? (labelsById.get(Number(view.slice(6)))?.name ?? t('mail.labelFallback')) : t(VIEW_LABELS[view] ?? view);
  const mailboxName = mailbox === 'all' ? (mailboxes.length > 1 ? t('mail.allInboxes') : '') : (mailboxes.find((m) => String(m.id) === mailbox)?.address ?? '');
  const heading = view === 'search' ? t('mail.searchResults', { q: query }) : title;
  // The whole view can be selected once everything loaded is ticked and more remains on the server.
  const offerAll = allSelected && !!q.hasNextPage && view !== 'search' && view !== 'scheduled';
  const total = matchCount ? `${matchCount.count.toLocaleString()}${matchCount.capped ? '+' : ''}` : null;
  const emptyCount = q.hasNextPage ? total : list.length.toLocaleString();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 px-3 pt-2.5 pb-2 max-md:pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(search);
          }}
          className="flex items-center gap-2"
        >
          <button type="button" onClick={onMenu} className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-muted md:hidden" aria-label={t('mail.menu')}>
            <MenuIcon className="h-5 w-5" />
          </button>
          <div
            className={cn(
              'flex h-10 flex-1 items-center gap-2 rounded-[10px] border bg-surface pr-1.5 pl-2.5 transition-shadow md:h-[34px] md:rounded-lg',
              searchOpen ? 'border-primary ring-3 ring-[var(--ring)]' : 'border-border',
            )}
          >
            <Search className="h-[15px] w-[15px] shrink-0 text-faint" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setSearchOpen(false)}
              placeholder={t('mail.searchMail')}
              aria-label={t('mail.searchMail')}
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint md:text-[13px]"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearch('');
                  (e.target as HTMLInputElement).blur();
                  if (query) onSearch('');
                }
              }}
            />
            {search ? (
              <button
                type="button"
                className="grid h-[22px] w-[22px] place-items-center rounded-[5px] bg-surface-2 text-faint hover:text-fg"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSearch('');
                  onSearch('');
                }}
                aria-label={t('mail.clearSearch')}
              >
                <X className="h-[13px] w-[13px]" />
              </button>
            ) : (
              <span className="hidden md:contents">
                <Kbd>/</Kbd>
              </span>
            )}
          </div>
          <button type="button" onClick={onCompose} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-fg md:hidden" aria-label={t('mail.compose')}>
            <SquarePen className="h-[18px] w-[18px]" />
          </button>
        </form>
        {searchOpen && (
          <div className="absolute top-full right-3 left-3 z-20 -mt-1 rounded-[10px] border border-border bg-surface p-1.5 text-[13px] shadow-pop animate-fade-in" onMouseDown={(e) => e.preventDefault()}>
            <div className="px-2 pt-1.5 pb-1 text-[11.5px] font-medium text-faint">{t('mail.searchOperators')}</div>
            {OPERATORS.map(([op, d]) => (
              <button
                key={op}
                type="button"
                onClick={() => {
                  const base = search.trim();
                  setSearch(`${base ? `${base} ` : ''}${op.endsWith(':') ? op : `${op} `}`);
                  searchRef.current?.focus();
                }}
                className="flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-surface-2"
              >
                <span className="min-w-[132px] font-mono text-xs font-medium text-primary-text">{op}</span>
                <span className="truncate text-[12.5px] text-muted">{t(d)}</span>
              </button>
            ))}
            {recent.length > 0 && (
              <>
                <div className="mx-0.5 my-1.5 h-px bg-border" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pt-1 pb-1.5 text-xs text-faint">
                  <Clock className="h-[13px] w-[13px]" />
                  {t('mail.recent')}
                  {recent.map((r, i) => (
                    <span key={r} className="flex items-center gap-2">
                      {i > 0 && <span>·</span>}
                      <button
                        type="button"
                        className="text-muted hover:text-fg"
                        onClick={() => {
                          setSearch(r);
                          runSearch(r);
                        }}
                      >
                        {r}
                      </button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {ids.length || allMatching ? (
        <div className="flex h-10 shrink-0 items-center gap-0.5 border-y border-border bg-primary-soft pr-2 pl-3.5 md:border-t-0">
          <Tick checked={allSelected} indeterminate={!allSelected} onChange={(v) => setSelected(v ? new Set(list.map((t) => t.id)) : new Set())} label={t('mail.selectAll')} className="mr-2" />
          <span className="flex-1 truncate text-[13px] font-semibold text-primary-text">{allMatching ? (total ? t('mail.allSelectedCount', { total }) : t('mail.allSelected')) : t('mail.nSelected', { n: ids.length })}</span>
          <IconButton label={t('mail.archive')} shortcut="E" onClick={() => bulk('archive', {}, t('mail.archived'))} icon={<Archive />} className="h-7 w-7" />
          <IconButton
            label={view === 'trash' ? t('mail.deleteForever') : t('mail.delete')}
            shortcut="#"
            onClick={() => bulk(view === 'trash' ? 'delete' : 'trash', {}, view === 'trash' ? t('mail.deletedForever') : t('mail.movedToTrash'))}
            icon={<Trash2 />}
            className="h-7 w-7"
          />
          <IconButton label={t('mail.reportSpam')} shortcut="!" onClick={() => bulk('spam', {}, t('mail.markedAsSpam'))} icon={<OctagonAlert />} className="h-7 w-7" />
          <IconButton label={t('mail.markRead')} onClick={() => bulk('read')} icon={<MailOpen />} className="h-7 w-7" />
          <IconButton label={t('mail.markUnread')} onClick={() => bulk('unread')} icon={<Mail />} className="h-7 w-7" />
          {view !== 'inbox' && <IconButton label={t('mail.moveToInbox')} onClick={() => bulk('inbox', {}, t('mail.movedToInbox'))} icon={<Inbox />} className="h-7 w-7" />}
          <Menu
            className="w-[250px]"
            trigger={({ onClick, open }) => (
              <button
                type="button"
                onClick={onClick}
                aria-label={t('mail.snooze')}
                className={cn('flex h-7 items-center gap-[3px] rounded-[7px] px-1.5 text-muted hover:text-fg', open && 'bg-surface text-fg shadow-card')}
              >
                <AlarmClock className="h-[15px] w-[15px]" />
                <ChevronDown className="h-3 w-3 text-faint" />
              </button>
            )}
          >
            <MenuLabel>{t('mail.snoozeUntil')}</MenuLabel>
            {snoozePresets().map((p) => (
              <MenuItem key={p.label} onClick={() => bulk('snooze', { until: p.at }, t('mail.snoozed'))} hint={timeHint(p.at)}>
                {t(p.label)}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<CalendarClock />} onClick={() => setPickSnooze(true)}>
              {t('mail.pickDateTime')}
            </MenuItem>
          </Menu>
        </div>
      ) : progress ? (
        <div role="status" className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3.5 text-[13px] text-muted">
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary-text" />
          <span className="truncate">
            {progress.verb} {progress.done.toLocaleString()}
            {progress.total !== null && t('mail.progressOf', { total: progress.total.toLocaleString() })}…
          </span>
        </div>
      ) : (
        // One heading for both layouts: large on phones, a compact list header on desktop.
        <div className="flex shrink-0 items-baseline gap-2.5 px-[18px] pt-1.5 pb-2.5 md:h-10 md:items-center md:border-b md:border-border md:pt-0 md:pr-2.5 md:pb-0 md:pl-3.5">
          <Tick checked={false} onChange={(v) => v && setSelected(new Set(list.map((t) => t.id)))} label={t('mail.selectAll')} className="max-md:hidden" />
          <div className="min-w-0 flex-1 truncate text-xl font-semibold tracking-[-0.02em] md:text-[13px] md:tracking-normal">
            {heading}
            {mailboxName && <span className="text-[13px] font-normal tracking-normal text-faint max-md:ml-2 md:before:content-['_·_']">{mailboxName}</span>}
          </div>
          {(view === 'spam' || view === 'trash') && list.length > 0 && (
            <Button size="xs" variant="ghost" className="hover:text-danger" onClick={() => setConfirmEmpty(true)}>
              {t('mail.emptyView', { view: title })}
            </Button>
          )}
          <IconButton label={t('mail.refresh')} onClick={() => q.refetch()} icon={<RefreshCw className={cn(q.isFetching && 'animate-spin text-primary-text')} />} className="h-7 w-7 max-md:hidden" />
        </div>
      )}

      {(offerAll || allMatching) && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 border-b border-border bg-surface-2 px-3.5 py-2 text-center text-[12.5px] text-muted">
          {allMatching ? (
            <>
              <span>
                {t('mail.allConversationsSelected', { total: total ? `${total} ` : '', view: title })}
              </span>
              <button type="button" className="font-medium text-primary-text hover:underline" onClick={() => setSelected(new Set())}>
                {t('mail.clearSelection')}
              </button>
            </>
          ) : (
            <>
              <span>{t('mail.loadedSelected', { n: list.length.toLocaleString() })}</span>
              <button type="button" className="font-medium text-primary-text hover:underline" onClick={() => setAllMatching(true)}>
                {t('mail.selectAllInView', { total: total ? `${total} ` : '', view: title })}
              </button>
            </>
          )}
        </div>
      )}

      <div ref={container} className="scroll-thin min-h-0 flex-1 overflow-y-auto max-md:border-t max-md:border-border">
        {q.isLoading ? (
          <div>
            {['38%,72%,88%', '30%,64%,80%', '44%,58%,92%', '26%,70%,76%', '40%,52%,84%', '34%,66%,90%', '28%,60%,78%', '42%,74%,86%'].map((w) => {
              const [a, b, c] = w.split(',');
              return (
                <div key={w} className="flex gap-[11px] border-b border-border px-3.5 py-3">
                  <Skeleton className="mt-0.5 h-[15px] w-[15px] rounded-[4px]" />
                  <div className="flex flex-1 flex-col gap-2 pt-[3px]">
                    <div className="flex gap-3">
                      <Skeleton className="h-2.5" style={{ width: a }} />
                      <div className="flex-1" />
                      <Skeleton className="h-2.5 w-11" />
                    </div>
                    <Skeleton className="h-2.5" style={{ width: b }} />
                    <Skeleton className="h-2.5 bg-surface-2" style={{ width: c }} />
                  </div>
                </div>
              );
            })}
            <div className="flex h-11 items-center justify-center gap-2 text-[12.5px] text-faint">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {t('mail.loading')}
            </div>
          </div>
        ) : list.length === 0 ? (
          view === 'search' ? (
            <div className="flex flex-col items-center px-9 pt-[72px] text-center">
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-[14px] bg-surface-2 text-muted">
                <SearchX className="h-[22px] w-[22px]" />
              </div>
              <div className="text-[15px] font-semibold">{t('mail.noResults')}</div>
              <div className="mt-1 text-[13px] text-muted text-pretty">{t('mail.noResultsHint')}</div>
              <div className="mt-5 flex w-full max-w-[300px] flex-col gap-2 rounded-[10px] border border-border bg-surface px-3.5 py-3 text-left text-[12.5px] text-muted">
                {[
                  ['in:anywhere', 'mail.searchOpAnywhere'],
                  ['from:ann', 'mail.searchOpMatchesName'],
                  ['has:attachment', 'mail.searchOpHasAttachment'],
                ].map(([op, d]) => (
                  <div key={op} className="flex gap-2.5">
                    <span className="min-w-24 font-mono text-xs leading-[18px] font-medium text-primary-text">{op}</span>
                    {t(d)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center px-8 pt-24 text-center">
              <div className={cn('mb-4 grid h-12 w-12 place-items-center rounded-[14px]', view === 'inbox' ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')}>
                {view === 'inbox' ? <CircleCheck className="h-[22px] w-[22px]" /> : <Inbox className="h-[22px] w-[22px]" />}
              </div>
              <div className="text-[15px] font-semibold">{view === 'inbox' ? t('mail.inboxZero') : t('mail.nothingHere')}</div>
              {view === 'inbox' && <div className="mt-1 text-[13px] text-muted">{t('mail.newMailHere')}</div>}
            </div>
          )
        ) : (
          <ul>
            {list.map((th, i) => {
              const unread = th.unreadCount > 0;
              const active = activeId === th.id;
              const isSelected = allMatching || selected.has(th.id);
              const participants = view === 'sent' || view === 'drafts' ? participantLabel(th.participants, new Set()) : participantLabel(th.participants, own);
              const first = th.participants.find((p) => !own.has(p.address.toLowerCase())) ?? th.participants[0];
              const strong = unread || active;
              return (
                <li
                  key={th.id}
                  data-index={i}
                  onClick={() => {
                    setFocusIndex(i);
                    onOpen(th);
                  }}
                  className={cn(
                    'group relative flex cursor-pointer gap-3 border-b border-border px-4 py-3 transition-colors md:gap-[11px] md:px-3.5 md:py-2.5',
                    isSelected ? 'bg-[color-mix(in_oklch,var(--primary-soft)_75%,var(--surface))]' : active ? 'bg-primary-soft' : unread ? 'bg-surface hover:bg-surface-2' : 'hover:bg-surface-2',
                    focusIndex === i && !active && 'md:shadow-[inset_0_0_0_2px_var(--ring)]',
                  )}
                >
                  {unread && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                  {/* Mobile: the avatar toggles selection. */}
                  <button
                    type="button"
                    className="shrink-0 md:hidden"
                    aria-label={isSelected ? t('mail.deselect') : t('mail.select')}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(th.id);
                    }}
                  >
                    {isSelected ? (
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-fg">
                        <Check className="h-4 w-4" />
                      </span>
                    ) : (
                      <Avatar name={first?.name ?? ''} address={first?.address ?? ''} size={36} />
                    )}
                  </button>
                  <div className="hidden flex-col items-center gap-[9px] pt-0.5 md:flex">
                    <Tick checked={isSelected} onChange={() => toggle(th.id)} label={t('mail.select')} />
                    <button
                      type="button"
                      aria-label={th.starred ? t('mail.unstar') : t('mail.star')}
                      onClick={(e) => {
                        e.stopPropagation();
                        act([th.id], th.starred ? 'unstar' : 'star');
                      }}
                    >
                      <Star className={cn('h-[15px] w-[15px]', th.starred ? 'fill-[oklch(0.78_0.16_78)] text-[oklch(0.78_0.16_78)]' : 'text-transparent group-hover:text-faint')} />
                    </button>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <div className="flex items-center gap-1.5 text-sm leading-[19px] md:text-[13px]">
                      <span className={cn('min-w-0 flex-1 truncate', unread ? 'font-semibold' : 'font-medium', strong ? 'text-fg' : 'text-muted')}>
                        {th.draftCount > 0 && (
                          <>
                            <span className="font-semibold text-danger">{t('mail.draft')}</span>
                            <span className="text-faint">, </span>
                          </>
                        )}
                        {participants || t('mail.unknownParticipant')}
                        {th.messageCount > 1 && <span className="ml-1.5 text-xs font-normal text-faint">{th.messageCount}</span>}
                      </span>
                      {th.hasAttachments && <Paperclip className="h-[13px] w-[13px] shrink-0 text-faint" />}
                      {th.starred && <Star className="h-3 w-3 shrink-0 fill-[oklch(0.78_0.16_78)] text-[oklch(0.78_0.16_78)] md:hidden" />}
                      <span className={cn('shrink-0 text-xs tabular-nums', unread ? 'font-semibold text-fg' : 'text-faint')}>
                        {listDate(view === 'sent' && th.lastSentAt ? th.lastSentAt : view === 'snoozed' && th.snoozedUntil ? th.snoozedUntil : th.lastMessageAt)}
                      </span>
                    </div>
                    <div className={cn('truncate text-[13.5px] leading-[19px] md:text-[13px]', unread ? 'font-semibold' : 'font-[450]', strong ? 'text-fg' : 'text-muted')}>{th.subject || t('mail.noSubject')}</div>
                    <div className="flex min-w-0 items-center gap-[5px] text-[13px] leading-[19px]">
                      {th.labels.slice(0, 3).map((id) => {
                        const l = labelsById.get(id);
                        return l ? (
                          <span key={id} className="label-chip inline-flex h-[18px] shrink-0 items-center rounded-[5px] px-1.5 text-[11.5px] font-medium" style={labelChip(l.color)}>
                            {l.name}
                          </span>
                        ) : null;
                      })}
                      <span className="min-w-0 flex-1 truncate text-faint">{th.snippet}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={sentinel} className="h-8" />
        {q.isFetchingNextPage && (
          <div className="flex items-center justify-center gap-2 pb-4 text-[12.5px] text-faint">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            {t('mail.loading')}
          </div>
        )}
      </div>

      <PickTimeDialog
        open={pickSnooze}
        onClose={() => setPickSnooze(false)}
        title={t('mail.snoozeUntil')}
        description={t('mail.snoozeDesc')}
        confirmLabel={t('mail.snooze')}
        onPick={(at) => bulk('snooze', { until: at }, t('mail.snoozed'))}
      />
      <ConfirmDialog
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        icon={<Trash2 />}
        danger
        title={t('mail.emptyViewConfirm', { view: title })}
        confirmLabel={t('mail.deleteForever')}
        onConfirm={() => {
          setConfirmEmpty(false);
          // Everything in the view, not only the loaded rows.
          onBulk('delete', {}, t('mail.deletedForever'), true);
        }}
      >
        {emptyCount ? t('mail.emptyConfirmCount', { n: emptyCount, view: title }) : t('mail.emptyConfirmAll', { view: title })}
      </ConfirmDialog>
    </div>
  );
}
