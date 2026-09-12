import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useWisdomHistory } from '@/hooks/useWisdomHistory';
import { useGratitudeEntry } from '@/hooks/useGratitudeEntries';
import { useDecryptedEntry } from '@/hooks/useDecryptedEntry';
import { entryAddress, getEntryTombstones, isEntryTombstoned } from '@/lib/entryTombstones';
import type { WisdomInteraction } from '@/lib/wisdomStore';
import { WisdomReading } from './WisdomReflectionSheet';

function interactionDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function AssociatedReflection({ interaction, pubkey }: { interaction: WisdomInteraction; pubkey: string }) {
  const queryClient = useQueryClient();
  const query = useGratitudeEntry(pubkey, interaction.date);
  // The editor updates this cache immediately on save. The single-day query
  // can still hold the previous version until relay propagation catches up.
  const cached = queryClient.getQueryData<NostrEvent[]>(['gratitude-entries', pubkey]) ?? [];
  const tombstones = getEntryTombstones();
  const candidates = [...cached, ...(query.data ? [query.data] : [])].filter((event) =>
    event.kind === 36669 && event.pubkey === pubkey &&
    event.tags.some(([name, value]) => name === 'd' && value === interaction.date) &&
    !isEntryTombstoned(event, tombstones));
  const event = candidates.reduce<NostrEvent | undefined>((latest, item) => !latest || item.created_at > latest.created_at ? item : latest, undefined);
  const decrypted = useDecryptedEntry(event);
  return <div className="space-y-3 border-t pt-5">
    <h3 className="text-sm font-medium">Your reflection · {interactionDate(interaction.date)}</h3>
    {(query.isLoading && !event) || decrypted.isDecrypting ? <Skeleton className="h-20 w-full" />
      : decrypted.decryptError ? <p className="text-sm text-muted-foreground">This reflection is private. Use a signer that can decrypt it to read it here.</p>
      : event ? <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{decrypted.content}</p>
      : <p className="text-sm text-muted-foreground">{query.isError ? "Your reflection couldn't be loaded right now." : 'This reflection is no longer available.'}</p>}
  </div>;
}

export function YourWisdom() {
  const { pubkey } = useWisdomHistory();
  return <WisdomHistory key={pubkey ?? 'guest'} />;
}

function WisdomHistory() {
  const { interactions, pubkey, storageUnavailable } = useWisdomHistory();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const interactionKey = (item: WisdomInteraction) => `${item.date}:${item.wisdom.id}`;
  const selectedItem = interactions.find((item) => interactionKey(item) === selected);
  return <Sheet open={open} onOpenChange={(value) => { setOpen(value); if (!value) setSelected(null); }}>
    <SheetTrigger asChild>
      <button type="button" className="min-h-11 shrink-0 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Your Wisdom <span aria-hidden="true">→</span></button>
    </SheetTrigger>
    <SheetContent side="bottom" overlayClassName="z-[105] bg-black/40 motion-reduce:animate-none"
      className="z-[110] mx-auto max-h-[85dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-2xl px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 sm:bottom-6 sm:rounded-2xl sm:p-8 motion-reduce:animate-none motion-reduce:transition-none">
      <SheetHeader className="text-left">
        <SheetTitle>Your Wisdom</SheetTitle>
        <SheetDescription>Ideas you've stopped to think about.</SheetDescription>
      </SheetHeader>
      {selectedItem ? <>
        <button type="button" onClick={() => setSelected(null)} className="mt-3 min-h-11 text-sm text-muted-foreground hover:text-foreground">← Back to your ideas</button>
        <WisdomReading wisdom={selectedItem.wisdom}>
          {pubkey && selectedItem.reflection?.address === entryAddress(pubkey, selectedItem.date)
            ? <AssociatedReflection interaction={selectedItem} pubkey={pubkey} />
            : <p className="text-sm text-muted-foreground">{selectedItem.addedAt ? 'Carried into your day. No saved reflection is linked yet.' : 'An idea you paused with. No reflection was added.'}</p>}
        </WisdomReading>
      </> : <>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{storageUnavailable
          ? "History couldn't be saved on this device. These ideas are available for this visit."
          : pubkey ? 'Saved on this device for this account.' : 'Your ideas stay here for this visit. Log in to keep future reflections with your account.'}</p>
        {interactions.length === 0 ? <p className="py-10 text-sm leading-relaxed text-muted-foreground">When a daily thought catches your attention, choose “Reflect on this.” The ideas you pause with will gather here.</p>
          : <ul className="mt-5 divide-y divide-border/60">
            {interactions.map((item) => <li key={interactionKey(item)}>
              <button type="button" onClick={() => setSelected(interactionKey(item))} className="w-full rounded-md py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="text-base font-medium leading-relaxed">{item.wisdom.text}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.wisdom.author}</p>
                <p className="mt-2 text-xs text-muted-foreground"><span className="capitalize">{item.wisdom.themes?.[0]}{item.wisdom.themes?.[0] && ' · '}</span>{interactionDate(item.date)}</p>
              </button>
            </li>)}
          </ul>}
      </>}
    </SheetContent>
  </Sheet>;
}
