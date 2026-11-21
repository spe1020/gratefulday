# Daily Gratitude Calendar ✨

A beautiful Nostr-based daily gratitude calendar that combines personal reflection with decentralized social features. Track your daily gratitude journey throughout the year and share your reflections with the Nostr community.

## Features

### 📅 Interactive Calendar
- **365-Day View**: Horizontal scrolling calendar showing all days of the current year
- **Day Progress**: See your current day of year (e.g., "Day 341 of 365") with visual progress bar
- **Smart Lock System**: Future days are locked until midnight in your local timezone
- **Visual Indicators**: 
  - Today's card is highlighted with a glowing ring
  - Completed days show a checkmark
  - Locked days display a lock icon

### ✍️ Daily Gratitude
- **Daily Wisdom**: Each day features an inspirational quote from philosophers and thinkers
- **Gratitude Prompts**: Thoughtful prompts to guide your reflection
- **Personal Reflections**: Write and save your daily gratitude entries
- **Edit Anytime**: Update your reflections throughout the day (entries are replaceable)

### 🌍 Community Features
- **Share on Nostr**: Optionally share your gratitude with the decentralized Nostr community
- **Community Feed**: Browse gratitude reflections from other users
- **Privacy-Aware**: Your entries are stored on public relays but filtered to show only your own by default

### 📱 Mobile-First Design
- **Touch-Friendly**: Smooth swipe navigation optimized for mobile devices
- **Auto-Scroll**: Automatically scrolls to today's date on app load
- **Snap-to-Center**: Cards snap to center when scrolling
- **Responsive Layout**: Beautiful experience on all screen sizes

### 🎨 Beautiful Design
- **Warm Color Palette**: Calming amber, orange, and rose tones
- **Smooth Animations**: Delightful transitions and micro-interactions
- **Dark Mode**: Full support for dark mode preferences
- **Gradient Accents**: Subtle gradients and glows for visual depth

## Technology Stack

- **React 18** with TypeScript
- **Nostr Protocol** via Nostrify
- **TailwindCSS** for styling
- **shadcn/ui** components
- **TanStack Query** for data fetching
- **Vite** for blazing-fast builds

## Nostr Implementation

### Custom Event Kind: 36669

The application uses a custom addressable event kind for storing gratitude entries:

- **Kind**: `36669` (Addressable/Replaceable)
- **Purpose**: Daily gratitude reflections
- **Tags**:
  - `d`: Date identifier (YYYY-MM-DD)
  - `published_at`: Unix timestamp
  - `day`: Day of year (1-365/366)
  - `alt`: Human-readable description

See [NIP.md](./NIP.md) for full specification.

### Relay Configuration

The app uses NIP-65 relay management with these default relays:
- wss://relay.ditto.pub
- wss://relay.nostr.band
- wss://relay.damus.io

Users can manage their relay connections through the settings.

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Nostr account (or create one within the app)

### Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

The development server will start on **http://localhost:8080**.

### Detailed Setup Guide

For comprehensive local development setup instructions, troubleshooting, and development workflow, see [**docs/LOCAL_SETUP.md**](./docs/LOCAL_SETUP.md).

### Usage

1. **Browse the Calendar**: Scroll through the year to see all 365 days
2. **Open a Day**: Click on any unlocked day card to see details
3. **Read the Wisdom**: Each day features a unique inspirational quote
4. **Reflect on the Prompt**: Consider the daily gratitude prompt
5. **Write Your Entry**: Add your personal gratitude reflection
6. **Save & Share**: Log in with Nostr to save your entries

## Project Structure

```
src/
├── components/
│   ├── CalendarView.tsx       # Main calendar scroll interface
│   ├── DayCard.tsx             # Individual day card component
│   ├── DayDetailDialog.tsx     # Day detail modal with entry form
│   ├── CommunityFeed.tsx       # Community gratitude feed
│   └── auth/                   # Authentication components
├── hooks/
│   ├── useGratitudeEntries.ts  # Fetch gratitude entries
│   └── ...
├── lib/
│   └── gratitudeUtils.ts       # Date calculations and content
└── pages/
    └── Index.tsx               # Main application page
```

## Features Roadmap

Future enhancements could include:

- [ ] Monthly/yearly statistics and insights
- [ ] Streak tracking and achievements
- [ ] Export gratitude journal as PDF
- [ ] Share individual days as images
- [ ] Follow other users' gratitude journeys
- [ ] Notifications for daily reminders
- [ ] Multi-language support
- [ ] Custom themes and color schemes

## Contributing

This is an open-source project built on Nostr. Contributions are welcome!

## License

MIT License - see [LICENSE](LICENSE) for details

## Acknowledgments

- Built with [Shakespeare](https://shakespeare.diy) - AI-powered website builder
- Powered by the decentralized Nostr protocol
- Inspired by the practice of daily gratitude

---

**Start your gratitude journey today!** ✨
