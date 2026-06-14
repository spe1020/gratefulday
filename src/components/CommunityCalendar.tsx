import { CalendarDays } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function CommunityCalendar() {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 px-8 text-center">
        <div className="max-w-sm mx-auto space-y-4">
          <div className="p-4 rounded-full bg-muted inline-flex">
            <CalendarDays className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <p className="font-medium">Community Calendar</p>
            <p className="text-sm text-muted-foreground">
              Public gratitude notes grouped by day — coming in the next release.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
