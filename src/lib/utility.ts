export const DefaultLocale = process.env.LC_ALL
    || process.env.LC_MESSAGES
    || process.env.LANG
    || process.env.LANGUAGE;
const defaultTimeZone = "Africa/Johannesburg";
let locale = DefaultLocale;
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

export function toLocalTimeString(date: Date) {
    return date.toLocaleTimeString(locale, { hour12: false, timeZone });
}

export class Time {
    time: string;
    hours: number;
    minutes: number;
    seconds: number;
    millis: number;

    constructor(time: Date | string) {
        if (time instanceof Date){
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
            throw new Error(`Invalid time string: '${time }'`);
        }
        this.time = time.match(/^\d:/) ? `0${time}` : time;
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
        return this.millisSinceStartOfDay >= start.millisSinceStartOfDay && this.millisSinceStartOfDay <= end.millisSinceStartOfDay;
    }

    get millisSinceStartOfDay() : number {
        return this.millis + this.seconds * 1000 + this.minutes * 60 * 1000 + this.hours * 60 * 60 * 1000;
    }

}

export function toLocalTime(date: Date): Time {
    return new Time(date);
}

export function dayOfWeek(date: Date): number {
    const day = date.toLocaleString("en-US", {
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

export function initLocaleAndTimezone(config) {
    locale = config?.locale ?? DefaultLocale;
    timeZone = config?.timezone ?? defaultTimeZone;
}
