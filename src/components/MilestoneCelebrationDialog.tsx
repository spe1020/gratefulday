import { useEffect, useState } from 'react';
import { Flame, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useStreaks } from '@/hooks/useStreaks';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { getReachedMilestones } from '@/lib/streakUtils';
import {
  hasMilestoneBeenCelebrated,
  markMilestonesCelebratedUpTo,
} from '@/lib/milestoneStore';

const MILESTONE_COPY: Record<number, { title: string; message: string }> = {
  7: {
    title: 'One full week!',
    message:
      "Seven days of noticing the good. You've planted a habit — keep watering it.",
  },
  14: {
    title: 'Two weeks strong!',
    message:
      'Fourteen days in a row. Gratitude is becoming part of your rhythm.',
  },
  30: {
    title: 'A whole month!',
    message:
      "Thirty consecutive days of reflection. What felt like effort is becoming who you are.",
  },
  50: {
    title: 'Fifty days!',
    message:
      'Half a hundred days of gratitude, one day at a time. That is real dedication.',
  },
  100: {
    title: 'One hundred days!',
    message:
      'A hundred days of pausing to appreciate your life. Few people ever get here.',
  },
  200: {
    title: 'Two hundred days!',
    message:
      'Two hundred days without missing one. Your gratitude practice is unshakeable.',
  },
  365: {
    title: 'A full year!',
    message:
      'Every single day for a year. You have shaped an entire year with gratitude.',
  },
};

const CONFETTI_COLORS = ['#fbbf24', '#fb923c', '#fb7185', '#f59e0b', '#f97316'];

/**
 * Fires once when the current streak reaches a milestone that hasn't been
 * celebrated on this device. Only the highest un-celebrated milestone shows
 * a dialog; all lower ones are marked celebrated in the same write so a new
 * device with a long streak sees one celebration, not seven.
 */
export function MilestoneCelebrationDialog() {
  const { user } = useCurrentUser();
  const { current, total, isLoading } = useStreaks();
  const { mutate: publish, isPending } = useNostrPublish();
  const { toast } = useToast();
  const [milestone, setMilestone] = useState<number | null>(null);

  const pubkey = user?.pubkey;

  useEffect(() => {
    // Gate on a settled, non-empty result so the loading transition
    // (entries briefly empty) can't misfire or mark anything.
    if (!pubkey || isLoading || total === 0) return;

    const pending = getReachedMilestones(current).filter(
      (m) => !hasMilestoneBeenCelebrated(pubkey, m)
    );
    if (pending.length === 0) return;

    const highest = pending[pending.length - 1];
    // Mark immediately (sharing is opt-in; closing without sharing keeps it
    // celebrated) so the effect can't re-fire on later renders.
    markMilestonesCelebratedUpTo(pubkey, highest);
    setMilestone(highest);
  }, [pubkey, isLoading, total, current]);

  const copy = milestone !== null ? MILESTONE_COPY[milestone] : null;

  const handleShare = () => {
    if (milestone === null) return;
    publish(
      {
        kind: 1,
        content: `Day streak milestone: ${milestone} days of gratitude 🔥\n\nhttps://gratefulday.space`,
        tags: [['t', 'gratefulday']],
      },
      {
        onSuccess: () => {
          toast({ title: 'Shared to Nostr', description: 'Your milestone is out in the world. 🔥' });
          setMilestone(null);
        },
        onError: () => {
          toast({
            title: 'Share failed',
            description: 'Could not publish to relays. Your milestone is still saved.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <Dialog
      open={milestone !== null}
      onOpenChange={(open) => {
        if (!open) setMilestone(null);
      }}
    >
      <DialogContent className="sm:max-w-[420px] overflow-hidden">
        {copy && milestone !== null && (
          <>
            {/* Confetti burst — same CSS-only pattern as TodayHero */}
            <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
              {[...Array(24)].map((_, i) => {
                const angle = (i / 24) * 2 * Math.PI;
                const distance = 90 + (i % 3) * 60;
                return (
                  <div
                    key={i}
                    className="absolute w-2 h-2 rounded-full animate-milestone-confetti"
                    style={{
                      left: '50%',
                      top: '35%',
                      backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                      animationDelay: `${(i % 6) * 0.08}s`,
                      ['--tx' as string]: `${Math.cos(angle) * distance}px`,
                      ['--ty' as string]: `${Math.sin(angle) * distance}px`,
                    }}
                  />
                );
              })}
            </div>

            <div className="relative z-10">
              <DialogHeader className="items-center text-center space-y-3 pt-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40 border-2 border-amber-300 dark:border-amber-700">
                  <Flame className="h-8 w-8 text-orange-500 dark:text-orange-400 fill-orange-400/40 dark:fill-orange-500/30" />
                </div>
                <DialogTitle className="text-2xl text-amber-700 dark:text-amber-300">
                  {copy.title}
                </DialogTitle>
                <DialogDescription className="text-base text-foreground/80">
                  {copy.message}
                </DialogDescription>
              </DialogHeader>

              <p className="text-center text-sm font-semibold text-amber-600 dark:text-amber-400 mt-4">
                🔥 {milestone} day streak
              </p>

              <div className="flex flex-col gap-2 mt-6">
                <Button
                  onClick={handleShare}
                  disabled={isPending}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {isPending ? 'Sharing…' : 'Share to Nostr'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setMilestone(null)}
                  className="w-full text-muted-foreground"
                >
                  Keep it to myself
                </Button>
              </div>
            </div>

            <style>{`
              @keyframes milestone-confetti {
                0% {
                  opacity: 1;
                  transform: translate(0, 0) scale(1);
                }
                100% {
                  opacity: 0;
                  transform: translate(var(--tx), var(--ty)) scale(0);
                }
              }

              .animate-milestone-confetti {
                animation: milestone-confetti 1.4s ease-out forwards;
              }
            `}</style>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
