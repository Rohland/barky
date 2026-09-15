import * as crypto from "crypto";
import { log } from "../models/logger.js";
import { sleepMs } from "./sleep.js";
import { getEnvVar } from "./env.js";

Error.stackTraceLimit = Infinity;

/*
 LANG and friends hold POSIX locale names (en_ZA.UTF-8, C.UTF-8) which Intl rejects outright, so
 they are converted to a BCP 47 tag where possible and discarded where not. An explicitly
 configured locale is deliberately left alone - a bad one there should fail loudly.
 */
function fromPosixLocale(locale: string): string {
    if (!locale) {
        return null;
    }
    const tag = locale.split(/[.@]/)[0].replace(/_/g, "-");
    if (!tag || /^(C|POSIX)$/i.test(tag)) {
        return null;
    }
    try {
        new Intl.DateTimeFormat(tag);
        return tag;
    } catch {
        return null;
    }
}

export const DefaultLocale = fromPosixLocale(
    getEnvVar("LC_ALL")
    || getEnvVar("LC_MESSAGES")
    || getEnvVar("LANG")
    || getEnvVar("LANGUAGE"));
const WeekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const defaultTimeZone = "Africa/Johannesburg";
let locale = correctCUTF8Locale(DefaultLocale || "en-US");
let timeZone = defaultTimeZone;

// Constructing a formatter is ~45x more expensive than using one, and the toLocaleX methods construct one
// on every call. These are cached per locale/timezone and reset by initLocaleAndTimezone.
// The component options replicate the defaults each toLocaleX method fills in, so output is unchanged.
const TimeParts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "numeric", second: "numeric" };
const DateParts: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };
// h23 is forced so midnight is always "00", never the "24" some locales emit under hour12: false
const IsoParts: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
};

let timeFormatter: Intl.DateTimeFormat;
let dateFormatter: Intl.DateTimeFormat;
let dateTimeFormatter: Intl.DateTimeFormat;
let weekdayFormatter: Intl.DateTimeFormat;
let isoFormatter: Intl.DateTimeFormat;

function resetFormatters() {
    timeFormatter = null;
    dateFormatter = null;
    dateTimeFormatter = null;
    weekdayFormatter = null;
    isoFormatter = null;
}

function getTimeFormatter() {
    return timeFormatter ??= new Intl.DateTimeFormat(locale, { hour12: false, timeZone, ...TimeParts });
}

function getDateFormatter() {
    return dateFormatter ??= new Intl.DateTimeFormat(locale, { timeZone, ...DateParts });
}

function getDateTimeFormatter() {
    return dateTimeFormatter ??= new Intl.DateTimeFormat("en-US", { timeZone, ...DateParts, ...TimeParts });
}

function getWeekdayFormatter() {
    return weekdayFormatter ??= new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
}

function getIsoFormatter() {
    return isoFormatter ??= new Intl.DateTimeFormat("en-US", { timeZone, ...IsoParts });
}

export function flatten<T>(arr: T[]) {
    if (arr === null || arr === undefined) {
        return [];
    }
    return Array.isArray(arr)
        // @ts-ignore
        ? arr.reduce((a, b) => a.concat(flatten<T>(b)), [])
        : [arr];
}

export function pluraliseWithS(word: string, count: number) {
    return count === 1 ?
        word :
        `${ word }s`;
}

export interface ILocalTimeStringOptions {
    noSeconds?: boolean;
}

export function toLocalTimeString(date: Date, options: ILocalTimeStringOptions = null) {
    try {
        const time = getTimeFormatter().format(date);
        if (options?.noSeconds) {
            return time.substring(0, time.lastIndexOf(":"));
        }
        return time;
    } catch (e) {
        throw new Error(`Invalid locale or timezone (locale: '${ locale }', timezone: '${ timeZone }')`);
    }
}

export function toLocalDateString(date: Date) {
    try {
        return getDateFormatter().format(date);
    } catch (e) {
        throw new Error(`Invalid locale or timezone (locale: '${ locale }', timezone: '${ timeZone }')`);
    }
}

export interface ILocalDateAndTime {
    date: string; // YYYY-MM-DD
    time: string; // HH:MM
}

/*
 Returns the calendar date and time of day as observed in the *configured* timezone, rather than
 the timezone the process happens to be running in. Anything persisting a date or time that is
 later evaluated against the configured timezone (mute windows, for example) must use this.
 */
export function toLocalDateAndTime(date: Date): ILocalDateAndTime {
    try {
        const parts = getIsoFormatter()
            .formatToParts(date)
            .reduce((acc, part) => {
                acc[part.type] = part.value;
                return acc;
            }, {});
        return {
            date: `${ parts["year"] }-${ parts["month"] }-${ parts["day"] }`,
            time: `${ parts["hour"] }:${ parts["minute"] }`
        };
    } catch (e) {
        throw new Error(`Invalid locale or timezone (locale: '${ locale }', timezone: '${ timeZone }')`);
    }
}

function offsetMsAt(instant: Date): number {
    const local = toLocalDateAndTime(instant);
    const wallAsUtc = Date.parse(`${ local.date }T${ local.time }:00Z`);
    const flooredToMinute = Math.floor(instant.getTime() / 60_000) * 60_000;
    return wallAsUtc - flooredToMinute;
}

/*
 The inverse of toLocalDateAndTime - takes a wall clock date (YYYY-MM-DD) and time (HH:MM) as it
 would read in the configured timezone, and returns the instant it refers to.
 */
export function fromLocalDateAndTime(date: string, time: string): Date {
    const wallAsUtc = Date.parse(`${ date }T${ time }:00Z`);
    if (Number.isNaN(wallAsUtc)) {
        throw new Error(`invalid date or time ('${ date }', '${ time }')`);
    }
    const offset = offsetMsAt(new Date(wallAsUtc));
    const candidate = new Date(wallAsUtc - offset);
    // the offset can differ either side of a DST boundary, so settle using the offset at the
    // instant we actually landed on
    const settledOffset = offsetMsAt(candidate);
    return settledOffset === offset
        ? candidate
        : new Date(wallAsUtc - settledOffset);
}

/*
 Steps a wall clock date (YYYY-MM-DD) forward or back by whole calendar days. Anchored at midday
 UTC purely so the arithmetic does not trip over a DST boundary.
 */
export function addLocalDays(date: string, days: number): string {
    const cursor = new Date(`${ date }T12:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + days);
    return cursor.toISOString().substring(0, 10);
}

// 0 is Sunday, matching dayOfWeek
export function localWeekday(date: string): number {
    return new Date(`${ date }T12:00:00Z`).getUTCDay();
}

export function localWeekdayName(date: string): string {
    return WeekdayNames[localWeekday(date)];
}

export function isToday(date: string, on?: Date): boolean {
    const inputDate = new Date(date + "T00:00:00");
    const currentDate = getDateTimeFormatter().format(on ?? new Date());
    const today = new Date(currentDate);
    inputDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return inputDate.getTime() === today.getTime();
}

export function dayOfWeek(date?: Date): number {
    const day = getWeekdayFormatter().format(date || new Date());
    const lookup = {
        'Sun': 0,
        'Mon': 1,
        'Tue': 2,
        'Wed': 3,
        'Thu': 4,
        'Fri': 5,
        'Sat': 6,
    };
    return lookup[day];
}

function correctCUTF8Locale(locale: string) {
    if (locale === 'C.UTF-8') {
        return 'en-US';
    }
    return locale;
}

export function initLocaleAndTimezone(config) {
    locale = correctCUTF8Locale(config?.locale || DefaultLocale || "en-US");
    timeZone = config?.timezone || defaultTimeZone;
    resetFormatters();
}

export function hash(key: string) {
    return crypto
        .createHash('md5')
        .update(key ?? "")
        .digest("hex");
}

export function shortHash(key: string) {
    return crypto
        .createHash('shake256', {
            outputLength: 4
        })
        .update(key ?? "")
        .digest("hex");
}

export async function tryExecuteTimes<T>(
    label: string,
    times: number,
    func: () => Promise<T>,
    throwOnEventualFailure: boolean = true,
    delayBetweenAttempts: number = 500): Promise<T> {
    let counter = 0;
    let lastError = null;
    while(counter++ < times) {
        try {
            return await func();
        } catch(err) {
            const msg = `Error ${ label }: ${ err ? err["message"] : "" }`;
            log(msg, err);
            lastError = err;
        }
        await sleepMs(delayBetweenAttempts);
    }
    if (throwOnEventualFailure && lastError) {
        throw new Error(`Error executing ${ label} after ${ times } attempts`, { cause: lastError });
    }
    return null;
}
