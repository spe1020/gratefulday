import { useState, useCallback, useEffect } from 'react';
import { Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';

interface ShareTeachingModalProps {
  defaultContent: string;
  children: React.ReactNode;
}

function ShareContent({
  content,
  setContent,
  onPublish,
  isPublishing,
}: {
  content: string;
  setContent: (v: string) => void;
  onPublish: () => void;
  isPublishing: boolean;
}) {
  return (
    <div className="space-y-4 px-4 pb-4">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={10}
        className="resize-none font-mono text-sm"
        placeholder="Write your note..."
      />
      <div className="rounded-lg border bg-muted/50 p-4">
        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Preview</p>
        <div className="text-sm whitespace-pre-wrap break-words">{content}</div>
      </div>
      <Button
        onClick={onPublish}
        disabled={isPublishing || !content.trim()}
        className="w-full"
      >
        <Share2 className="h-4 w-4 mr-2" />
        {isPublishing ? 'Publishing…' : 'Publish to Nostr'}
      </Button>
    </div>
  );
}

export function ShareTeachingModal({ defaultContent, children }: ShareTeachingModalProps) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(defaultContent);
  const isMobile = useIsMobile();
  const { mutateAsync: publishEvent, isPending: isPublishing } = useNostrPublish();
  const { toast } = useToast();

  // Reset content when modal opens with fresh default
  useEffect(() => {
    if (open) setContent(defaultContent);
  }, [open, defaultContent]);

  const handlePublish = useCallback(async () => {
    try {
      await publishEvent({
        kind: 1,
        content,
        tags: [['t', 'gratefulday']],
        created_at: Math.floor(Date.now() / 1000),
      });
      toast({ title: 'Shared on Nostr', description: 'Your note has been published.' });
      setOpen(false);
    } catch {
      toast({ title: 'Failed to share', description: 'Could not publish to Nostr.', variant: 'destructive' });
    }
  }, [content, publishEvent, toast]);

  const shareProps = { content, setContent, onPublish: handlePublish, isPublishing };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent className="h-full">
          <DrawerHeader className="text-center relative">
            <DrawerClose asChild>
              <Button variant="ghost" size="sm" className="absolute right-4 top-4">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
            <DrawerTitle className="flex items-center justify-center gap-2 pt-2">
              <Share2 className="h-5 w-5" />
              Share Teaching
            </DrawerTitle>
            <DrawerDescription>Edit your note before publishing.</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto">
            <ShareContent {...shareProps} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Teaching
          </DialogTitle>
          <DialogDescription>Edit your note before publishing.</DialogDescription>
        </DialogHeader>
        <ShareContent {...shareProps} />
      </DialogContent>
    </Dialog>
  );
}
