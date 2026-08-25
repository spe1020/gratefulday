/**
 * Utility functions for the Daily Gratitude Calendar
 */

import { DAILY_QUOTES } from './data/dailyQuotes';
import { DAILY_AFFIRMATIONS } from './data/dailyAffirmations';

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
 * Get the day of year (1-365/366) for a given date.
 * Computed over UTC-normalized dates: local-Date millisecond division is off
 * by one for every date between a DST spring-forward and fall-back.
 */
export function getDayOfYear(date: Date): number {
  const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const start = Date.UTC(date.getFullYear(), 0, 0);
  return Math.round((current - start) / 86_400_000);
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
 * True only for a well-formed AND semantically valid YYYY-MM-DD string.
 * `d` tags come off the wire from arbitrary clients — a shape-only regex lets
 * "2026-02-30" inflate streak totals and mint phantom community day buckets,
 * so the components must round-trip through a real Date.
 */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
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
 * Deterministic index into a daily pool.
 * A coprime stride visits every item before repeating (when gcd(stride, length) = 1).
 * The year offset starts next calendar year at a different place in the cycle,
 * so Jan 1 is not locked to the same line forever. Independent strides keep
 * wisdom and affirmation from staying paired.
 */
function dailyPoolIndex(
  dayOfYear: number,
  year: number,
  length: number,
  stride: number,
  yearStride: number,
): number {
  if (length <= 0) return 0;
  const raw = (dayOfYear - 1) * stride + year * yearStride;
  return ((raw % length) + length) % length;
}

function calendarYear(year?: number): number {
  return year ?? new Date().getFullYear();
}

/** Safe cycling index: clamps out-of-range day numbers instead of indexing negatively. */
function cycleIndex(dayOfYear: number, length: number): number {
  return (((dayOfYear - 1) % length) + length) % length;
}

/**
 * Get a deterministic quote based on day of year (and calendar year).
 * The pool is sized for a leap year, so a given year does not repeat a line.
 */
export function getQuoteForDay(dayOfYear: number, year?: number): { text: string; author: string } {
  const index = dailyPoolIndex(dayOfYear, calendarYear(year), DAILY_QUOTES.length, 47, 19);
  return DAILY_QUOTES[index];
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

  return prompts[cycleIndex(dayOfYear, prompts.length)];
}

/**
 * Get a daily affirmation based on day of year (and calendar year).
 * The pool is sized for a leap year, so a given year does not repeat a line.
 */
export function getAffirmationForDay(dayOfYear: number, year?: number): string {
  const index = dailyPoolIndex(dayOfYear, calendarYear(year), DAILY_AFFIRMATIONS.length, 53, 23);
  return DAILY_AFFIRMATIONS[index];
}
