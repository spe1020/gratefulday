import type { WisdomItem } from '../wisdom';

/** Verified excerpts; interpretations and questions are written by Grateful Day.
 * Keep IDs and this V1 schedule stable. See docs/DAILY_WISDOM.md for sources.
 */
export const DAILY_WISDOM: WisdomItem[] = [
  {
    id: 'gracian-wait-v1', text: 'Wait.', author: 'Baltasar Gracián',
    source: 'The Art of Worldly Wisdom', era: '1647', themes: ['patience', 'judgment'],
    provenance: { wording: 'translation', credit: 'Joseph Jacobs, 1892', location: 'Maxim 55', url: 'https://sacred-texts.com/book/the-art-of-worldly-wisdom/read/50-99' },
    interpretation: 'Patience can be an active choice. A pause sometimes gives a decision the information or perspective that urgency leaves out.',
    prompt: "Where could patience improve a decision you're making today?",
  },
  {
    id: 'marcus-character-v1', text: 'No longer talk at all about the kind of man that a good man ought to be, but be such.', author: 'Marcus Aurelius',
    source: 'Meditations', era: '2nd century CE', themes: ['character', 'usefulness'],
    provenance: { wording: 'translation', credit: 'George Long', location: 'Book X, 16', url: 'https://www.gutenberg.org/files/6920/6920-h/6920-h.htm' },
    interpretation: 'An ordinary action can express a value more clearly than a long explanation. This is an invitation to practice something small that you already believe matters.',
    prompt: 'What small action would put one of your values into practice today?',
  },
  {
    id: 'epictetus-perspective-v1', text: 'Men are disturbed not by things, but by the views which they take of things.', author: 'Epictetus',
    source: 'The Enchiridion', era: '2nd century CE', themes: ['perspective', 'judgment'],
    provenance: { wording: 'translation', credit: 'Thomas W. Higginson', location: 'Section V', url: 'https://www.gutenberg.org/files/45109/45109-h/45109-h.htm' },
    interpretation: 'The story we tell about an event can add to its weight. Looking at that story may make room for another response, without denying what happened or how it feels.',
    prompt: 'Is there a situation today that you could look at from another angle?',
  },
  {
    id: 'franklin-resolution-v1', text: 'Resolve to perform what you ought; perform without fail what you resolve.', author: 'Benjamin Franklin',
    source: 'The Autobiography of Benjamin Franklin', era: '18th century', themes: ['building', 'character'],
    provenance: { wording: 'original', location: 'Part Two, virtue 4: Resolution', url: 'https://www.gutenberg.org/files/148/148-h/148-h.htm' },
    interpretation: 'Choosing a commitment carefully is part of keeping it. One modest promise followed through can be more useful than a list of ambitious intentions.',
    prompt: 'What is one small promise you can realistically keep today?',
  },
  {
    id: 'emerson-integrity-v1', text: 'Nothing is at last sacred but the integrity of your own mind.', author: 'Ralph Waldo Emerson',
    source: 'Self-Reliance', era: '1841', themes: ['courage', 'character'],
    provenance: { wording: 'original', location: 'Self-Reliance, Essays: First Series', url: 'https://www.gutenberg.org/cache/epub/16643/pg16643-images.html' },
    interpretation: 'Other people can help us think, but their approval cannot settle every choice for us. There may be a moment today to say honestly what you think while remaining open to learning.',
    prompt: 'Where would being honest with yourself make a difference today?',
  },
  {
    id: 'seneca-time-v1', text: 'While we are postponing, life speeds by.', author: 'Seneca',
    source: 'Moral Letters to Lucilius', era: '1st century CE', themes: ['attention', 'relationships'],
    provenance: { wording: 'translation', credit: 'Richard M. Gummere', location: 'Letter 1, On Saving Time', url: 'https://constitutioncenter.org/the-constitution/historic-document-library/detail/seneca-moral-letters-to-luciliuson-saving-time-ca-65' },
    interpretation: 'Some things we value keep getting moved to a more convenient day. Giving one of them a little time now can be enough; this need not mean filling every hour.',
    prompt: 'What person or activity would you like to make a little time for today?',
  },
];
