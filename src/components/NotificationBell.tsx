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
 * Header bell with an unread badge. Opens a right-side sheet listing grouped
 * notifications (reactions, zaps, comments/replies on the user's gratitude).
 *
 * The panel is positioned BELOW the sticky app header (which is z-[100], above
 * the sheet's z-50) — otherwise the header would clip the panel's top, hiding
 * its title bar and first row. "Mark all read" sets NIP-78 `lastSeenNotifications
 * = now` (synced, fail-soft) → the badge clears. Hidden when logged out.
 */
export function NotificationBell() {
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const { groups, unread, isLoading, isError, refetch, markAllRead } = useNotifications();

  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
      {/* Pin below the app header (h-[88/96/104]); !top beats the variant's
          inset-y-0, h-auto lets top+bottom-0 size it, so the list scrolls from
          the first item. Mobile keeps the full available height below the header. */}
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 w-[340px] sm:w-[400px] h-auto !top-[88px] sm:!top-[96px] md:!top-[104px]"
      >
        <SheetHeader className="flex-row items-center justify-between space-y-0 px-4 py-3 border-b shrink-0">
          <SheetTitle>Notifications</SheetTitle>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead()}
              className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </Button>
          )}
        </SheetHeader>
        <ScrollArea className="flex-1 min-h-0">
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
