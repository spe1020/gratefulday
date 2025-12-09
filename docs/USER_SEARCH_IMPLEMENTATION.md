# User Search Implementation

This document summarizes the implementation of user search functionality for inline username autocomplete.

## Implementation Overview

The feature allows users to mention other Nostr users by typing `@username` in the gratitude entry textarea. As they type, a dropdown appears with profile suggestions that can be selected via keyboard or mouse.

## Architecture

### Core Components

- **`src/lib/primalCache.ts`**: WebSocket-based service that connects to Primal's cache API for fast, reliable profile searches
- **`src/lib/profileSearchService.ts`**: React hook that provides search functionality using the Primal cache service
- **`src/components/AutocompleteTextarea.tsx`**: Textarea component with inline autocomplete UI
- **`src/components/DayDetailDialog.tsx`**: Modified to use the `AutocompleteTextarea` component

## Search Implementation

### Primal Cache Service

The implementation uses **Primal's cache API** (`wss://cache2.primal.net/v1`) for profile searches:

**Why Primal?**
- Most reliable long-term option with proven infrastructure
- Fast, dedicated search endpoint (`user_search`)
- Wide support in the Nostr ecosystem
- Automatic failover to `cache1.primal.net` if needed

**How it works:**
1. WebSocket connection to Primal cache endpoints
2. Sends search requests with format: `["REQ", requestId, {cache: ["user_search", {query, limit}]}]`
3. Receives kind 0 (metadata) events until EOSE (End of Stored Events)
4. Parses and returns profile data (name, picture, nip05, etc.)

### Search Flow

1. User types `@` followed by 2+ characters, OR types `nostr:npub...` / `nostr:nprofile...`
2. 500ms debounce delay for username searches (300ms for direct identifiers)
3. If input looks like npub/nprofile, parse and fetch profile directly from relays
4. Otherwise, query Primal cache for matching profiles by username
5. Display up to 10 results in dropdown with avatar, name, and nip05
6. User selects profile → replaces match with `nostr:npub1...` in text

## Features

- **Keyboard navigation**: Arrow keys to navigate, Enter to select, Escape to close
- **Rich profile display**: Shows avatar, display name, and NIP-05 identifier
- **Debounced search**: 500ms delay for usernames, 300ms for identifiers
- **Multiple input formats**: Supports `@username`, `@npub1...`, `@nprofile1...`, `nostr:npub1...`, `nostr:nprofile1...`
- **Fallback support**: If Primal search fails, users can directly paste npub/nprofile identifiers
- **Error handling**: Graceful fallback—users can always manually enter Nostr identifiers

## Technical Notes

- WebSocket connection auto-reconnects up to 3 times
- 5-second timeout per search request
- Profiles without names are filtered out
- Uses display_name with fallback to name field
- Singleton pattern for cache service to prevent multiple connections

## Fallback Strategy

If Primal cache is unavailable or returns no results, users can still mention people by:
1. Typing `@npub1...` or `@nprofile1...` directly
2. Typing `nostr:npub1...` or `nostr:nprofile1...` directly
3. The component will detect these patterns, fetch the profile from relays, and show it in the dropdown
4. If profile metadata cannot be fetched, the identifier is still inserted as a valid tag
