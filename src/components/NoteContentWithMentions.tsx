import { useMentionProfiles } from '@/hooks/useMentionProfiles';
import { renderTextWithMentions } from '@/lib/mentionUtils.tsx';

type NoteContentWithMentionsProps = {
  content: string;
};

export const NoteContentWithMentions = ({ content }: NoteContentWithMentionsProps) => {
  const mentionedProfiles = useMentionProfiles(content);
  const renderedContent = renderTextWithMentions(content, mentionedProfiles);

  return (
    <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words line-clamp-4">
      {renderedContent}
    </p>
  );
};
