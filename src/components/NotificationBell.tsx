import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationsView } from '@/components/NotificationsView';

/**
 * Header bell with an unread badge. Opens a sheet listing grouped notifications
 * (reactions, zaps, comments/replies on the user's gratitude). Opening the sheet
 * marks everything seen (NIP-78 `lastSeenNotifications = now`, synced + fail-
 * soft), so the badge clears. Hidden when logged out.
 */
export function NotificationBell() {
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const { groups, unread, isLoading, isError, refetch, markAllRead } = useNotifications();

  if (!user) return null;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Only write when there's something new — avoids a needless NIP-78 publish.
    if (next && unread > 0) markAllRead();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white"
              aria-label={`${unread} unread notifications`}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[340px] sm:w-[400px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-4 border-b">
          <SheetTitle>Notifications</SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="p-2">
            <NotificationsView
              groups={groups}
              isLoading={isLoading}
              isError={isError}
              onRefresh={() => refetch()}
              onNavigated={() => setOpen(false)}
            />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
