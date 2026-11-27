# Daily Gratitude Calendar - Custom Nostr Events

This document describes the custom event kinds used by the Daily Gratitude Calendar application.

Daily Wisdom adds no event kinds or tags. Its optional interaction history is
stored locally per account and references the existing daily entry address.
Private entries retain NIP-44 self-encryption; wisdom context is not appended
to their public metadata. See [Daily Wisdom](docs/DAILY_WISDOM.md) for storage,
privacy limits, source provenance, and the future reflection-analysis foundation.

## Event Kinds

### Kind 36669: Daily Gratitude Entry

A replaceable event that stores a user's gratitude reflection for a specific day. Uses the date (YYYY-MM-DD) as the `d` tag identifier, ensuring only one gratitude entry exists per user per day.

**Kind**: `36669` (Addressable/Replaceable)

**Description**: Records a user's daily gratitude reflection with optional sharing to the Nostr community.

#### Tags

- `d` (required): Date identifier in YYYY-MM-DD format (e.g., "2024-12-06")
- `published_at` (required): Unix timestamp when the entry was created
- `day` (required): Day of year (1-365/366)
- `alt` (required): Human-readable description for NIP-31 compatibility. On private entries it is the fixed text `Encrypted gratitude journal entry`, so it reveals nothing about the content.
- `encrypted` (private entries only): `["encrypted", "nip44"]`. An entry is private if and only if it carries this tag; clients must not guess privacy from the shape of the content.

#### Content

The `content` field holds all of the user's notes for that day in one event. It is plain text, never JSON.

- **Several notes:** each note is trimmed, empty notes are dropped, and the notes are joined with exactly one blank line (`\n\n`). A single newline stays inside a note, so a note can span several lines.
- **Reading:** normalize `\r\n` and lone `\r` to `\n`, split on one or more blank lines (lines holding only spaces or tabs count as blank), trim each note and drop empty ones.
- **Empty content** is never published.
- **Public entries** carry this plain text as-is.
- **Private entries** carry the same plain text encrypted with NIP-44 (version 2) to the author's own key, so only the author can read it. The tags above stay unencrypted, so the date, day of year, publish time and the fact that the entry is private are visible to anyone who can read the relay.

#### Example Event

```json
{
  "kind": 36669,
  "content": "I'm grateful for the warm sunshine this morning and the unexpected phone call from an old friend. Small moments like these remind me of life's simple joys.",
  "tags": [
    ["d", "2024-12-06"],
    ["published_at", "1733529600"],
    ["day", "341"],
    ["alt", "Daily gratitude entry for December 6, 2024 (Day 341)"]
  ],
  "created_at": 1733529600,
  "pubkey": "...",
  "id": "...",
  "sig": "..."
}
```

#### Implementation Notes

- The `d` tag ensures only one entry per day per user (replaceable behavior)
- Users can update their gratitude entry throughout the day
- The `day` tag allows querying entries by day of year
- Entries are stored on public relays. A public entry's content is readable by anyone; a private entry's content is encrypted (see Content), but its tags and timestamps are not
- The application filters entries to show only the current user's entries by default
- Users can optionally browse gratitude entries from others in the community

#### Query Examples

**Get all gratitude entries for a specific user:**
```typescript
const events = await nostr.query([
  {
    kinds: [36669],
    authors: [userPubkey],
    limit: 100
  }
], { signal });
```

**Get a specific day's entry for a user:**
```typescript
const events = await nostr.query([
  {
    kinds: [36669],
    authors: [userPubkey],
    '#d': ['2024-12-06']
  }
], { signal });
```

**Get recent community gratitude entries:**
```typescript
const events = await nostr.query([
  {
    kinds: [36669],
    limit: 50
  }
], { signal });
```
