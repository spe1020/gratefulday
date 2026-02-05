import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-amber-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {/* Top row: brand + nav links */}
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6 sm:gap-8">
          {/* Brand */}
          <div className="flex flex-col items-center sm:items-start gap-2">
            <Link
              to="/?tab=calendar"
              className="text-lg font-semibold text-foreground hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            >
              GratefulDay
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs text-center sm:text-left">
              A daily reflection calendar for personal growth and community sharing.
            </p>
          </div>

          {/* Navigation columns */}
          <div className="flex gap-12 sm:gap-16">
            <div className="flex flex-col items-center sm:items-start gap-2">
              <h3 className="text-sm font-medium text-foreground">Explore</h3>
              <Link
                to="/?tab=calendar"
                className="text-sm text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                Calendar
              </Link>
              <Link
                to="/?tab=community"
                className="text-sm text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                Community
              </Link>
              <Link
                to="/library"
                className="text-sm text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                Library
              </Link>
            </div>

            <div className="flex flex-col items-center sm:items-start gap-2">
              <h3 className="text-sm font-medium text-foreground">Protocol</h3>
              <a
                href="https://nostr.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                Nostr
              </a>
              <a
                href="https://github.com/nostr-protocol/nips"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                NIPs
              </a>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-amber-100 dark:border-gray-800 mt-8 pt-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              &copy; {currentYear} GratefulDay. Powered by Nostr.
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              Made with <Heart className="h-3 w-3 text-amber-500 fill-amber-500" /> gratitude
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
