import * as crypto from "crypto";
import { log } from "../models/logger";
import { sleepMs } from "./sleep";
import { getEnvVar } from "./env";

Error.stackTraceLimit = Infinity;

export const DefaultLocale = getEnvVar("LC_ALL")
    || getEnvVar("LC_MESSAGES")
    || getEnvVar("LANG")
    || getEnvVar("LANGUAGE");
const defaultTimeZone = "Africa/Johannesburg";
let locale = correctCUTF8Locale(DefaultLocale || "en-US");
let timeZone = defaultTimeZone;

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
        const time = date.toLocaleTimeString(locale, { hour12: false, timeZone });
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
        return date.toLocaleDateString(locale, { timeZone });
    } catch (e) {
        throw new Error(`Invalid locale or timezone (locale: '${ locale }', timezone: '${ timeZone }')`);
    }
}

export function isToday(date: string, on?: Date): boolean {
    const inputDate = new Date(date + "T00:00:00");
    const currentDate = (on ?? new Date()).toLocaleString("en-US", { timeZone });
    const today = new Date(currentDate);
    inputDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return inputDate.getTime() === today.getTime();
}

export function dayOfWeek(date?: Date): number {
    const day = (date || new Date()).toLocaleString("en-US", {
        timeZone: timeZone,
        weekday: 'short'
    });
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
    locale = correctCUTF8Locale(config?.locale || DefaultLocale);
    timeZone = config?.timezone || defaultTimeZone;
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
            const msg = `Error ${ label }: ${ err.message }`;
            log(msg, err);
            lastError = err;
        }
        await sleepMs(delayBetweenAttempts);
    }
    if (throwOnEventualFailure && lastError) {
        throw lastError;
    }
    return null;
}
