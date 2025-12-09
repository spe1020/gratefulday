import { useState, useEffect, useRef } from 'react';
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
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useGratitudeGift } from '@/hooks/useGratitudeGift';
import { Loader2, Copy, Check, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import QRCode from 'qrcode';

interface GratitudeGiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SAT_AMOUNTS = [111, 210, 369, 500, 777, 1000, 2100] as const;
const RANDOM_AMOUNT = 'random' as const;
const CUSTOM_AMOUNT = 'custom' as const;

type AmountOption = typeof SAT_AMOUNTS[number] | typeof RANDOM_AMOUNT | typeof CUSTOM_AMOUNT;

const DEFAULT_MESSAGE = "A small gift of gratitude from someone who appreciates you today. 💜";
const WEBSITE_URL = "https://gratefulday.space";

type PaymentState = 'form' | 'invoice' | 'success';

export function GratitudeGiftModal({ open, onOpenChange }: GratitudeGiftModalProps) {
  const [selectedAmount, setSelectedAmount] = useState<AmountOption>(111);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [customMessage, setCustomMessage] = useState<string>('');
  const [paymentState, setPaymentState] = useState<PaymentState>('form');
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [invoiceInfo, setInvoiceInfo] = useState<{
    invoice: string;
    zapEndpoint: string;
    signedZapRequest: unknown;
  } | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { sendGratitudeGift, verifyAndPublishPayment, isSending } = useGratitudeGift();
  const { toast } = useToast();

  // Generate QR code when invoice is available
  useEffect(() => {
    let isCancelled = false;

    const generateQR = async () => {
      if (!invoice) {
        setQrCodeUrl('');
        return;
      }

      try {
        const url = await QRCode.toDataURL(invoice.toUpperCase(), {
          width: 512,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });

        if (!isCancelled) {
          setQrCodeUrl(url);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to generate QR code:', err);
        }
      }
    };

    generateQR();

    return () => {
      isCancelled = true;
    };
  }, [invoice]);

  // Poll for payment status
  useEffect(() => {
    if (paymentState === 'invoice' && invoiceInfo) {
      const pollPayment = async () => {
        try {
          const isPaid = await verifyAndPublishPayment(
            invoiceInfo.invoice,
            invoiceInfo.zapEndpoint,
            invoiceInfo.signedZapRequest,
            false // Don't force publish during polling
          );

          if (isPaid) {
            // Payment confirmed!
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            setPaymentState('success');
            toast({
              title: 'Payment confirmed!',
              description: 'Your gratitude gift has been sent successfully.',
            });
          }
        } catch (error) {
          console.error('Payment polling error:', error);
        }
      };

      // Poll every 3 seconds
      pollingIntervalRef.current = setInterval(pollPayment, 3000);
      
      // Initial check
      pollPayment();

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    }
  }, [paymentState, invoiceInfo, verifyAndPublishPayment, toast]);

  const handleSend = async () => {
    let amount: number;
    
    if (selectedAmount === RANDOM_AMOUNT) {
      // Random amount from available options
      const amounts = [111, 210, 369, 500, 777, 1000, 2100];
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
    // Always append website URL to the message
    const baseMessage = customMessage.trim() || DEFAULT_MESSAGE;
    const message = `${baseMessage} ${WEBSITE_URL}`;

    const result = await sendGratitudeGift(amount, message);
    
    if (result.success) {
      // Payment completed automatically
      setPaymentState('success');
    } else if (result.invoice && result.zapEndpoint && result.signedZapRequest) {
      // Manual payment required
      setInvoice(result.invoice);
      setInvoiceInfo({
        invoice: result.invoice,
        zapEndpoint: result.zapEndpoint,
        signedZapRequest: result.signedZapRequest,
      });
      setPaymentState('invoice');
    }
  };

  const handleCopy = async () => {
    if (invoice) {
      await navigator.clipboard.writeText(invoice);
      setCopied(true);
      toast({
        title: 'Invoice copied',
        description: 'Lightning invoice copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openInWallet = () => {
    if (invoice) {
      const lightningUrl = `lightning:${invoice}`;
      window.open(lightningUrl, '_blank');
    }
  };

  const handleClose = () => {
    // Clear polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    // Reset state
    setPaymentState('form');
    setInvoice(null);
    setQrCodeUrl('');
    setCopied(false);
    setInvoiceInfo(null);
    setSelectedAmount(111);
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
        {paymentState === 'form' && (
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
                  When you send a gratitude gift, a small amount of sats is sent to a randomly selected person on Nostr. We filter out bots and news accounts, so your gift goes to a real person. You don't choose who receives it—the recipient is randomly selected from active users.
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
                  placeholder={`${DEFAULT_MESSAGE} ${WEBSITE_URL}`}
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
        )}

        {paymentState === 'invoice' && invoice && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">
                Pay with Lightning
              </DialogTitle>
              <DialogDescription>
                Scan the QR code or copy the invoice to pay with any Lightning wallet.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* QR Code */}
              <div className="flex justify-center">
                <Card className="p-3">
                  <CardContent className="p-0 flex justify-center">
                    {qrCodeUrl ? (
                      <img
                        src={qrCodeUrl}
                        alt="Lightning Invoice QR Code"
                        className="w-full h-auto aspect-square max-w-[300px] object-contain"
                      />
                    ) : (
                      <div className="w-full aspect-square max-w-[300px] bg-muted animate-pulse rounded" />
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Invoice input */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Lightning Invoice
                </label>
                <div className="flex gap-2 min-w-0">
                  <Input
                    value={invoice}
                    readOnly
                    className="font-mono text-xs min-w-0 flex-1 overflow-hidden text-ellipsis"
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopy}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Payment buttons */}
              <div className="space-y-3">
                <Button
                  variant="outline"
                  onClick={openInWallet}
                  className="w-full"
                  size="lg"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in Lightning Wallet
                </Button>

                <Button
                  onClick={async () => {
                    if (invoiceInfo) {
                      // User confirms payment - force publish zap request
                      const success = await verifyAndPublishPayment(
                        invoiceInfo.invoice,
                        invoiceInfo.zapEndpoint,
                        invoiceInfo.signedZapRequest,
                        true // Force publish since user confirmed
                      );
                      if (success) {
                        setPaymentState('success');
                        toast({
                          title: 'Payment confirmed!',
                          description: 'Your gratitude gift has been sent successfully.',
                        });
                      } else {
                        toast({
                          title: 'Failed to publish',
                          description: 'Payment was confirmed but failed to publish zap request. Please try again.',
                          variant: 'destructive',
                        });
                      }
                    }
                  }}
                  className="w-full bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
                  size="lg"
                >
                  I've Paid - Confirm
                </Button>

                <div className="text-xs text-muted-foreground text-center">
                  We'll automatically detect when your payment is confirmed, or click "I've Paid" after completing the payment.
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 justify-end pt-2">
                <Button
                  variant="outline"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </>
        )}

        {paymentState === 'success' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold animate-in fade-in-50 flex items-center gap-2">
                <Check className="h-6 w-6 text-green-600" />
                Payment Confirmed
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Success body copy */}
              <div className="space-y-4 text-sm text-foreground leading-relaxed animate-in fade-in-50 slide-in-from-bottom-2 text-center">
                <div className="text-4xl mb-4">🙏</div>
                <p>
                  Your gratitude gift has been sent successfully!
                </p>
                <p>
                  A small gift of sats was given to someone on Nostr. They'll know that someone is grateful today.
                </p>
              </div>

              {/* Closing line */}
              <p className="text-xs text-muted-foreground italic animate-in fade-in-50 delay-300 text-center">
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
