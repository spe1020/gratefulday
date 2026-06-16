import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Bell, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { timeAgo } from '@/lib/timeUtils';
import type { NotificationGroup, NotificationTarget } from '@/lib/notifications';

interface NotificationsViewProps {
  groups: NotificationGroup[];
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
  /** Called after a row navigates (e.g. to close the sheet). */
  onNavigated?: () => void;
}

/** Route a notification's target to the right NIP-19 page. Profile zaps → none. */
function targetHref(target: NotificationTarget | undefined): string | null {
  if (!target) return null;
  try {
    if (target.kind === 36669) {
      const [, pubkey, identifier] = target.ref.split(':');
      if (!pubkey || identifier === undefined) return null;
      return `/${nip19.naddrEncode({ kind: 36669, pubkey, identifier })}`;
    }
    return `/${nip19.noteEncode(target.ref)}`;
  } catch {
    return null;
  }
}

function targetLabel(target: NotificationTarget | undefined): string {
  if (!target) return 'you';
  return target.kind === 36669 ? 'your entry' : 'your note';
}

function truncate(text: string, max = 80): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Public-only verb phrase for what the actor(s) did — never the target body.
 * Reads as "{actor} {verb} to {target}", so each ends without the preposition.
 */
function actionVerb(group: NotificationGroup): string {
  switch (group.type) {
    case 'reaction': {
      const emojis = [...new Set(group.items.map((i) => i.emoji).filter(Boolean))].join('');
      return `reacted ${emojis}`.trim();
    }
    case 'zap': {
      const sats = group.items.reduce((sum, i) => sum + (i.amountSats ?? 0), 0);
      return sats > 0 ? `zapped ${sats.toLocaleString()} sats` : 'sent a zap';
    }
    case 'comment':
      return 'commented';
    case 'reply':
      return 'replied';
  }
}

/** Quoted comment/reply text to show on a second line, or null. */
function snippetOf(group: NotificationGroup): string | null {
  if (group.type !== 'comment' && group.type !== 'reply') return null;
  const text = truncate(group.items[0].snippet ?? '');
  return text ? text : null;
}

function NotificationRow({
  group,
  onNavigated,
}: {
  group: NotificationGroup;
  onNavigated?: () => void;
}) {
  const navigate = useNavigate();
  const firstActor = group.actors[0];
  const author = useAuthor(firstActor);
  const metadata = author.data?.metadata;
  const name = metadata?.name || genUserName(firstActor);
  const others = group.actors.length - 1;
  const actorLabel = others > 0 ? `${name} +${others} other${others === 1 ? '' : 's'}` : name;

  const href = targetHref(group.target);
  const onClick = () => {
    if (!href) return;
    navigate(href);
    onNavigated?.();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!href}
      className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
    >
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={metadata?.picture} alt={name} />
        <AvatarFallback className="bg-gradient-to-br from-amber-400 to-orange-500 text-white text-xs">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-foreground/90 break-words">
          <span className="font-semibold">{actorLabel}</span> {actionVerb(group)} to{' '}
          <span className="text-muted-foreground">{targetLabel(group.target)}</span>
        </p>
        {snippetOf(group) && (
          <p className="text-muted-foreground italic break-words line-clamp-2">
            “{snippetOf(group)}”
          </p>
        )}
        <p className="text-xs text-muted-foreground">{timeAgo(group.latestAt)}</p>
      </div>
    </button>
  );
}

export function NotificationsView({
  groups,
  isLoading,
  isError,
  onRefresh,
  onNavigated,
}: NotificationsViewProps) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12 px-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">Couldn't load notifications.</p>
        <Button variant="outline" size="sm" onClick={onRefresh} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="py-12 px-6 text-center space-y-3">
        <div className="mx-auto inline-flex p-4 rounded-full bg-muted">
          <Bell className="h-7 w-7 text-muted-foreground" />
        </div>
        <p className="font-medium">No notifications yet</p>
        <p className="text-sm text-muted-foreground">
          Reactions, zaps, and replies to your gratitude will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {groups.map((group) => (
        <NotificationRow key={group.key} group={group} onNavigated={onNavigated} />
      ))}
    </div>
  );
}
