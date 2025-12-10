import { AutocompleteTextarea } from './AutocompleteTextarea';
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Sparkles, Share2 } from 'lucide-react';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getQuoteForDay, getAffirmationForDay, formatDisplayDate } from '@/lib/gratitudeUtils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useGratitudeEntry } from '@/hooks/useGratitudeEntries';
import { useToast } from '@/hooks/useToast';
import LoginDialog from './auth/LoginDialog';

interface DayDetailDialogProps {
  day: DayInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DayDetailDialog({ day, open, onOpenChange }: DayDetailDialogProps) {
  const [gratitudeText, setGratitudeText] = useState('');
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const { user } = useCurrentUser();
  const { mutate: createEvent, isPending } = useNostrPublish();
  const { mutate: publishNote, isPending: isPublishingNote } = useNostrPublish();
  const { toast } = useToast();

  // Fetch existing entry for this day (only for display in past days, not for editing)
  const { data: existingEntry } = useGratitudeEntry(
    user?.pubkey,
    day?.dateString || ''
  );

  // Always start with a fresh empty text box when dialog opens or day changes
  useEffect(() => {
    if (open) {
      setGratitudeText('');
    }
  }, [day, open]);

  if (!day) return null;

  const quote = getQuoteForDay(day.dayOfYear);
  const affirmation = getAffirmationForDay(day.dayOfYear);
  const isPastDay = day.isPast;

  const handleSave = () => {
    if (!user) {
      setShowLoginDialog(true);
      return;
    }

    if (!gratitudeText.trim()) {
      toast({
        title: 'Empty entry',
        description: 'Please write something before saving.',
        variant: 'destructive',
      });
      return;
    }

    const timestamp = Math.floor(day.date.getTime() / 1000);

    createEvent(
      {
        kind: 36669,
        content: gratitudeText.trim(),
        tags: [
          ['d', day.dateString],
          ['published_at', String(timestamp)],
          ['day', String(day.dayOfYear)],
          ['alt', `Daily reflection entry for ${formatDisplayDate(day.date)} (Day ${day.dayOfYear})`],
        ],
      },
      {
        onSuccess: () => {
          toast({
            title: 'Reflection saved! ✨',
            description: 'Your reflection has been saved.',
          });
          setGratitudeText(''); // Reset text box for a fresh entry
        },
        onError: (error) => {
          toast({
            title: 'Failed to save',
            description: error.message || 'Please try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleShareToNostr = () => {
    if (!user) {
      setShowLoginDialog(true);
      return;
    }

    if (!gratitudeText.trim()) {
      toast({
        title: 'No reflection to share',
        description: 'Please write something before sharing.',
        variant: 'destructive',
      });
      return;
    }

    const timestamp = Math.floor(day.date.getTime() / 1000);
    const trimmedText = gratitudeText.trim();

    // First, save as kind 36669
    createEvent(
      {
        kind: 36669,
        content: trimmedText,
        tags: [
          ['d', day.dateString],
          ['published_at', String(timestamp)],
          ['day', String(day.dayOfYear)],
          ['alt', `Daily reflection entry for ${formatDisplayDate(day.date)} (Day ${day.dayOfYear})`],
        ],
      },
      {
        onSuccess: () => {
          // After saving kind 36669, post as kind 1 note
          // Rotate through day emojis based on day number
          const dayEmojis = ["☀️", "🌿", "🌅", "🌞", "🌻", "⭐️"];
          const dayEmoji = dayEmojis[(day.dayOfYear - 1) % dayEmojis.length];

          // Format the content for the kind 1 note
          const noteContent = `Day ${day.dayOfYear} ${dayEmoji}

✨ "${quote.text}"
— ${quote.author}

💫 "${affirmation}"

🙏 ${trimmedText}

https://gratefulday.space`;

          publishNote(
            {
              kind: 1,
              content: noteContent,
              tags: [
                ['t', 'gratefulday'],
                ['t', 'gratefuldayspace'],
                ['d', day.dateString],
                ['day', String(day.dayOfYear)],
              ],
            },
            {
              onSuccess: () => {
                toast({
                  title: 'Shared to Nostr! 🌟',
                  description: 'Your reflection has been saved and posted to gratefulday.space.',
                });
                setGratitudeText(''); // Reset text box for a fresh entry
              },
              onError: (error) => {
                toast({
                  title: 'Saved but failed to share',
                  description: error.message || 'Your reflection was saved but could not be posted.',
                  variant: 'destructive',
                });
                setGratitudeText(''); // Reset text box even if share failed
              },
            }
          );
        },
        onError: (error) => {
          toast({
            title: 'Failed to save',
            description: error.message || 'Please try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Capture Your Gratitude
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

            {/* Gratitude Entry */}
            {isPastDay ? (
              /* Past Day - Read Only View */
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground mb-2">
                        {existingEntry ? 'Your Reflection' : 'No Reflection'}
                      </p>
                      {existingEntry ? (
                        <div className="space-y-2">
                          <p className="text-base text-foreground whitespace-pre-wrap break-words">
                            {existingEntry.content}
                          </p>
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
            ) : (
              /* Today - Editable */
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground block">
                    Write a moment of gratitude from today.
                  </label>
                  <p className="text-sm text-muted-foreground">
                    It can be a person, a moment, or something simple.
                  </p>
                  {!user && (
                    <p className="text-xs text-muted-foreground">
                      Login to save your reflection
                    </p>
                  )}
                </div>
                <AutocompleteTextarea
                  value={gratitudeText}
                  onChange={setGratitudeText}
                />
                <p className="text-xs text-muted-foreground">
                  {gratitudeText.length} characters
                </p>
              </div>
            )}

            {/* Action Buttons */}
            {isPastDay ? (
              /* Past Day - Only Close Button */
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </div>
            ) : (
              /* Today - Full Action Buttons */
              <div className="flex flex-col sm:flex-row gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="flex-1 sm:flex-initial order-2 sm:order-1"
                >
                  Close
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isPending || isPublishingNote || !gratitudeText.trim()}
                  className="min-w-[100px] order-1 sm:order-2"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleShareToNostr}
                  disabled={isPending || isPublishingNote || !gratitudeText.trim()}
                  variant="default"
                  className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 order-3"
                >
                  {isPending || isPublishingNote ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {isPending ? 'Saving...' : 'Sharing...'}
                    </>
                  ) : (
                    <>
                      <Share2 className="h-4 w-4 mr-2" />
                      Share to Nostr
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <LoginDialog
        isOpen={showLoginDialog}
        onClose={() => setShowLoginDialog(false)}
        onLogin={() => {
          setShowLoginDialog(false);
          toast({
            title: 'Welcome! 👋',
            description: 'You can now save your reflections.',
          });
        }}
      />
    </>
  );
}
