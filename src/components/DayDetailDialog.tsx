import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, Sparkles, Trash2 } from 'lucide-react';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getQuoteForDay, getAffirmationForDay, formatDisplayDate } from '@/lib/gratitudeUtils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGratitudeEntry } from '@/hooks/useGratitudeEntries';
import { useDeleteGratitudeEntry } from '@/hooks/useDeleteGratitudeEntry';
import { useDecryptedEntry } from '@/hooks/useDecryptedEntry';
import { splitNotes } from '@/lib/entryNotes';
import { useToast } from '@/hooks/useToast';

interface DayDetailDialogProps {
  day: DayInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Read-only look back at a past day: its quote, affirmation, and whatever
 * reflection was recorded (with delete for the owner). Today is never viewed
 * here — the journal page's inline GratitudeComposer owns editing today.
 */
export function DayDetailDialog({ day, open, onOpenChange }: DayDetailDialogProps) {
  const { user } = useCurrentUser();
  const { mutate: deleteEntry, isPending: isDeleting } = useDeleteGratitudeEntry();
  const { toast } = useToast();

  // Fetch the existing entry for this day (display only).
  const { data: existingEntry } = useGratitudeEntry(
    user?.pubkey,
    day?.dateString || ''
  );
  const {
    content: entryContent,
    isEncrypted: entryIsEncrypted,
    isDecrypting,
    decryptError,
  } = useDecryptedEntry(existingEntry);

  if (!day) return null;

  const quote = getQuoteForDay(day.dayOfYear);
  const affirmation = getAffirmationForDay(day.dayOfYear);
  const readOnlyNotes = splitNotes(entryContent);

  const handleDeleteEntry = () => {
    if (!existingEntry) return;

    deleteEntry(existingEntry, {
      onSuccess: () => {
        toast({
          title: 'Deletion requested',
          description:
            'Your relays were asked to remove this entry. Removal is best-effort and copies may persist.',
        });
        onOpenChange(false);
      },
      onError: (error) => {
        toast({
          title: 'Failed to request deletion',
          description: error.message || 'Please try again.',
          variant: 'destructive',
        });
      },
    });
  };

  const canDelete = !!existingEntry && !!user && existingEntry.pubkey === user.pubkey;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            A Look Back
          </DialogTitle>
          <DialogDescription className="text-base">
            Day {day.dayOfYear} of 365 · {formatDisplayDate(day.date)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-8 sm:space-y-10 py-4">
          {/* Quote Section */}
          <div className="p-6 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-1" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Daily Wisdom
                </p>
                <p className="text-base italic text-amber-800 dark:text-amber-200">
                  "{quote.text}"
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  — {quote.author}
                </p>
              </div>
            </div>
          </div>

          {/* Affirmation Section */}
          <div className="p-5 rounded-lg bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/20 dark:to-pink-950/20 border border-rose-200 dark:border-rose-800">
            <p className="text-sm font-medium text-rose-900 dark:text-rose-100 mb-2">
              Daily Affirmation
            </p>
            <p className="text-base italic text-rose-800 dark:text-rose-200">
              "{affirmation}"
            </p>
          </div>

          {/* Recorded Reflection - Read Only */}
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-medium text-foreground">
                      {existingEntry ? 'Your Reflection' : 'No Reflection'}
                    </p>
                    {entryIsEncrypted && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        <Lock className="h-3 w-3" />
                        Private
                      </span>
                    )}
                  </div>
                  {existingEntry ? (
                    <div className="space-y-2">
                      {isDecrypting ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Decrypting…
                        </p>
                      ) : decryptError ? (
                        <p className="text-sm text-muted-foreground italic">
                          🔒 Encrypted entry — your current signer can't
                          decrypt it.
                        </p>
                      ) : (
                        /* One card per note, read-only. */
                        <div className="space-y-3">
                          {readOnlyNotes.map((note, i) => (
                            <div
                              key={i}
                              className="rounded-lg border border-border/60 bg-muted/40 p-3"
                            >
                              <p className="text-base text-foreground whitespace-pre-wrap break-words">
                                {note}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Last updated: {new Date(existingEntry.created_at * 1000).toLocaleString()}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      No reflection was recorded for this day.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    disabled={isDeleting}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    {isDeleting ? 'Deleting…' : 'Delete entry'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This sends a deletion request to your relays. Most relays
                      honor it, but deletion on a decentralized network is
                      best-effort and copies may persist.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteEntry}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Request deletion
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="ml-auto"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
