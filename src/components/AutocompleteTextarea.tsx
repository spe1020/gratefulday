
import { useState, useRef, useEffect } from 'react';
import ReactDOMServer from 'react-dom/server';
import { useProfileSearchService } from '@/lib/profileSearchService';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { nip19 } from 'nostr-tools';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Loader2 } from 'lucide-react';
import { Profile } from '@/types/nostr';
import { useMentionProfiles } from '@/hooks/useMentionProfiles';
import { renderTextWithMentions as renderTextWithMentionsUtil } from '@/lib/mentionUtils.tsx';

type AutocompleteTextareaProps = {
  value: string;
  onChange: (value: string) => void;
};

export const AutocompleteTextarea = ({ value, onChange }: AutocompleteTextareaProps) => {
  const [suggestions, setSuggestions] = useState<Profile[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const mentionedProfiles = useMentionProfiles(value);
  const { searchProfiles, fetchProfile, parseIdentifier } = useProfileSearchService();
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);

  const handleBeforeInput = (event: React.FormEvent<HTMLDivElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    // This handler is for making mentions atomic
    if (nativeEvent.isComposing || nativeEvent.inputType === 'historyUndo' || nativeEvent.inputType === 'historyRedo') {
      return;
    }

    const selection = window.getSelection();
    if (!selection) return;
    const range = selection.getRangeAt(0);
    let node = range.startContainer;

    while (node && node !== contentEditableRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.mention) {
        event.preventDefault();

        // If we are trying to type, move the cursor after the mention
        if (nativeEvent.inputType === 'insertText' || nativeEvent.inputType === 'insertCompositionText') {
          const newRange = document.createRange();
          newRange.setStartAfter(node);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
        return;
      }
      const parent = node.parentNode;
      if (!parent) break;
      node = parent;
    }
  };

  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    if (contentEditableRef.current) {
      const nodes = renderTextWithMentionsUtil(value, mentionedProfiles);
      contentEditableRef.current.innerHTML = ReactDOMServer.renderToStaticMarkup(<>{nodes}</>);
    }
  }, [value, mentionedProfiles]);



  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {

    isInternalUpdate.current = true;

    const newText = htmlToPlainText(e.currentTarget);

    onChange(newText);

    

    const textBeforeCursor = getTextBeforeCursor(e.currentTarget);



    // Match @username, @npub1..., @nprofile1..., nostr:npub1..., or nostr:nprofile1...

    const atMatch = textBeforeCursor.match(/@([\w]+)$/);

    const nostrMatch = textBeforeCursor.match(/nostr:(npub1[\w]+|nprofile1[\w]+)$/);



    if (debounceTimeout.current) {

      clearTimeout(debounceTimeout.current);

    }



    // Handle nostr:npub... or nostr:nprofile... pattern

    if (nostrMatch) {

      const identifierString = nostrMatch[1];

      // Only parse if it looks like a complete identifier (58+ chars after npub1/nprofile1)

      if (identifierString.length >= 59) {

        try {

          const identifier = parseIdentifier(identifierString);

          if (identifier) {

            setSearching(true);

            setShowDropdown(true);

            debounceTimeout.current = setTimeout(async () => {

              const profile = await fetchProfile(identifier.pubkey);

              if (profile) {

                setSuggestions([profile]);

              } else {

                setSuggestions([]);

              }

              setSearching(false);

            }, 300);

          }

        } catch {
          // Invalid identifier, ignore
        }

      }

    } else if (atMatch) {

      const query = atMatch[1];



      // Check if it's already a valid nostr identifier (must be complete)

      if ((query.startsWith('npub1') || query.startsWith('nprofile1')) && query.length >= 59) {

        try {

          const identifier = parseIdentifier(query);

          if (identifier) {

            // It's a valid npub/nprofile, fetch the profile

            setSearching(true);

            setShowDropdown(true);

            debounceTimeout.current = setTimeout(async () => {

              const profile = await fetchProfile(identifier.pubkey);

              if (profile) {

                setSuggestions([profile]);

              } else {

                setSuggestions([]);

              }

              setSearching(false);

            }, 300);

          }

        } catch {
          // Invalid identifier, ignore
        }

      } else if (query.length >= 2 && !query.startsWith('npub1') && !query.startsWith('nprofile1')) {

        // Regular username search

        setSearching(true);

        setShowDropdown(true);

        debounceTimeout.current = setTimeout(async () => {

          const profiles = await searchProfiles(query);

          setSuggestions(profiles);

          setSearching(false);

        }, 500);

      }

    }

    else {

      setShowDropdown(false);

      setSuggestions([]);

    }

  };



  const getTextBeforeCursor = (element: HTMLDivElement): string => {

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) return '';

  

    const range = selection.getRangeAt(0);

    const preCaretRange = range.cloneRange();

    preCaretRange.selectNodeContents(element);

    preCaretRange.setEnd(range.startContainer, range.startOffset);

    

    const tempDiv = document.createElement('div');

    tempDiv.appendChild(preCaretRange.cloneContents());

  

    return htmlToPlainText(tempDiv);

  };



  const htmlToPlainText = (element: Node) => {

    let text = '';

    const nodes = Array.from(element.childNodes);

    nodes.forEach((node, index) => {

      if (node.nodeType === Node.TEXT_NODE) {

        text += node.textContent;

      } else if (node.nodeType === Node.ELEMENT_NODE) {

        const el = node as HTMLElement;

        if (el.dataset.mention) {

          text += el.dataset.mention;

          // Check if next node exists and is text that doesn't start with whitespace

          const nextNode = nodes[index + 1];

          if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {

            const nextText = nextNode.textContent || '';

            // If next text doesn't start with whitespace, add a space

            if (nextText && !/^\s/.test(nextText)) {

              text += ' ';

            }

          }

        } else {

          text += el.textContent;

        }

      }

    });

    return text;

  };



    const handleUserSelect = (profile: Profile) => {



      const selection = window.getSelection();



      if (!selection || !contentEditableRef.current) return;



  



      const range = selection.getRangeAt(0);



      const textBeforeCursor = getTextBeforeCursor(contentEditableRef.current);



      



      const atMatch = textBeforeCursor.match(/@([\w]+)$/);



      const nostrMatch = textBeforeCursor.match(/nostr:(npub1[\w]+|nprofile1[\w]+)$/);



  



      if (atMatch) {



        const match = atMatch[0];



        range.setStart(range.startContainer, range.startOffset - match.length);



        range.deleteContents();



      } else if (nostrMatch) {



        const match = nostrMatch[0];



        range.setStart(range.startContainer, range.startOffset - match.length);



        range.deleteContents();



      }



  



      const mention = `nostr:${nip19.npubEncode(profile.pubkey)}`;



      const pill = document.createElement('span');



      pill.contentEditable = 'false';



            pill.dataset.mention = mention;



            pill.className = "inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-md font-medium";



            pill.style.userSelect = 'all';



            pill.textContent = `@${profile.name || profile.pubkey.substring(0, 8)}`;



  



            range.insertNode(pill);



  



            



  



            const space = document.createTextNode('  '); // Two spaces



  



            range.setStartAfter(pill);



  



            range.insertNode(space);



  



            range.collapse(false); // to move cursor after space



  



      selection.removeAllRanges();



      selection.addRange(range);



  



      // Manually trigger handleInput to update the parent state



      if(contentEditableRef.current){



          handleInput({ currentTarget: contentEditableRef.current } as React.FormEvent<HTMLDivElement>);



      }



      



      setShowDropdown(false);



      setSuggestions([]);



    };



  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);

    // Handle Delete key to remove mention pill after cursor
    if (e.key === 'Delete' && range.collapsed) {
      const { startContainer, startOffset } = range;

      // Check if we're at the end of a text node and the next sibling is a mention
      if (startContainer.nodeType === Node.TEXT_NODE) {
        const textNode = startContainer as Text;
        if (startOffset === textNode.length) {
          const nextSibling = startContainer.nextSibling;
          if (nextSibling && nextSibling.nodeType === Node.ELEMENT_NODE && (nextSibling as HTMLElement).dataset.mention) {
            e.preventDefault();
            nextSibling.remove();
            if (contentEditableRef.current) {
              handleInput({ currentTarget: contentEditableRef.current } as React.FormEvent<HTMLDivElement>);
            }
            return;
          }
        }
      }
    }

    // Handle Backspace to remove mention pill before cursor
    if (e.key === 'Backspace') {
      // First check if a mention pill is selected (user-select: all makes this happen)
      if (!range.collapsed) {
        const container = range.commonAncestorContainer;
        let mentionElement: HTMLElement | null = null;

        if (container.nodeType === Node.ELEMENT_NODE) {
          const el = container as HTMLElement;
          if (el.dataset.mention) {
            mentionElement = el;
          }
        } else if (container.parentElement?.dataset.mention) {
          mentionElement = container.parentElement;
        }

        if (mentionElement) {
          e.preventDefault();
          mentionElement.remove();
          if (contentEditableRef.current) {
            handleInput({ currentTarget: contentEditableRef.current } as React.FormEvent<HTMLDivElement>);
          }
          return;
        }
      }

      // Handle backspace when cursor is at the start of a text node after a mention
      if (range.collapsed) {
        const { startContainer, startOffset } = range;
        if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
          const prevSibling = startContainer.previousSibling;
          if (prevSibling && prevSibling.nodeType === Node.ELEMENT_NODE && (prevSibling as HTMLElement).dataset.mention) {
            e.preventDefault();
            prevSibling.remove();
            if (contentEditableRef.current) {
              handleInput({ currentTarget: contentEditableRef.current } as React.FormEvent<HTMLDivElement>);
            }
            return;
          }
        }
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter' && highlightedIndex > -1) {
      e.preventDefault();
      handleUserSelect(suggestions[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };






  return (

    <div className="relative space-y-2">

            <div

              ref={contentEditableRef}

              onInput={handleInput}

              onKeyDown={handleKeyDown}

              onBeforeInput={handleBeforeInput}

              contentEditable={true}
              className="relative font-mono text-sm p-2 border rounded-md min-h-[80px]"
              data-placeholder="Share what you're grateful for..."
            />



      {showDropdown && (

        <Popover open={showDropdown} onOpenChange={setShowDropdown}>

          <PopoverTrigger asChild>

            <div />

          </PopoverTrigger>

          <PopoverContent

            onOpenAutoFocus={(e) => e.preventDefault()}

            className="w-80 shadow-lg rounded-lg border"

          >

            {searching && <Loader2 className="animate-spin" />}

            {suggestions.length > 0 ? (

              suggestions.map((profile, index) => (

                <div

                  key={profile.pubkey}

                  className={`p-2 cursor-pointer hover:bg-accent transition-colors ${highlightedIndex === index ? 'bg-accent' : ''}`}

                  onMouseDown={() => handleUserSelect(profile)}

                >

                  <div className="flex items-center gap-2">

                    <Avatar className="h-8 w-8">

                      <AvatarImage src={profile.picture} />

                      <AvatarFallback>{profile.name?.[0]?.toUpperCase()}</AvatarFallback>

                    </Avatar>

                    <div className="flex flex-col min-w-0">

                      <span className="text-sm font-medium truncate">{profile.name}</span>

                      {profile.nip05 && (

                        <span className="text-xs text-muted-foreground truncate">{profile.nip05}</span>

                      )}

                    </div>

                  </div>

                </div>

              ))

            ) : (

              !searching && <div className="p-2 text-sm text-muted-foreground">No results found</div>

            )}

          </PopoverContent>

        </Popover>

      )}

    </div>

  );

};
