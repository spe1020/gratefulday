import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getQuoteForDay, getAffirmationForDay } from '@/lib/gratitudeUtils';

interface TodayHeroProps {
  day: DayInfo;
  onOpenDetail: (day: DayInfo) => void;
  totalDays: number;
}

export function TodayHero({ day, onOpenDetail, totalDays }: TodayHeroProps) {
  const [_isHovered, setIsHovered] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);

  const handleCardClick = () => {
    onOpenDetail(day);
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    setShowConfetti(true);
    setShowCheckmark(true);
    
    // Trigger confetti animation
    setTimeout(() => {
      setShowConfetti(false);
    }, 2000);
    
    // Open dialog after brief animation
    setTimeout(() => {
      onOpenDetail(day);
      setShowCheckmark(false);
    }, 300);
  };

  const quote = getQuoteForDay(day.dayOfYear);
  const affirmation = getAffirmationForDay(day.dayOfYear);
  
  // Calculate progress for text display
  const progress = (day.dayOfYear / totalDays) * 100;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <Card
        className={cn(
          'w-full cursor-pointer transition-all duration-300 relative overflow-hidden group',
          'border-2 border-amber-200 dark:border-amber-800',
          'bg-gradient-to-br from-amber-50/50 via-orange-50/50 to-rose-50/50 dark:from-amber-950/20 dark:via-orange-950/20 dark:to-rose-950/20',
          'shadow-2xl hover:shadow-3xl',
          'animate-in fade-in-50 slide-in-from-bottom-4'
        )}
        onClick={handleCardClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Subtle glow effect */}
        <div 
          className="absolute inset-0 opacity-20 blur-3xl pointer-events-none transition-opacity duration-300"
          style={{
            background: 'radial-gradient(circle at center, rgba(251, 191, 36, 0.4) 0%, transparent 70%)',
          }}
        />

        <CardContent className="p-6 sm:p-8 lg:p-10 relative z-10">
          {/* Hero Section - Left-aligned with reduced top spacing */}
          <div className="mb-6 sm:mb-8 space-y-2 pt-4 sm:pt-6">
            {/* TODAY label */}
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              TODAY
            </p>

            {/* Day Number - Main Hero (reduced visual dominance) */}
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-medium text-foreground">
              Day {day.dayOfYear}
            </h1>

            {/* Full Date */}
            <p className="text-base sm:text-lg font-semibold text-foreground">
              {day.date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}
            </p>

            {/* "A year shaped by gratitude" with minimal progress ring */}
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                A year shaped by gratitude
              </p>
              {/* Minimal progress ring - symbolic accent */}
              <div className="relative flex-shrink-0">
                <svg
                  className="transform -rotate-90"
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                >
                  {/* Background circle */}
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-amber-200/30 dark:text-amber-900/30"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    className="text-amber-600 dark:text-amber-400 transition-all duration-1000 ease-out"
                    strokeDasharray={2 * Math.PI * 8}
                    strokeDashoffset={2 * Math.PI * 8 - (progress / 100) * 2 * Math.PI * 8}
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Today's Reflection Section */}
          <div className="mb-6 sm:mb-8">
            {/* Section Header */}
            <div className="mb-3">
              <h2 className="text-base sm:text-lg font-semibold text-foreground mb-0.5">
                Today's Reflection
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                A moment to pause and appreciate your life.
              </p>
            </div>

            <div className="space-y-3">
              {/* Quote Section - Consistent padding and spacing */}
              <div className="p-4 sm:p-5 rounded-xl bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm border border-amber-200/50 dark:border-amber-800/50 shadow-sm">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                    Daily Wisdom
                  </p>
                  <p className="text-base sm:text-lg italic text-foreground leading-relaxed">
                    "{quote.text}"
                  </p>
                  <p className="text-sm text-muted-foreground">
                    — {quote.author}
                  </p>
                </div>
              </div>

              {/* Affirmation Section - Enhanced prominence */}
              <div className="p-4 sm:p-5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 backdrop-blur-sm border-2 border-rose-300/60 dark:border-rose-700/60 shadow-md">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-rose-700 dark:text-rose-300 uppercase tracking-wider">
                    Daily Affirmation
                  </p>
                  <p className="text-sm sm:text-base italic text-foreground leading-relaxed font-medium">
                    "{affirmation}"
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA Prompt and Button */}
          <div className="relative mb-4 sm:mb-6 mt-6 sm:mt-8 space-y-3">
            {/* Prompt Text */}
            <p className="text-center text-sm sm:text-base font-medium text-foreground">
              Notice something you're grateful for today.
            </p>
            {/* Confetti Animation */}
            {showConfetti && (
              <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
                {[...Array(20)].map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-2 h-2 rounded-full animate-confetti"
                    style={{
                      left: '50%',
                      top: '50%',
                      backgroundColor: [
                        '#fbbf24', // amber
                        '#fb923c', // orange
                        '#fb7185', // rose
                        '#f59e0b', // amber-500
                        '#f97316', // orange-500
                      ][i % 5],
                      animationDelay: `${(i * 0.1)}s`,
                      transform: `translate(${(Math.random() - 0.5) * 200}px, ${(Math.random() - 0.5) * 200}px) rotate(${Math.random() * 360}deg)`,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Checkmark Animation */}
            {showCheckmark && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
                <div className="animate-checkmark-bounce">
                  <div className="w-16 h-16 rounded-full bg-green-500/90 dark:bg-green-400/90 flex items-center justify-center shadow-2xl">
                    <Check className="h-8 w-8 text-white" strokeWidth={3} />
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={(e) => {
                e.stopPropagation(); // Prevent card click
                handleButtonClick(e);
              }}
              size="lg"
              className={cn(
                'w-full h-14 sm:h-16 text-base sm:text-lg font-semibold',
                'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500',
                'hover:from-amber-600 hover:via-orange-600 hover:to-rose-600',
                'dark:from-amber-600 dark:via-orange-600 dark:to-rose-600',
                'dark:hover:from-amber-500 dark:hover:via-orange-500 dark:hover:to-rose-500',
                'text-white shadow-lg hover:shadow-xl',
                'transition-all duration-300',
                'hover:scale-[1.02] active:scale-[0.98]',
                'relative overflow-hidden group'
              )}
            >
              {/* Button glow effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
              
              <div className="relative z-10 flex items-center justify-center gap-2">
                <Heart className="h-5 w-5 sm:h-6 sm:w-6" fill="currentColor" />
                <span>Capture Today's Gratitude</span>
              </div>
            </Button>
          </div>

        </CardContent>
      </Card>

      {/* Confetti and Checkmark Animation Styles */}
      <style>{`
        @keyframes confetti {
          0% {
            opacity: 1;
            transform: translate(0, 0) rotate(0deg) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0);
          }
        }

        .animate-confetti {
          animation: confetti 1.5s ease-out forwards;
        }

        @keyframes checkmark-bounce {
          0% {
            opacity: 0;
            transform: scale(0) rotate(-180deg);
          }
          50% {
            opacity: 1;
            transform: scale(1.2) rotate(0deg);
          }
          100% {
            opacity: 0;
            transform: scale(1) rotate(0deg);
          }
        }

        .animate-checkmark-bounce {
          animation: checkmark-bounce 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

