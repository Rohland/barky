import { parseDaysOfWeek, parseTimeRange } from "../lib/period-parser";
import { Time } from "../lib/time";
import { dayOfWeek, isToday } from "../lib/utility";

export interface IMuteWindowDb {
    id?: number;
    match: string;
    from: Date;
    to: Date;
}

export class MuteWindow {

    public startTime: Time;
    public endTime: Time;
    public identifierMatcher?: RegExp;
    public dateString?: string;
    public date: Date;
    public daysOfWeek: number[];
    public days: string[];
    public dynamic: boolean;

    constructor(data: any) {
        if (data.time) {
            const timeRange = data.time;
            const range = parseTimeRange(timeRange);
            if (!range) {
                throw new Error(`invalid mute-window time range '${ timeRange }'`);
            }
            this.startTime = range.start
            this.endTime = range.end;
        } else if (data.startTime && data.endTime) {
            this.startTime = new Time(data.startTime);
            this.endTime = new Time(data.endTime);
        }
        if (!this.startTime || !this.endTime) {
            throw new Error("expected mute window to have a time range, or a startTime and endTime");
        }
        if (data.match) {
            this.identifierMatcher = MuteWindow.getRegex(data.match);
        }
        if (data.date) {
            this.date = new Date(data.date);
            this.dateString = data.date;
        }
        this.days = data.days ?? [];
        this.daysOfWeek = parseDaysOfWeek(this.days);
        this.dynamic = data.dynamic ?? false;
    }

    isMuted(
        identifer: string,
        date?: Date): boolean {
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
        return MuteWindow.isMatchForIdentifier(identifier, this.identifierMatcher);
    }

    public static getRegex(match: RegExp | string): RegExp {
        if (typeof match === "string") {
            // escape a trailing backslash, JavaScript string literal quirk!
            if (/[^\\]+\\$/.test(match)) {
                match = match + "\\";
            }
            return new RegExp(match, "i");
        } else {
            return match;
        }
    }

    public static isMatchForIdentifier(
        identifier: string,
        match: RegExp | string): boolean {
        if (!match) {
            return true;
        }
        const isMatch = MuteWindow.getRegex(match).test(identifier);
        return isMatch;
    }
}
