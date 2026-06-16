import { Gift, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useWallet } from '@/hooks/useWallet';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useGratitudeGift } from '@/hooks/useGratitudeGift';
import { useToast } from '@/hooks/useToast';
import { canQuickSend } from '@/lib/giftUtils';

/**
 * Header express lane for the gratitude gift. One tap sends instantly ONLY when
 * a usable wallet is connected AND the user has preset a default amount
 * (`canQuickSend`); otherwise the tap opens the configure modal — never a silent
 * spend. In-flight is disabled (the double-spend guard). Hidden when logged out.
 */
export function GratitudeGiftButton({ onOpenModal }: { onOpenModal: () => void }) {
  const { user } = useCurrentUser();
  const { preferredMethod } = useWallet();
  const { settings } = useAppSettings();
  const { sendGratitudeGift, isSending } = useGratitudeGift();
  const { toast } = useToast();

  if (!user) return null;

  const hasWallet = preferredMethod !== 'manual'; // NWC active or WebLN (not deep-link)
  const quick = canQuickSend({ hasWallet, defaultAmount: settings.giftDefaultAmount });

  const handleTap = async () => {
    if (!quick) {
      onOpenModal(); // not armed → configure path, never an instant spend
      return;
    }
    const amount = settings.giftDefaultAmount!;
    const result = await sendGratitudeGift(amount);
    if (result.success) {
      toast({
        title: 'Sent a gift of gratitude 🙏',
        description: `${amount.toLocaleString()} sats on their way to someone.`,
      });
    } else if (result.invoice) {
      // Auto-pay didn't complete despite a wallet — the hook doesn't toast this
      // path. No partial spend (NWC/WebLN payment is atomic), so just surface it.
      toast({
        title: "Couldn't send the gift",
        description: "Your wallet payment didn't go through. Please try again.",
        variant: 'destructive',
      });
    }
    // else: sendGratitudeGift already showed a specific error toast.
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={handleTap}
      disabled={isSending}
      aria-label={quick ? 'Send a one-tap gift of gratitude' : 'Send a gift of gratitude'}
      title="Send a gift of gratitude"
    >
      {isSending ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Gift className="h-5 w-5" />
      )}
    </Button>
  );
}
