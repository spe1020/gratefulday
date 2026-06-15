import type { NostrEvent } from '@nostrify/nostrify';
import { useReactions } from '@/hooks/useReactions';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { CURATED_REACTIONS } from '@/lib/reactionUtils';
import { cn } from '@/lib/utils';

interface ReactionBarProps {
  /** The event being reacted to. Tags are kind-routed inside useReactions. */
  target: NostrEvent;
  className?: string;
}

/**
 * Curated 🙏 🌱 ✨ reactions for one event. Mounts on both the journal card
 * (36669) and the tagged-note card (kind 1); useReactions picks the correct
 * NIP-25 tag shape from the target's kind.
 */
export function ReactionBar({ target, className }: ReactionBarProps) {
  const { user } = useCurrentUser();
  const { counts, own, react } = useReactions(target);

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {CURATED_REACTIONS.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const reacted = own[emoji];
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => react(emoji)}
            disabled={!user}
            aria-pressed={reacted}
            aria-label={`React ${emoji}${count > 0 ? ` (${count})` : ''}`}
            title={user ? `React ${emoji}` : 'Log in to react'}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors',
              'disabled:cursor-default disabled:opacity-60',
              reacted
                ? 'border-amber-300 bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30'
                : 'border-transparent bg-muted hover:bg-muted-foreground/10'
            )}
          >
            <span aria-hidden="true">{emoji}</span>
            {count > 0 && (
              <span
                className={cn(
                  'text-xs tabular-nums',
                  reacted ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
