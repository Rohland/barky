import { toLocalTimeString } from "./utility";

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
        const millisInDay = 24 * 60 * 60 * 1000;
        const millisSinceStart = this.millisSinceStartOfDay % millisInDay
        return (millisSinceStart >= start.millisSinceStartOfDay && millisSinceStart <= end.millisSinceStartOfDay)
            || (millisSinceStart + millisInDay >= start.millisSinceStartOfDay && millisSinceStart + millisInDay <= end.millisSinceStartOfDay);
    }

    get millisSinceStartOfDay() : number {
        return this.millis + this.seconds * 1000 + this.minutes * 60 * 1000 + this.hours * 60 * 60 * 1000;
    }
}

export function toLocalTime(date: Date): Time {
    return new Time(date);
}
