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
  const today = new Date();
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
