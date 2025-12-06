import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, Sparkles } from 'lucide-react';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getQuoteForDay, getPromptForDay, formatDisplayDate } from '@/lib/gratitudeUtils';
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
  const { toast } = useToast();

  // Fetch existing entry for this day
  const { data: existingEntry, refetch } = useGratitudeEntry(
    user?.pubkey,
    day?.dateString || ''
  );

  // Update local state when existing entry loads
  useEffect(() => {
    if (existingEntry) {
      setGratitudeText(existingEntry.content);
    } else {
      setGratitudeText('');
    }
  }, [existingEntry, day]);

  if (!day) return null;

  const quote = getQuoteForDay(day.dayOfYear);
  const prompt = getPromptForDay(day.dayOfYear);

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
          ['alt', `Daily gratitude entry for ${formatDisplayDate(day.date)} (Day ${day.dayOfYear})`],
        ],
      },
      {
        onSuccess: () => {
          toast({
            title: 'Gratitude saved! ✨',
            description: 'Your reflection has been recorded.',
          });
          refetch();
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
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Day {day.dayOfYear} of 365
            </DialogTitle>
            <DialogDescription className="text-base">
              {formatDisplayDate(day.date)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
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

            {/* Prompt Section */}
            <div className="p-5 rounded-lg bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/20 dark:to-pink-950/20 border border-rose-200 dark:border-rose-800">
              <p className="text-sm font-medium text-rose-900 dark:text-rose-100 mb-2">
                Gratitude Prompt
              </p>
              <p className="text-base text-rose-800 dark:text-rose-200">
                {prompt}
              </p>
            </div>

            {/* Gratitude Entry */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground block">
                Your Reflection
                {!user && (
                  <span className="text-xs text-muted-foreground ml-2">
                    (Login to save)
                  </span>
                )}
              </label>
              <Textarea
                placeholder="What are you grateful for today? Write your thoughts here..."
                value={gratitudeText}
                onChange={(e) => setGratitudeText(e.target.value)}
                rows={6}
                className="resize-none text-base"
              />
              <p className="text-xs text-muted-foreground">
                {gratitudeText.length} characters
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                onClick={handleSave}
                disabled={isPending || !gratitudeText.trim()}
                className="min-w-[100px]"
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
            </div>

            {existingEntry && (
              <p className="text-xs text-muted-foreground text-center">
                Last updated: {new Date(existingEntry.created_at * 1000).toLocaleString()}
              </p>
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
            description: 'You can now save your gratitude entries.',
          });
        }}
      />
    </>
  );
}
