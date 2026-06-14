import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface DayAuthorAvatarsProps {
  pubkeys: string[];
  /** Max avatars before collapsing into a "+N" indicator. */
  max?: number;
  /** Avatar size class, e.g. "h-5 w-5". */
  sizeClassName?: string;
}

function AuthorAvatar({
  pubkey,
  sizeClassName,
}: {
  pubkey: string;
  sizeClassName: string;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name || genUserName(pubkey);
  const avatarUrl = metadata?.picture;

  return (
    <Avatar className={cn('ring-2 ring-background', sizeClassName)}>
      <AvatarImage src={avatarUrl} alt={displayName} />
      <AvatarFallback className="bg-gradient-to-br from-amber-400 to-orange-500 text-white text-[9px]">
        {displayName.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export function DayAuthorAvatars({
  pubkeys,
  max = 3,
  sizeClassName = 'h-5 w-5',
}: DayAuthorAvatarsProps) {
  if (pubkeys.length === 0) return null;

  const shown = pubkeys.slice(0, max);
  const overflow = pubkeys.length - shown.length;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((pubkey) => (
          <AuthorAvatar key={pubkey} pubkey={pubkey} sizeClassName={sizeClassName} />
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1 text-[10px] font-medium text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
  );
}
