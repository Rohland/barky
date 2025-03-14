import { dayOfWeek, flatten, pluraliseWithS, toLocalTimeString } from "./utility";
import { parseDaysOfWeek, parseTimeRange } from "./period-parser";

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

export function humanizeDuration(time: number, type: string = "m"): string {
    let minutes = time;
    let defaultTypeText = "mins";
    switch (type?.toLowerCase()?.trim()) {
        case "s":
            minutes = time / 60;
            defaultTypeText = "secs";
            break;
        case "m":
            minutes = time;
            defaultTypeText = "mins";
            break;
        case "h":
            minutes = time * 60;
            defaultTypeText = "hrs";
            break;
    }
    const secondsText = humanizeSeconds((minutes - Math.floor(minutes)) * 60);
    const minsText = humanizeMinutes(minutes % 60);
    const hoursText = humanizeHours(minutes / 60);
    const text = [hoursText, minsText, secondsText].filter(x => !!x).join(", ");
    if (text.length === 0) {
        return `0 ${ defaultTypeText }`;
    }
    return text.replace(/,\s+([^,]+)$/, ` and $1`);
}

function humanizeSeconds(seconds) {
    const value = Math.floor(seconds);
    return value === 0 ?
        "" :
        `${ value } ${ pluraliseWithS("sec", value) }`;
}

function humanizeMinutes(minutes) {
    const value = Math.floor(minutes);
    return value === 0 ?
        "" :
        `${ value } ${ pluraliseWithS("min", value) }`;
}

function humanizeHours(hours) {
    const value = Math.floor(hours);
    return value === 0 ?
        "" :
        `${ value } ${ pluraliseWithS("hr", value) }`;
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
        for(const entry of this._times) {
            if (!entry?.trim()){
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
