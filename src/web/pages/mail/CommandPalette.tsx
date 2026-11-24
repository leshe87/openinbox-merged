import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import {
  Activity,
  AlarmClock,
  Archive,
  ArrowDown,
  ArrowUp,
  AtSign,
  CalendarClock,
  CornerDownLeft,
  FileText,
  Globe,
  Inbox,
  LayoutGrid,
  Mails,
  OctagonAlert,
  Plug,
  Search,
  Send,
  Settings,
  SquarePen,
  Star,
  Trash2,
  UserRound,
  UsersRound,
  Waypoints,
} from 'lucide-react';
import { useIsAdmin } from '../../lib/session';
import { cn } from '../../lib/utils';
import { Kbd } from '../../components/ui/misc';
import { useMailboxes } from './data';
import { labelDot } from './labels';
import { useT } from '../../lib/i18n';

interface Item {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  keys?: string[];
  run: () => void;
}

const FOLDER_ITEMS: [string, string, ReactNode, string[]?][] = [
  ['inbox', 'palette.inbox', <Inbox />, ['G', 'I']],
  ['starred', 'palette.starred', <Star />],
  ['snoozed', 'palette.snoozed', <AlarmClock />, ['G', 'Z']],
  ['sent', 'palette.sent', <Send />, ['G', 'S']],
  ['drafts', 'palette.drafts', <FileText />, ['G', 'D']],
  ['scheduled', 'palette.scheduled', <CalendarClock />],
  ['archive', 'palette.archive', <Archive />, ['G', 'A']],
  ['allmail', 'palette.allMail', <Mails />],
  ['spam', 'palette.spam', <OctagonAlert />, ['G', 'P']],
  ['trash', 'palette.trash', <Trash2 />, ['G', 'T']],
];

// Ctrl/⌘ K anywhere in the app. Mail actions are handed to the mail page through window events,
// or open the mail page when it isn't showing.
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = useIsAdmin();
  const { data: mailboxes = [] } = useMailboxes();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const inMail = location.pathname.startsWith('/mail');
  const currentBox = /^\/mail\/([^/]+)/.exec(location.pathname)?.[1] ?? 'all';

  useEffect(() => {
    setTimeout(() => input.current?.focus(), 0);
  }, []);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to);
    const mailEvent = (name: string, fallback: string) => () => (inMail ? window.dispatchEvent(new CustomEvent(name)) : navigate(fallback));
    const multi = mailboxes.length > 1;
    const out: Item[] = [
      { id: 'compose', label: t('palette.compose'), group: t('palette.actions'), icon: <SquarePen />, keys: ['C'], run: mailEvent('oi:compose', '/mail/all/inbox?compose') },
      { id: 'search', label: t('palette.searchMail'), group: t('palette.actions'), icon: <Search />, keys: ['/'], run: mailEvent('oi:search', '/mail/all/inbox') },
      ...FOLDER_ITEMS.map(([v, label, icon, keys]) => ({ id: `go-${v}`, label: t(label), group: t('palette.goTo'), icon, keys, run: go(`/mail/${inMail ? currentBox : 'all'}/${v}`) })),
      ...(multi ? mailboxes.map((m) => ({ id: `mb-${m.id}`, label: m.address, group: t('palette.switchInbox'), icon: m.kind === 'shared' ? <UsersRound /> : <AtSign />, run: go(`/mail/${m.id}/inbox`) })) : []),
      ...mailboxes.flatMap((m) =>
        m.labels.map((l) => ({
          id: `lb-${l.id}`,
          label: multi ? `${l.name} · ${m.address}` : l.name,
          group: t('palette.labels'),
          icon: <span className="mx-[3px] block h-2 w-2 rounded-full" style={labelDot(l.color)} />,
          run: go(`/mail/${multi ? m.id : 'all'}/label-${l.id}`),
        })),
      ),
      { id: 'settings-mail', label: t('menu.mailSettings'), group: t('palette.settings'), icon: <Settings />, run: go('/settings/signature') },
      { id: 'settings-account', label: t('menu.account'), group: t('palette.settings'), icon: <UserRound />, run: go('/settings/profile') },
    ];
    if (isAdmin) {
      const admin: [string, string, ReactNode][] = [
        ['', 'palette.adminDashboard', <LayoutGrid />],
        ['/inboxes', 'palette.manageInboxes', <Inbox />],
        ['/users', 'palette.manageUsers', <UsersRound />],
        ['/domains', 'palette.manageDomains', <Globe />],
        ['/integrations', 'palette.integrations', <Plug />],
        ['/mailflow', 'palette.mailFlow', <Waypoints />],
        ['/activity', 'palette.activityLog', <Activity />],
        ['/settings', 'palette.instanceSettings', <Settings />],
      ];
      for (const [path, label, icon] of admin) out.push({ id: `admin${path}`, label: t(label), group: t('palette.admin'), icon, run: go(`/admin${path}`) });
    }
    return out;
  }, [mailboxes, isAdmin, navigate, inMail, currentBox, t]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    const base = items.filter((i) => i.label.toLowerCase().includes(term) || i.group.toLowerCase().includes(term));
    const search: Item = { id: 'search-q', label: t('palette.searchFor', { q: q.trim() }), group: t('palette.search'), icon: <Search />, run: () => navigate(`/mail/${inMail ? currentBox : 'all'}/search?q=${encodeURIComponent(q.trim())}`) };
    return [search, ...base];
  }, [items, q, navigate, inMail, currentBox, t]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (i: Item) => {
    onClose();
    i.run();
  };
  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim p-4 pt-[12vh] animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[620px] overflow-hidden rounded-[14px] border border-border bg-surface shadow-pop animate-pop-in">
        <div className="flex h-[54px] items-center gap-3 border-b border-border px-[18px]">
          <Search className="h-[17px] w-[17px] text-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && filtered[active]) choose(filtered[active]);
              else if (e.key === 'Escape') onClose();
            }}
            placeholder={t('palette.typeCommand')}
            className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={list} className="scroll-thin max-h-[52vh] overflow-y-auto px-2 pt-1.5 pb-2">
          {filtered.map((i, idx) => {
            const header = i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            const on = idx === active;
            return (
              <Fragment key={i.id}>
                {header && <div className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium text-faint">{header}</div>}
                <button
                  type="button"
                  data-index={idx}
                  onMouseMove={() => setActive(idx)}
                  onClick={() => choose(i)}
                  className={cn('flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13.5px]', on ? 'bg-primary-soft text-primary-text' : 'text-fg')}
                >
                  <span className={cn('flex [&>svg]:h-4 [&>svg]:w-4', on ? 'text-primary-text' : 'text-faint')}>{i.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{i.label}</span>
                  {i.keys && (
                    <span className="flex gap-1">
                      {i.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  )}
                </button>
              </Fragment>
            );
          })}
          {!filtered.length && <div className="px-3 py-6 text-center text-[13px] text-muted">{t('palette.noMatch')}</div>}
        </div>
        <div className="flex h-10 items-center gap-4 border-t border-border bg-surface-2 px-[18px] text-xs text-faint">
          <span className="flex items-center gap-1">
            <ArrowUp className="h-3 w-3" />
            <ArrowDown className="h-3 w-3" />
            {t('palette.navigate')}
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" />
            {t('palette.select')}
          </span>
          <span className="ml-auto hidden sm:inline">{t('palette.opensAnywhere')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Keys, with "or", "then" and "/" shown as words between them. Labels are i18n
// keys (see lib/i18n.tsx), translated where they render.
export const SHORTCUTS: [string[], string][] = [
  [['c'], 'shortcuts.compose'],
  [['/'], 'shortcuts.search'],
  [['Ctrl/⌘ K'], 'shortcuts.palette'],
  [['j', '/', 'k'], 'shortcuts.nextPrev'],
  [['o', 'or', 'Enter'], 'shortcuts.open'],
  [['u', 'or', 'Esc'], 'shortcuts.back'],
  [['e'], 'shortcuts.archive'],
  [['#'], 'shortcuts.trash'],
  [['!'], 'shortcuts.spam'],
  [['s'], 'shortcuts.star'],
  [['x'], 'shortcuts.select'],
  [['Shift+I', '/', 'Shift+U'], 'shortcuts.readUnread'],
  [['r', '/', 'a', '/', 'f'], 'shortcuts.reply'],
  [['g', 'then', 'i', 's', 'd', 'a', 't'], 'shortcuts.goto'],
  [['Ctrl/⌘ Enter'], 'shortcuts.send'],
  [['?'], 'shortcuts.help'],
];

export function KeyCombo({ keys }: { keys: string[] }) {
  const t = useT();
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) =>
        keys.length > 1 && (k === 'or' || k === 'then' || k === '/') ? (
          <span key={i} className="px-px text-[11.5px] text-faint">
            {k === 'or' ? t('shortcuts.or') : k === 'then' ? t('shortcuts.then') : k}
          </span>
        ) : (
          <Kbd key={i} className="h-5 min-w-5 rounded-[5px] px-1.5 text-[11.5px] text-fg">
            {k}
          </Kbd>
        ),
      )}
    </span>
  );
}
