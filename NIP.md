# Daily Gratitude Calendar - Custom Nostr Events

This document describes the custom event kinds used by the Daily Gratitude Calendar application.

## Event Kinds

### Kind 36669: Daily Gratitude Entry

A replaceable event that stores a user's gratitude reflection for a specific day. Uses the date (YYYY-MM-DD) as the `d` tag identifier, ensuring only one gratitude entry exists per user per day.

**Kind**: `36669` (Addressable/Replaceable)

**Description**: Records a user's daily gratitude reflection with optional sharing to the Nostr community.

#### Tags

- `d` (required): Date identifier in YYYY-MM-DD format (e.g., "2024-12-06")
- `published_at` (required): Unix timestamp when the entry was created
- `day` (required): Day of year (1-365/366)
- `alt` (required): Human-readable description for NIP-31 compatibility

#### Content

The `content` field contains the user's gratitude text entry for that day. This is freeform text where users write what they're grateful for.

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
- Entries are private by default but stored on public relays (users should be aware content is readable by others)
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
