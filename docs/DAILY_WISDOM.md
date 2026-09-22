# Daily Wisdom reflections

Daily Wisdom stays in the existing TodayHero card. Its secondary “Reflect on
this” action opens a bottom sheet, with a source, a short Grateful Day reading,
and one question. “Add to today's reflection” carries that question into the
existing DayDetailDialog and focuses a normal gratitude moment. The question is
context, never automatically inserted into the user's writing. It can be removed.

“Your Wisdom” lives beside Past Reflections, including January 1 when no past
days exist yet. It shows only deliberate interactions, with details and any
associated saved daily reflection. There is no new route, primary tab, feed,
search, notification, or AI analysis.

## Content and compatibility

`WisdomItem` supports stable IDs, text, author, source/work, era, interpretation,
prompt, themes, and provenance (original, translation, or adaptation with credit,
source URL, and passage location). Source metadata is optional for compatibility;
missing provenance is explicitly unverified, and missing questions use a neutral
Grateful Day prompt. Adaptations are labelled and are not presented as verbatim
quotations. Interpretations are labelled “A reading by Grateful Day.”

The six-item V1 collection starts on **2026-09-12** and stays in effect through
**2026-09-21**. Selection is deterministic by local calendar day, using
UTC-normalized dates to avoid DST drift. Dates before 2026-09-12 retain the
previous `getQuoteForDay` result. The legacy quote data and API, daily
affirmations, entry format, and sharing controls remain compatible.

From **2026-09-22**, the daily passage comes from a rotation long enough that a
year does not repeat one. It keeps the 400 public-domain readings from Marcus
Aurelius (George Long), Epictetus (Thomas Wentworth Higginson), the Dhammapada
(F. Max Müller), and the Tao Te Ching (James Legge), and weaves in civic wisdom
from Benjamin Franklin, Abraham Lincoln, George Washington, and Thomas
Jefferson. Those passages are their own words, including political counsel
about debt, parties, disagreement, and the uses of power. One of them follows
every third item from the longer collection, so September 22 is unchanged and
September 25 is the first of the civic set. Each item keeps its own Grateful
Day reading and question. V1 wording and order are unchanged.

To grow the collection, add items with new stable IDs and append an effective-
dated schedule in `wisdom.ts`; keep previous schedules and their item order
unchanged. No UI changes are needed. Do not silently revise historical wording:
publish a new item ID for a changed edition or adaptation. Interactions store a
snapshot of the public wisdom so even retired items remain readable in history.

### Verified seed sources

Checked against these editions on September 12, 2026. Every interpretation and
question is original Grateful Day editorial writing, separate from the excerpts.

| Item | Source and provenance |
| --- | --- |
| Gracián: patience | [The Art of Worldly Wisdom, maxim 55](https://sacred-texts.com/book/the-art-of-worldly-wisdom/read/50-99), Joseph Jacobs translation (1892). The actual heading in this edition is “Wait.”; the longer popular wording was not substituted. |
| Marcus Aurelius: character | [Meditations, X.16](https://www.gutenberg.org/files/6920/6920-h/6920-h.htm), George Long translation. |
| Epictetus: perspective | [The Enchiridion, V](https://www.gutenberg.org/files/45109/45109-h/45109-h.htm), Thomas W. Higginson translation in the reproduced edition. |
| Franklin: resolution | [Autobiography, Part Two, fourth virtue](https://www.gutenberg.org/files/148/148-h/148-h.htm), original English. |
| Emerson: integrity | [Self-Reliance](https://www.gutenberg.org/cache/epub/16643/pg16643-images.html), original English, Essays: First Series (1841). |
| Seneca: time | [Moral Letters to Lucilius, Letter 1](https://constitutioncenter.org/the-constitution/historic-document-library/detail/seneca-moral-letters-to-luciliuson-saving-time-ca-65), Richard M. Gummere translation. |

## Interaction data and privacy

The versioned local store follows the project's pubkey-scoped localStorage
conventions: `gratefulday:wisdom:v1:<pubkey>`. The hook uses an external-store
subscription for same-tab and storage-event updates. Records are validated and
read fresh before writes; malformed records are ignored. Unavailable storage
falls back to memory with an inline notice rather than blocking gratitude saves.

Each record contains:

- A public wisdom snapshot and the calendar date of the interaction.
- `openedAt`: first explicit “Reflect on this” action. Rendering records nothing.
- `addedAt`: first explicit addition to that day's reflection; separate from open.
- `active`: whether this context is still attached to the day.
- Optional `reflection`: a NIP-01 address, saved event ID, and `linkedAt` timestamp.

A reflection link is created only after a successful, nonempty entry save whose
normalized text differs from the last loaded or successfully saved content.
An already linked entry's event ID is updated on later successful saves.
Opening, adding, saving an unchanged old entry, cancelling, or failed publishing
does not create a link. Removing context or successfully deleting the associated
entry removes its link while retaining the deliberate interaction in the journey.
Context can also be removed from past days without editing the saved entry.
Historical dates are independent: revisiting the same principle on another day
creates another record, not an engagement count.

**Reflection text is never copied into this local store.** Entries continue to use
kind 36669 with existing public/private controls and NIP-44 self-encryption.
No wisdom IDs, themes, prompts, or interaction timestamps are added to public
Nostr tags. Associated writing is loaded on demand through the existing entry
query and `useDecryptedEntry`; locked entries never display ciphertext. References
follow the addressable day's current version and existing deletion tombstones.

V1 history is local to this browser/device, with account isolation. It is not
encrypted at rest, so someone with access to the browser's storage can see the
wisdom interaction metadata, but not private reflection text. Clearing site data
removes this history; logging into another device does not restore it. Guests
have memory-only history. Signing in with an open guest draft preserves that
draft, including an empty editor, and adopts only its deliberately selected
wisdom, not all guest history. Save and Share wait for the day's entry query to
settle so a late relay response cannot overwrite a just-saved guest draft.
Switching away from a signed-in account resets the mounted editor and history.

## Nostr review and future foundation

Reviewed the [NIP list](https://github.com/nostr-protocol/nips),
[NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md),
[NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md), and
[NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md). V1 needs no new
event kind or schema extension. If cross-device interaction sync is added,
existing NIP-78 application data with NIP-44 self-encryption is the appropriate
place to investigate, rather than publishing private interests as plaintext tags.

Stable wisdom IDs, themes, dated interactions, and reflection address/event
references allow a future opt-in process to retrieve the user's own writing,
group recurring ideas, and cite the contributing reflections over a date range.
Such a process must recheck ownership, deletion, and decryption, and distinguish
editorial wisdom from tentative principles derived from the user's words.
Opened/added records alone are not evidence of a learned personal principle.
No derived-insight fields, AI calls, inference jobs, or new insight UI run in V1.

## Verification

`npm test` runs installation, TypeScript, ESLint, all Vitest tests, and the
production Vite build. New tests cover source metadata and fallbacks, stable
rotation and legacy dates, explicit open/close/add actions, context removal,
storage and remount persistence, account isolation, save failure and success,
private publication/decryption, guest login with a late existing entry, and
mobile sheet constraints. Browser QA checks the real sheet and editor handoff at
desktop and phone widths, including automatic editor focus and history details.
