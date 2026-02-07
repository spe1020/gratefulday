import { useState, useCallback } from 'react';
import { Settings, Sun, Moon, Monitor, X, RotateCcw } from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { useTheme } from '@/hooks/useTheme';
import { useAppContext } from '@/hooks/useAppContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { TEACHING_TRADITIONS, DEFAULT_TEACHING_PREFERENCES } from '@/lib/teachingUtils';
import type { TeachingTradition } from '@/lib/teachingUtils';
import type { Theme } from '@/contexts/AppContext';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';

interface SettingsModalProps {
  children?: React.ReactNode;
}

const themeOptions: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
  { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
];

function SettingsContent() {
  const { theme, setTheme } = useTheme();
  const { config, updateConfig } = useAppContext();
  const preferences = config.teachingPreferences;

  const radarData = TEACHING_TRADITIONS.map((tradition) => ({
    tradition,
    value: preferences[tradition] ?? 80,
  }));

  const updatePreference = useCallback((tradition: TeachingTradition, value: number) => {
    updateConfig((current) => ({
      ...current,
      teachingPreferences: {
        ...current.teachingPreferences,
        [tradition]: value,
      },
    }));
  }, [updateConfig]);

  const resetPreferences = useCallback(() => {
    updateConfig((current) => ({
      ...current,
      teachingPreferences: { ...DEFAULT_TEACHING_PREFERENCES },
    }));
  }, [updateConfig]);

  return (
    <div className="space-y-6 px-4 pb-4">
      {/* Appearance */}
      <div className="space-y-3">
        <h3 className="font-medium">Appearance</h3>
        <div className="flex rounded-lg border p-1 gap-1">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={`flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                theme === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent text-muted-foreground'
              }`}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Teaching Preferences */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Teaching Preferences</h3>
          <Button variant="ghost" size="sm" onClick={resetPreferences} className="h-7 px-2 text-xs text-muted-foreground">
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Adjust how often each tradition appears in your daily teaching.
        </p>

        {/* Radar chart */}
        <ResponsiveContainer width="100%" height={250}>
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid />
            <PolarAngleAxis
              dataKey="tradition"
              tick={{ fontSize: 12, fill: 'currentColor' }}
            />
            <Radar
              dataKey="value"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>

        {/* Sliders for each tradition */}
        <div className="space-y-4 pt-1">
          {TEACHING_TRADITIONS.map((tradition) => {
            const value = preferences[tradition] ?? 80;
            return (
              <div key={tradition} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{tradition}</label>
                  <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                    {value === 0 ? 'Off' : value}
                  </span>
                </div>
                <Slider
                  value={[value]}
                  onValueChange={([v]) => updatePreference(tradition, v)}
                  min={0}
                  max={100}
                  step={5}
                  className="w-full"
                />
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground text-center pt-1">
          Higher values mean that tradition appears more often. Set to 0 to exclude.
        </p>
      </div>
    </div>
  );
}

export function SettingsModal({ children }: SettingsModalProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          {children || (
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          )}
        </DrawerTrigger>
        <DrawerContent className="h-full">
          <DrawerHeader className="text-center relative">
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-4 top-4"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
            <DrawerTitle className="flex items-center justify-center gap-2 pt-2">
              <Settings className="h-5 w-5" />
              Settings
            </DrawerTitle>
            <DrawerDescription>
              Customize your experience.
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto">
            <SettingsContent />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Customize your experience.
          </DialogDescription>
        </DialogHeader>
        <SettingsContent />
      </DialogContent>
    </Dialog>
  );
}
