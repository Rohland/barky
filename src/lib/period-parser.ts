import { Time } from "./utility";

const InvalidPeriodRangeError = "invalid period - expected format: -fromInteger{s|m|h|d} to -toInteger{s|m|h|d}";
const InvalidPeriodError = "invalid period - expected format: -Integer{s|m|h|d}";
const ValidPeriodRangeRegex = /^-(\d+)(s|m|h|d)\s+to\s+-(\d+)(s|m|h|d)$/i;
const ValidPeriodRegex = /^-(\d+)(s|m|h|d)$/i;

export interface IPeriod {
    from: Date,
    to: Date
}

export function parsePeriod(input): Date {
    if (!input || !ValidPeriodRegex.test(input.trim())) {
        throw new Error(InvalidPeriodError);
    }
    const match = ValidPeriodRegex.exec(input.trim());
    const value = parseFloat(match[1]);
    const unit = match[2];
    return applyDurationToDate(new Date(), value, unit);
}

export function parsePeriodToMinutes(input): number {
    const negative = input.startsWith("-");
    if (!negative) {
        input = `-${ input }`;
    }
    const millis = +parsePeriod(input) - +new Date();
    const minutes = millis / 1000 / 60;
    return negative
        ? minutes
        : -minutes;
}

export function parsePeriodRange(input): IPeriod {
    if (!input || !ValidPeriodRangeRegex.test(input.trim())) {
        throw new Error(InvalidPeriodRangeError);
    }
    const match = ValidPeriodRangeRegex.exec(input.trim());
    const fromValue = parseFloat(match[1]);
    const fromUnit = match[2];
    const toValue = parseFloat(match[3]);
    const toUnit = match[4];
    const date = new Date();
    return {
        from: applyDurationToDate(date, fromValue, fromUnit),
        to: applyDurationToDate(date, toValue, toUnit)
    }
}

const MondayRegex = /^mon(day)?$/i;
const TuesdayRegex = /^tue(s|sday)?$/i;
const WednesdayRegex = /^wed(nesday)?$/i;
const ThursdayRegex = /^thu(rs?|rsday)?$/i;
const FridayRegex = /^fri(day)?$/i;
const SaturdayRegex = /^sat(urday)?$/i;
const SundayRegex = /^sun(day)?$/i;
const DaysOfWeek = [
    SundayRegex,
    MondayRegex,
    TuesdayRegex,
    WednesdayRegex,
    ThursdayRegex,
    FridayRegex,
    SaturdayRegex
];

export function parseDaysOfWeek(days: string[]): number[] {
    if (!days || days.length === 0) {
        return [];
    }
    const result = days.map(x => {
        return DaysOfWeek.findIndex(regex => regex.test(x?.trim()))
    });
    return result.filter(x => x >= 0).sort();
}

const ValidTimeRangeRegex = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/i;

export function parseTimeRange(range: string): { start: Time, end: Time } {
    if (!range?.trim()) {
        return null;
    }
    const match = ValidTimeRangeRegex.exec(range.trim());
    if (!match) {
        return null;
    }
    return {
        start: new Time(match[1]),
        end: new Time(match[2])
    }
}

function applyDurationToDate(
    date,
    value,
    unit) {
    const dt = new Date(date);
    switch (unit) {
        case "s":
            dt.setSeconds(dt.getSeconds() - value);
            break;
        case "m":
            dt.setMinutes(dt.getMinutes() - value);
            break;
        case "h":
            dt.setHours(dt.getHours() - value);
            break;
        case "d":
            dt.setDate(dt.getDate() - value);
            break;
    }
    return dt;
}
