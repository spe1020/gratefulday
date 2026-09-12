import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { getWisdomPrompt, wisdomWording, type WisdomItem } from '@/lib/wisdom';
import { recordWisdomInteraction } from '@/lib/wisdomStore';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export function WisdomReflectionSheet({ wisdom, open, onOpenChange, onAdd, onCloseAutoFocus, children }: {
  wisdom: WisdomItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  children?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" onCloseAutoFocus={onCloseAutoFocus} overlayClassName="z-[105] bg-black/40 motion-reduce:animate-none"
        className="z-[110] mx-auto max-h-[85dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-2xl border-amber-200 bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 dark:border-amber-900 sm:bottom-6 sm:rounded-2xl sm:p-8 motion-reduce:animate-none motion-reduce:transition-none">
        <SheetHeader className="text-left">
          <SheetTitle className="text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">Daily Wisdom</SheetTitle>
          <SheetDescription className="sr-only">A moment to consider an idea and carry it into your day.</SheetDescription>
        </SheetHeader>
        <WisdomReading wisdom={wisdom}>{children}</WisdomReading>
        {onAdd && <Button onClick={onAdd} className="mt-6 h-auto min-h-11 w-full whitespace-normal py-3">Add to today's reflection</Button>}
      </SheetContent>
    </Sheet>
  );
}

export function WisdomReading({ wisdom, children }: { wisdom: WisdomItem; children?: ReactNode }) {
  return <div className="space-y-6 pt-5 break-words">
          <div className="space-y-3">
            <blockquote className="text-xl font-medium leading-relaxed text-foreground sm:text-2xl">{wisdom.text}</blockquote>
            <p className="text-sm text-muted-foreground">
              {wisdom.author}{wisdom.source && <> · <cite>{wisdom.source}</cite></>}{wisdom.era && <> · {wisdom.era}</>}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {wisdomWording(wisdom)}
              {wisdom.provenance && <> · <a href={wisdom.provenance.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{wisdom.provenance.location}</a></>}
            </p>
          </div>
          {wisdom.interpretation && <div className="space-y-2">
            <p className="text-xs text-muted-foreground">A reading by Grateful Day</p>
            <p className="text-base leading-relaxed">{wisdom.interpretation}</p>
          </div>}
          <div className="space-y-3 border-t border-amber-200/60 pt-5 dark:border-amber-900/60">
            <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">Carry it with you</h3>
            <p className="text-base font-medium leading-relaxed">{getWisdomPrompt(wisdom)}</p>
          </div>
          {children}
        </div>;
}

export function ReflectOnWisdom({ wisdom, date, onAdd }: { wisdom: WisdomItem; date: string; onAdd?: () => void }) {
  const [open, setOpen] = useState(false);
  const { user } = useCurrentUser();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const addingRef = useRef(false);
  return <div onClick={(event) => event.stopPropagation()}>
    <button ref={triggerRef} type="button" className="min-h-11 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-amber-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-amber-200"
      onClick={(event) => {
        event.stopPropagation();
        addingRef.current = false;
        recordWisdomInteraction(user?.pubkey, wisdom, date, 'opened');
        setOpen(true);
      }}>Reflect on this <span aria-hidden="true">→</span></button>
    <WisdomReflectionSheet wisdom={wisdom} open={open} onOpenChange={setOpen}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (!addingRef.current) triggerRef.current?.focus();
      }}
      onAdd={onAdd ? () => {
        recordWisdomInteraction(user?.pubkey, wisdom, date, 'added');
        addingRef.current = true;
        setOpen(false);
        onAdd();
      } : undefined} />
  </div>;
}
