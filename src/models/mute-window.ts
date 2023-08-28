import { parseDaysOfWeek, parseTimeRange } from "../lib/period-parser";
import { Time } from "../lib/time";
import { dayOfWeek, isToday } from "../lib/utility";

export class MuteWindow {

    public startTime: Time;
    public endTime: Time;
    public identifierMatcher?: RegExp;
    public dateString?: string;
    public daysOfWeek: number[];

    constructor(data: any) {
        const timeRange = data.time;
        if (!timeRange) {
            throw new Error("expected mute window to have a time");
        }
        const range = parseTimeRange(timeRange);
        if (!range) {
            throw new Error(`invalid mute-window time range '${ timeRange }'`);
        }
        this.startTime = range.start
        this.endTime = range.end;
        if (data.match) {
            this.identifierMatcher = new RegExp(data.match, "i");
        }
        if (data.date) {
            this.dateString = data.date;
        }
        this.daysOfWeek = parseDaysOfWeek(data.days ?? []);
    }

    isMuted(identifer: string, date?: Date): boolean {
        return this.isMatchForIdentifier(identifer) && this.isMutedAt(date);
    }

    isMutedAt(date?: Date): boolean {
        if (this.dateString) {
            if (!isToday(this.dateString, date)) {
                return false;
            }
        }
        if (this.daysOfWeek.length > 0) {
            const day = dayOfWeek(date);
            if (!this.daysOfWeek.includes(day)) {
                return false;
            }
        }
        const time = new Time(date ?? new Date());
        return time.isBetween(this.startTime, this.endTime);
    }

    isMatchForIdentifier(identifier: string): boolean {
        if (!this.identifierMatcher) {
            return true;
        }
        return this.identifierMatcher.test(identifier);
    }
}
