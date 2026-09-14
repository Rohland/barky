import { dayOfWeek, flatten, fromLocalDateAndTime, toLocalDateAndTime, toLocalTimeString } from "./utility.js";
import { parseDaysOfWeek, parseTimeRange } from "./period-parser.js";

export class Time {
    time: string;
    hours: number;
    minutes: number;
    seconds: number;
    millis: number;

    constructor(time: Date | string) {
        if (time instanceof Date) {
            this.parseDate(time);
        } else {
            this.parseTime(time);
        }
    }

    private parseDate(date: Date) {
        this.time = toLocalTimeString(date);
        const [hours, minutes, seconds] = this.time.split(":").map(Number);
        this.hours = hours;
        this.minutes = minutes;
        this.seconds = seconds;
        this.millis = date.getMilliseconds();
    }

    private parseTime(time: string) {
        const match = /^(\d{1,2}):(\d{2})(:(\d{2})(\.(\d{3}))?)?$/.exec(time);
        if (!match) {
            throw new Error(`Invalid time string: '${ time }'`);
        }
        this.time = time.match(/^\d:/) ? `0${ time }` : time;
        this.hours = parseInt(match[1]);
        this.minutes = parseInt(match[2]);
        this.seconds = match[4] ? parseInt(match[4]) : 0;
        this.millis = match[6] ? parseInt(match[6]) : 0;
    }

    public static isNowBetween(start: Time, end: Time) {
        const now = new Time(new Date());
        return now.isBetween(start, end);
    }

    public isBetween(start: Time, end: Time): boolean {
        const millisInDay = 24 * 60 * 60 * 1000;
        const millisSinceStart = this.millisSinceStartOfDay % millisInDay
        return (millisSinceStart >= start.millisSinceStartOfDay && millisSinceStart <= end.millisSinceStartOfDay)
            || (millisSinceStart + millisInDay >= start.millisSinceStartOfDay && millisSinceStart + millisInDay <= end.millisSinceStartOfDay);
    }

    get millisSinceStartOfDay(): number {
        return this.millis + this.seconds * 1000 + this.minutes * 60 * 1000 + this.hours * 60 * 60 * 1000;
    }
}

export function toLocalTime(date: Date): Time {
    return new Time(date);
}

export interface IBusinessHours {
    days?: string[];
    start?: string;
}

export const DefaultBusinessDays = ["mon", "tue", "wed", "thu", "fri"];
export const DefaultBusinessStart = "08:00";

/*
 Returns the next instant at which business hours begin, in the configured timezone.

 Note this is deliberately *not* "the start of the next calendar business day" - someone muting an
 alert at 02:00 on a Tuesday wants quiet until the team picks it up at 08:00 that same morning, not
 until Wednesday. So it resolves to the next occurrence of the business start time that is still
 ahead of us, skipping non-business days:

   Tue 02:00 -> Tue 08:00      Fri 14:00 -> Mon 08:00
   Tue 10:00 -> Wed 08:00      Sat 09:00 -> Mon 08:00
 */
export function nextBusinessHoursStart(
    options?: IBusinessHours,
    now?: Date): Date {
    const days = parseDaysOfWeek(options?.days?.length > 0 ? options.days : DefaultBusinessDays);
    if (days.length === 0) {
        throw new Error("expected at least one business day to be configured");
    }
    const startTime = new Time(options?.start ?? DefaultBusinessStart);
    const wallTime = `${ pad(startTime.hours) }:${ pad(startTime.minutes) }`;
    const from = now ?? new Date();
    // anchored at midday UTC purely to step calendar days without tripping over DST boundaries
    const cursor = new Date(`${ toLocalDateAndTime(from).date }T12:00:00Z`);
    const maxDaysToScan = 14;
    for (let i = 0; i <= maxDaysToScan; i++) {
        const candidate = fromLocalDateAndTime(cursor.toISOString().substring(0, 10), wallTime);
        if (candidate > from && days.includes(dayOfWeek(candidate))) {
            return candidate;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    throw new Error(`could not resolve the next business day within ${ maxDaysToScan } days`);
}

function pad(value: number): string {
    return value.toString().padStart(2, "0");
}

export function humanizeDuration(time: number, type: string = "m"): string {
    let minutes = time;
    let defaultTypeText = "mins";
    switch (type?.toLowerCase()?.trim()) {
        case "s":
            minutes = time / 60;
            defaultTypeText = "s";
            break;
        case "m":
            minutes = time;
            defaultTypeText = "m";
            break;
        case "h":
            minutes = time * 60;
            defaultTypeText = "h";
            break;
    }
    const secondsText = humanizeSeconds((minutes - Math.floor(minutes)) * 60);
    const minsText = humanizeMinutes(minutes % 60);
    const hoursText = humanizeHours(minutes / 60);
    const text = [hoursText, minsText, secondsText].filter(x => !!x).join(", ");
    if (text.length === 0) {
        return `0${ defaultTypeText }`;
    }
    return text.replace(/,\s+([^,]+)$/, ` and $1`);
}

function floorWithConsiderationToFloatingOffset(value: number) {
    const isCeiling = value !== 0 && Math.ceil(value) - value < 0.00001;
    return isCeiling ? Math.ceil(value) : Math.floor(value);
}

function humanizeSeconds(seconds: number) {
    const value = floorWithConsiderationToFloatingOffset(seconds);
    return value === 0 ?
        "" :
        `${ value }s`;
}

function humanizeMinutes(minutes: number) {
    const value = floorWithConsiderationToFloatingOffset(minutes);
    return value === 0 ?
        "" :
        `${ value }m`;
}

function humanizeHours(hours: number) {
    const value = floorWithConsiderationToFloatingOffset(hours);
    return value === 0 ?
        "" :
        `${ value }h`;
}

export class DayAndTimeEvaluator {

    private _daysOfWeek: number [];
    private _times: string[]

    constructor(daysOfWeek: string | string[], times: string | string[]) {
        this._daysOfWeek = parseDaysOfWeek(flatten([daysOfWeek]));
        this._times = flatten([times]);
    }

    isValidNow(date?: Date): boolean {
        const hasDateRule = this._daysOfWeek?.length > 0;
        const hasTimeRule = this._times.length > 0;
        let dateMatches = true;
        let timeMatches = true;
        if (hasDateRule) {
            dateMatches = this.isToday(date);
        }
        if (hasTimeRule) {
            timeMatches = this.isValidAtTime(date);
        }
        return dateMatches && timeMatches;
    }

    private isValidAtTime(date?: Date): boolean {
        const now = date ?? new Date();
        const time = new Time(now);
        for (const entry of this._times) {
            if (!entry?.trim()) {
                continue;
            }
            const period = parseTimeRange(entry);
            const isWithinPeriod = time.isBetween(period.start, period.end);
            if (isWithinPeriod) {
                return true;
            }
        }
        return false;
    }

    private isToday(date?: Date): boolean {
        date = date ?? new Date();
        const dayOfWeekInTimezone = dayOfWeek(date);
        return this._daysOfWeek.includes(dayOfWeekInTimezone);
    }
}
