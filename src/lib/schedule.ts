import { Time } from "./time.js";
import { flatten, toLocalDateString } from "./utility.js";
import { isPeriod, parseTimeRange } from "./period-parser.js";

// a rule scheduled at an explicit time is due for the minute starting at that time - the loop ticks
// every 30s and isn't aligned to wall clock boundaries, so an exact match would almost always be missed
const ScheduledTimeWindowMs = 60000;

const MillisInDay = 24 * 60 * 60 * 1000;
const InvalidExplicitTimeError = "invalid every - expected an explicit time in HH:mm or HH:mm:ss format (example: 5:00 or 19:30)";
const MixedScheduleError = "invalid every - cannot mix durations and explicit times";
const InvalidExceptAtError = "invalid except-at - expected a time range in HH:mm-HH:mm format (example: 09:00-11:00)";
// stricter than the Time regex, which allows values like 24:30
const ValidExplicitTimeRegex = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// true when every is intended as a schedule of explicit times rather than a duration - a list is always
// treated as one, as are values containing a colon, so that malformed times report a useful error
export function isExplicitTimeSchedule(every: string | string[]): boolean {
    const entries = toEntries(every);
    if (entries.length === 0) {
        return false;
    }
    return Array.isArray(every) || entries.some(x => x.includes(":"));
}

export function parseExplicitTimes(every: string | string[]): Time[] {
    const entries = toEntries(every);
    if (entries.length === 0) {
        throw new Error(`${ InvalidExplicitTimeError } (got: '${ every }')`);
    }
    const times = entries.filter(x => ValidExplicitTimeRegex.test(x));
    const durations = entries.filter(x => isPeriod(x));
    if (times.length > 0 && durations.length > 0) {
        throw new Error(`${ MixedScheduleError } (got: '${ entries.join(", ") }')`);
    }
    const invalid = entries.filter(x => !times.includes(x));
    if (invalid.length > 0) {
        throw new Error(`${ InvalidExplicitTimeError } (got: '${ invalid.join(", ") }')`);
    }
    return times.map(x => new Time(x));
}

// returns an identifier for the scheduled time that is due right now, or null if none is
export function getDueTimeSlot(times: Time[], now: Date): string | null {
    const millisSinceStartOfDay = new Time(now).millisSinceStartOfDay;
    for (const time of times) {
        let elapsed = millisSinceStartOfDay - time.millisSinceStartOfDay;
        let dayOffset = 0;
        if (elapsed < 0) {
            // the slot may belong to yesterday if we've just rolled past midnight
            elapsed += MillisInDay;
            dayOffset = -1;
        }
        if (elapsed < ScheduledTimeWindowMs) {
            const slotDay = new Date(+now + dayOffset * MillisInDay);
            return `${ toLocalDateString(slotDay) }T${ time.time }`;
        }
    }
    return null;
}

export interface ITimeRange {
    start: Time;
    end: Time;
}

export function parseExceptAtRanges(exceptAt: string | string[]): ITimeRange[] {
    const entries = toEntries(exceptAt);
    if (entries.length === 0) {
        throw new Error(`${ InvalidExceptAtError } (got: '${ exceptAt }')`);
    }
    return entries.map(entry => {
        const range = parseTimeRange(entry);
        if (!range) {
            throw new Error(`${ InvalidExceptAtError } (got: '${ entry }')`);
        }
        return range;
    });
}

export function isWithinAnyTimeRange(ranges: ITimeRange[], now: Date): boolean {
    const time = new Time(now);
    return ranges.some(range => isWithinRange(time, range));
}

function isWithinRange(time: Time, range: ITimeRange): boolean {
    if (range.end.millisSinceStartOfDay < range.start.millisSinceStartOfDay) {
        // the range wraps past midnight, example: 23:00-02:00
        return time.millisSinceStartOfDay >= range.start.millisSinceStartOfDay
            || time.millisSinceStartOfDay <= range.end.millisSinceStartOfDay;
    }
    return time.isBetween(range.start, range.end);
}

function toEntries(every: string | string[]): string[] {
    return flatten([every])
        .filter(x => !!x?.toString().trim())
        .map(x => x.toString().trim());
}
