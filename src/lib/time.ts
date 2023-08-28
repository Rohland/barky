import { toLocalTimeString } from "./utility";

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

export function humanizeDuration(minutes: number) {
    if (minutes < 1) {
        return "a few seconds";
    }
    const onTheHour = minutes % 60 === 0;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const minutesText = mins === 1 ? "min" : "mins";
    if (hrs === 0) {
        return `${ mins } ${ minutesText }`;
    }
    const hoursText = hrs > 1 ? "hrs" : "hr";
    if (onTheHour) {
        return `${ hrs } ${ hoursText }`;
    }
    return `${ hrs } ${ hoursText} and ${ mins } ${ minutesText }`;
}
