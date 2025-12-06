import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useGratitudeGift } from '@/hooks/useGratitudeGift';
import { Loader2 } from 'lucide-react';

interface GratitudeGiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SAT_AMOUNTS = [21, 100, 210, 500] as const;
const RANDOM_AMOUNT = 'random' as const;
const CUSTOM_AMOUNT = 'custom' as const;

type AmountOption = typeof SAT_AMOUNTS[number] | typeof RANDOM_AMOUNT | typeof CUSTOM_AMOUNT;

const DEFAULT_MESSAGE = "A small gift of gratitude from someone who appreciates you today. 💜";

export function GratitudeGiftModal({ open, onOpenChange }: GratitudeGiftModalProps) {
  const [selectedAmount, setSelectedAmount] = useState<AmountOption>(100);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [customMessage, setCustomMessage] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState(false);
  const { sendGratitudeGift, isSending } = useGratitudeGift();

  const handleSend = async () => {
    let amount: number;
    
    if (selectedAmount === RANDOM_AMOUNT) {
      // Random amount between 21 and 500
      const amounts = [21, 100, 210, 500];
      amount = amounts[Math.floor(Math.random() * amounts.length)];
    } else if (selectedAmount === CUSTOM_AMOUNT) {
      // Custom amount
      const parsed = parseInt(customAmount, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return; // Invalid amount
      }
      amount = parsed;
    } else {
      amount = selectedAmount;
    }

    // Use custom message if provided, otherwise use default
    const message = customMessage.trim() || DEFAULT_MESSAGE;

    const success = await sendGratitudeGift(amount, message);
    if (success) {
      setShowSuccess(true);
    }
  };

  const handleClose = () => {
    setShowSuccess(false);
    setSelectedAmount(100);
    setCustomAmount('');
    setCustomMessage('');
    onOpenChange(false);
  };

  const canSend = () => {
    if (selectedAmount === CUSTOM_AMOUNT) {
      const parsed = parseInt(customAmount, 10);
      return !isNaN(parsed) && parsed > 0;
    }
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        {!showSuccess ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">
                Release a Gratitude Gift
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Body copy */}
              <div className="space-y-4 text-sm text-foreground leading-relaxed">
                <p>
                  Gratitude grows when it's shared.
                </p>
                <p>
                  When you send a gratitude gift, a small amount of sats is anonymously sent to another person on Nostr. You don't choose who receives it, and they won't know it came from you.
                </p>
                <p>
                  It's a simple way to spread kindness without expecting anything in return.
                </p>
              </div>

              {/* Amount selector note */}
              <p className="text-xs text-muted-foreground">
                Choose the amount of sats you'd like to send.
              </p>

              {/* Amount selector */}
              <div className="flex flex-wrap gap-2">
                {SAT_AMOUNTS.map((amount) => (
                  <Button
                    key={amount}
                    variant={selectedAmount === amount ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedAmount(amount)}
                    className={cn(
                      selectedAmount === amount &&
                        'bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 text-white'
                    )}
                  >
                    {amount} sats
                  </Button>
                ))}
                <Button
                  variant={selectedAmount === RANDOM_AMOUNT ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedAmount(RANDOM_AMOUNT)}
                  className={cn(
                    selectedAmount === RANDOM_AMOUNT &&
                      'bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 text-white'
                  )}
                >
                  Random
                </Button>
                <Button
                  variant={selectedAmount === CUSTOM_AMOUNT ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedAmount(CUSTOM_AMOUNT)}
                  className={cn(
                    selectedAmount === CUSTOM_AMOUNT &&
                      'bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 text-white'
                  )}
                >
                  Custom
                </Button>
              </div>

              {/* Custom amount input */}
              {selectedAmount === CUSTOM_AMOUNT && (
                <div className="space-y-2">
                  <Input
                    type="number"
                    placeholder="Enter amount in sats"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    min="1"
                    className="max-w-[200px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the amount of sats you'd like to send
                  </p>
                </div>
              )}

              {/* Custom message input */}
              <div className="space-y-2 pt-2">
                <label className="text-sm font-medium text-foreground">
                  Message (optional)
                </label>
                <Textarea
                  placeholder={DEFAULT_MESSAGE}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={3}
                  className="resize-none text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {customMessage.trim() 
                    ? 'Your custom message will be included with the gift.' 
                    : 'Leave empty to use the default message.'}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 justify-end pt-2">
                <Button
                  variant="outline"
                  onClick={handleClose}
                  disabled={isSending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={isSending || !canSend()}
                  className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  {isSending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Gift'
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold animate-in fade-in-50">
                Your gratitude has been sent.
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Success body copy */}
              <div className="space-y-4 text-sm text-foreground leading-relaxed animate-in fade-in-50 slide-in-from-bottom-2">
                <p>
                  A small gift of sats was anonymously given to someone on Nostr.
                </p>
                <p>
                  They'll only know that someone is grateful today.
                </p>
              </div>

              {/* Closing line */}
              <p className="text-xs text-muted-foreground italic animate-in fade-in-50 delay-300">
                Kindness has a way of finding its path.
              </p>

              {/* Close button */}
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleClose}
                  className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  Close
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

