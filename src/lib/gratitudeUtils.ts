/**
 * Utility functions for the Daily Gratitude Calendar
 */

export interface DayInfo {
  dayOfYear: number;
  date: Date;
  dateString: string; // YYYY-MM-DD format
  isToday: boolean;
  isFuture: boolean;
  isPast: boolean;
  isUnlocked: boolean;
}

/**
 * Get the day of year (1-365/366) for a given date
 */
export function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Get total days in a year (handles leap years)
 */
export function getTotalDaysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/**
 * Get the week of the year (ISO 8601 standard - week starts on Monday)
 * Returns week number (1-53)
 */
export function getWeekOfYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Convert Sunday (0) to 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Set to Thursday of current week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Check if a year is a leap year
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Get date from day of year
 */
export function getDateFromDayOfYear(year: number, dayOfYear: number): Date {
  const date = new Date(year, 0);
  date.setDate(dayOfYear);
  return date;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date is today (in local timezone)
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Check if a date is in the future (in local timezone)
 */
export function isFuture(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate > today;
}

/**
 * Get all days in the current year with metadata
 */
export function getAllDaysInYear(year: number): DayInfo[] {
  const totalDays = getTotalDaysInYear(year);
  const days: DayInfo[] = [];

  for (let dayOfYear = 1; dayOfYear <= totalDays; dayOfYear++) {
    const date = getDateFromDayOfYear(year, dayOfYear);
    const dateString = formatDateString(date);
    const todayCheck = isToday(date);
    const futureCheck = isFuture(date);
    const pastCheck = !todayCheck && !futureCheck;

    days.push({
      dayOfYear,
      date,
      dateString,
      isToday: todayCheck,
      isFuture: futureCheck,
      isPast: pastCheck,
      isUnlocked: !futureCheck, // Unlocked if today or past
    });
  }

  return days;
}

/**
 * Format a date for display (e.g., "Monday, December 6")
 */
export function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get a deterministic quote based on day of year
 */
export function getQuoteForDay(dayOfYear: number): { text: string; author: string } {
  const quotes = [
    { text: "Gratitude turns what we have into enough.", author: "Anonymous" },
    { text: "The root of joy is gratefulness.", author: "David Steindl-Rast" },
    { text: "Gratitude is not only the greatest of virtues, but the parent of all others.", author: "Cicero" },
    { text: "When I started counting my blessings, my whole life turned around.", author: "Willie Nelson" },
    { text: "Gratitude makes sense of our past, brings peace for today, and creates a vision for tomorrow.", author: "Melody Beattie" },
    { text: "Acknowledging the good that you already have in your life is the foundation for all abundance.", author: "Eckhart Tolle" },
    { text: "Gratitude is the healthiest of all human emotions.", author: "Zig Ziglar" },
    { text: "Let us be grateful to the people who make us happy.", author: "Marcel Proust" },
    { text: "Gratitude is the sign of noble souls.", author: "Aesop" },
    { text: "The struggle ends when gratitude begins.", author: "Neale Donald Walsch" },
    { text: "Enjoy the little things, for one day you may look back and realize they were the big things.", author: "Robert Brault" },
    { text: "Gratitude is the fairest blossom which springs from the soul.", author: "Henry Ward Beecher" },
    { text: "In ordinary life, we hardly realize that we receive a great deal more than we give.", author: "Dietrich Bonhoeffer" },
    { text: "Gratitude unlocks the fullness of life.", author: "Melody Beattie" },
    { text: "The more grateful I am, the more beauty I see.", author: "Mary Davis" },
    { text: "Gratitude is the wine for the soul. Go on. Get drunk.", author: "Rumi" },
    { text: "Trade your expectation for appreciation and the world changes instantly.", author: "Tony Robbins" },
    { text: "Gratitude is riches. Complaint is poverty.", author: "Doris Day" },
    { text: "Gratitude is a powerful catalyst for happiness.", author: "Amy Collette" },
    { text: "When you are grateful, fear disappears and abundance appears.", author: "Anthony Robbins" },
    { text: "Gratitude is the memory of the heart.", author: "Jean Baptiste Massieu" },
    { text: "Cultivate the habit of being grateful for every good thing that comes to you.", author: "Ralph Waldo Emerson" },
    { text: "Gratitude is the best attitude.", author: "Anonymous" },
    { text: "A grateful heart is a magnet for miracles.", author: "Anonymous" },
    { text: "Gratitude is happiness doubled by wonder.", author: "G.K. Chesterton" },
    { text: "The thankful receiver bears a plentiful harvest.", author: "William Blake" },
    { text: "Gratitude can transform common days into thanksgivings.", author: "William Arthur Ward" },
    { text: "As we express our gratitude, we must never forget that the highest appreciation is not to utter words but to live by them.", author: "John F. Kennedy" },
    { text: "Gratitude is the inward feeling of kindness received.", author: "Henry Van Dyke" },
    { text: "Silent gratitude isn't much use to anyone.", author: "Gladys Bronwyn Stern" },
  ];

  // Use modulo to cycle through quotes
  return quotes[(dayOfYear - 1) % quotes.length];
}

/**
 * Get a gratitude prompt based on day of year
 */
export function getPromptForDay(dayOfYear: number): string {
  const prompts = [
    "Someone who made you smile today",
    "A small moment of peace you experienced",
    "Something beautiful you noticed",
    "A kindness you received",
    "A lesson you learned",
    "A challenge that made you stronger",
    "Something that made you laugh",
    "A connection with another person",
    "Something in nature that inspired you",
    "A comfort you often take for granted",
    "A skill or ability you possess",
    "A memory that brings you joy",
    "Something you accomplished today",
    "A place that brings you peace",
    "Someone who believes in you",
    "A favorite food or meal",
    "A book, song, or art that touched you",
    "Your health or a part of your body",
    "A technology that makes life easier",
    "A tradition you cherish",
    "An opportunity you've been given",
    "Something soft or comfortable",
    "A problem that was solved",
    "Something you're looking forward to",
    "A choice you're free to make",
    "Something that smells wonderful",
    "A sound that soothes you",
    "A pet or animal",
    "Your home or shelter",
    "Clean water or fresh air",
    "A second chance you received",
    "Something you created",
    "A friend or family member",
    "Your favorite season",
    "A recent conversation",
    "Something colorful",
    "A warm beverage",
    "Time to rest",
    "A helpful stranger",
    "Your favorite color",
    "Something that surprised you",
    "A tool that helps you",
    "Morning or evening light",
    "A warm blanket or cozy clothing",
    "Something you learned recently",
    "A photograph or keepsake",
    "Your ability to imagine",
    "A safe place",
    "Something green or growing",
    "The stars or moon",
    "Your sense of humor",
    "A kindness you gave to someone",
    "Movement or exercise",
    "Something that tastes delicious",
    "A letter or message you received",
    "Your favorite room",
    "Something smooth or pleasant to touch",
    "A helpful habit",
    "The changing seasons",
    "A gift you've been given",
    "Your favorite time of day",
  ];

  // Use modulo to cycle through prompts
  return prompts[(dayOfYear - 1) % prompts.length];
}

/**
 * Get a daily affirmation based on day of year
 */
export function getAffirmationForDay(dayOfYear: number): string {
  const affirmations = [
    "I am worthy of love and happiness.",
    "I choose to see the beauty in each moment.",
    "I am grateful for the opportunities that come my way.",
    "I trust in my ability to overcome challenges.",
    "I am surrounded by abundance and joy.",
    "I radiate positivity and kindness.",
    "I am capable of creating positive change.",
    "I embrace each day with an open heart.",
    "I am strong, resilient, and full of potential.",
    "I attract wonderful experiences into my life.",
    "I am at peace with who I am becoming.",
    "I celebrate my progress, no matter how small.",
    "I am deserving of all good things.",
    "I choose gratitude over worry.",
    "I am connected to something greater than myself.",
    "I trust the journey and enjoy the process.",
    "I am enough, just as I am.",
    "I welcome growth and transformation.",
    "I am a source of light and inspiration.",
    "I honor my feelings and respect my boundaries.",
    "I am creating the life I want to live.",
    "I find joy in simple pleasures.",
    "I am patient with myself and others.",
    "I am open to receiving love and support.",
    "I believe in my dreams and take action.",
    "I am grateful for my unique gifts and talents.",
    "I choose to focus on what matters most.",
    "I am resilient and can handle whatever comes.",
    "I am surrounded by people who care about me.",
    "I am creating positive energy around me.",
    "I trust that everything is working out for my highest good.",
    "I am worthy of rest and self-care.",
    "I celebrate my achievements, big and small.",
    "I am learning and growing every single day.",
    "I am grateful for my body and all it does for me.",
    "I choose to see the good in others.",
    "I am creating meaningful connections.",
    "I am aligned with my purpose and values.",
    "I am grateful for the lessons life teaches me.",
    "I am confident in my ability to make good decisions.",
    "I am surrounded by beauty and wonder.",
    "I am creating space for what truly matters.",
    "I am grateful for the present moment.",
    "I am kind to myself and others.",
    "I am open to new possibilities and experiences.",
    "I am worthy of success and fulfillment.",
    "I choose to respond with love and compassion.",
    "I am grateful for the support I receive.",
    "I am creating a life filled with purpose and meaning.",
    "I trust in my inner wisdom and intuition.",
    "I am grateful for the gift of another day.",
    "I am becoming the best version of myself.",
    "I am worthy of all the good things life has to offer.",
    "I choose to focus on solutions, not problems.",
    "I am grateful for my ability to learn and adapt.",
    "I am creating positive change in my life.",
    "I am surrounded by love and support.",
    "I am grateful for the journey, not just the destination.",
    "I am enough, and I have enough.",
    "I choose to see challenges as opportunities.",
    "I am grateful for my strength and resilience.",
    "I am creating a life I love living.",
    "I trust that I am exactly where I need to be.",
    "I am grateful for the people who enrich my life.",
    "I am open to receiving abundance in all forms.",
    "I am creating harmony and balance in my life.",
    "I am grateful for my ability to make a difference.",
    "I choose to live with intention and purpose.",
    "I am worthy of peace, joy, and fulfillment.",
  ];

  // Use modulo to cycle through affirmations
  return affirmations[(dayOfYear - 1) % affirmations.length];
}
