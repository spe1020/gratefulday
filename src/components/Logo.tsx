import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'header';
}

export function Logo({ className, showText = true, size = 'md' }: LogoProps) {
  const [imageError, setImageError] = useState(false);

  const sizeClasses = {
    sm: 'h-6 sm:h-8',
    md: 'h-8 sm:h-10',
    lg: 'h-12 sm:h-14',
    header: 'h-[140px] sm:h-[160px] md:h-[180px]', // 140px mobile, 160px tablet, 180px desktop (125% of doubled size)
  };

  // Try multiple possible file formats
  const logoPaths = ['/gratefullogo.png', '/logo.png', '/logo.svg', '/logo.webp'];
  const [currentPathIndex, setCurrentPathIndex] = useState(0);

  const handleImageError = () => {
    if (currentPathIndex < logoPaths.length - 1) {
      setCurrentPathIndex(currentPathIndex + 1);
    } else {
      setImageError(true);
    }
  };

  if (imageError) {
    // Fallback to icon if image doesn't exist
    return (
      <Link to="/?tab=calendar" className={cn('flex items-center gap-2', className)}>
        <div className={cn(
          'p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg flex-shrink-0',
          size === 'sm' && 'p-1.5',
          size === 'lg' && 'p-3'
        )}>
          <Sparkles className={cn(
            'text-white',
            size === 'sm' && 'h-4 w-4',
            size === 'md' && 'h-5 w-5',
            size === 'lg' && 'h-6 w-6'
          )} />
        </div>
        {showText && (
          <span className="text-lg sm:text-xl font-semibold text-foreground hidden sm:inline-block">
            GratefulDay
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link to="/?tab=calendar" className={cn('flex items-center', className)}>
      <img
        src={logoPaths[currentPathIndex]}
        alt="GratefulDay"
        className={cn(
          'w-auto object-contain',
          sizeClasses[size]
        )}
        onError={handleImageError}
      />
      {showText && (
        <span className={cn(
          'font-semibold text-foreground hidden sm:inline-block',
          size === 'header' ? 'text-xl sm:text-2xl ml-3 sm:ml-4' : 'text-lg sm:text-xl ml-2 sm:ml-3'
        )}>
          GratefulDay
        </span>
      )}
    </Link>
  );
}

