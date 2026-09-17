import { parseDaysOfWeek, parsePeriodToMillis } from "../lib/period-parser.js";
import { addLocalDays, fromLocalDateAndTime, localWeekday, toLocalDateAndTime } from "../lib/utility.js";
import { BusinessStart } from "../lib/time.js";
import { SelectionKind } from "./selection.js";

export enum CommandType {
    Mute = "mute",
    Unmute = "unmute",
    Define = "define",
    Status = "status",
    Help = "help",
    Cancel = "cancel"
}

export interface ICommand {
    type: CommandType;
    all?: boolean;
    // "mute this" only means everything when said in an alert's thread, where "this" has a referent
    scopedToThread?: boolean;
    durationMs?: number;
    until?: string;
}

export interface ISelectionReply {
    all: boolean;
    indices: number[];
    durationMs?: number;
    until?: string;
}

// no list barky posts comes close to this - anything larger is a typo or an attempt to make the
// expansion below do the damage, and is rejected before a single index is materialised
const MaxSelectableIndex = 1000;

const DurationUnits = {
    s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
    m: "m", min: "m", mins: "m", minute: "m", minutes: "m",
    h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
    d: "d", day: "d", days: "d"
};

const DurationRegex = new RegExp(
    `(?:^|\\s|\\bfor\\s+)(\\d+)\\s*(${ Object.keys(DurationUnits).join("|") })\\b`,
    "i");

// "until tomorrow", "until Monday", "till thurs"
const UntilRegex = /\b(?:until|till|til)\s+(?:the\s+)?(?:next\s+)?([a-z]+)\b/i;

// a weekday recurs within this many days of any starting point
const DaysInWeek = 7;

// trailing punctuation people type but do not mean - "mute all!"
const TrailingPunctuationRegex = /(?<=.)[.!?]+$/;

/*
 People are polite to barky, and "all please" is the same answer as "all". Without this the courtesy
 is what makes the reply unreadable, which is a baffling thing to be told off for - and where no ai
 service is configured there is nothing else to fall back on.
 */
const CourtesyRegex = /\b(?:please|pls|plz|thank you|thanks|thx|ta|cheers|just|only)\b/g;

const IndexRangeRegex = /^(\d+)\s*[-–]\s*(\d+)$/;

/*
 Parses the commands barky understands without help from a language model. Returns null for
 anything else, which is escalated for interpretation.
 */
export function parseCommand(input: string): ICommand {
    const text = stripMention(input).toLowerCase();
    if (!text) {
        return null;
    }
    const { durationMs, until, remainder } = takePeriod(text);
    switch (remainder) {
        case "help":
        case "?":
            return { type: CommandType.Help };
        case "status":
        case "what's broken":
        case "whats broken":
            return { type: CommandType.Status };
        case "cancel":
        case "nevermind":
        case "never mind":
            return { type: CommandType.Cancel };
        case "mute":
            return { type: CommandType.Mute, all: false, durationMs, until };
        case "mute this":
        case "mute these":
        case "mute this one":
        case "mute it":
            return { type: CommandType.Mute, all: false, scopedToThread: true, durationMs, until };
        case "mute all":
        case "mute everything":
            return { type: CommandType.Mute, all: true, durationMs, until };
        case "unmute":
            return { type: CommandType.Unmute, all: false };
        case "unmute all":
        case "unmute everything":
            return { type: CommandType.Unmute, all: true };
        /*
         Only one definition is shown at a time, so "all" cannot be honoured as asked and "this" is
         already unambiguous whenever the thread holds a single alert - which leaves every one of
         these phrasings with the same answer. They are still spelt out so that asking in the words
         people use is understood here rather than costing a trip to the AI service.
         */
        case "define":
        case "definition":
        case "config":
        case "configuration":
        case "explain":
        case "yaml":
        case "define this":
        case "define these":
        case "define this one":
        case "define it":
        case "explain this":
        case "explain it":
        // "config for this" reaches here without its "for", which is taken as part of a period
        case "config this":
        case "configuration this":
        case "define all":
        case "define everything":
        case "config all":
        case "configuration all":
            return { type: CommandType.Define };
        default:
            return null;
    }
}

/*
 Parses a reply to a numbered list: "1", "1,3", "2 and 4", "1-3", "all", optionally carrying a
 duration. Returns null when the reply needs interpreting instead.

 When the reply names a verb, it must be the one the pinned list is for - "mute 1" answering an
 unmute list is a request to silence something, not to un-silence it, so it is not a selection. The
 same holds for "define 1" against a mute list, and for "mute 1" against a list of definitions.
 */
export function parseSelectionReply(input: string, kind?: SelectionKind): ISelectionReply {
    const text = stripMention(input).toLowerCase();
    if (!text) {
        return null;
    }
    const { durationMs, until, remainder } = takePeriod(text);
    const selected = withoutMatchingVerb(remainder, kind);
    if (selected === null) {
        return null;
    }
    if (/^(all|all of them|everything|both)$/.test(selected)) {
        return { all: true, indices: [], durationMs, until };
    }
    const indices = parseIndices(selected);
    return indices
        ? { all: false, indices, durationMs, until }
        : null;
}

function withoutMatchingVerb(remainder: string, kind?: SelectionKind): string {
    const verb = /^(mute|unmute|define)\s+/.exec(remainder);
    if (!verb) {
        return remainder;
    }
    return kind && verb[1] !== kind
        ? null
        : remainder.substring(verb[0].length).trim();
}

/*
 Expands "1", "1,3", "2 and 4" or "1-3" into the indices named. Returns null when any part is not a
 number, so that a half understood answer never acts on the half that was understood.
 */
function parseIndices(input: string): number[] {
    // normalise the separators people actually type before looking for numbers
    const text = input.replace(/\band\b|&|\+/g, ",");
    if (!/^[\d\s,\-–]+$/.test(text)) {
        return null;
    }
    const indices = [];
    for (const part of text.split(",")) {
        const token = part.trim();
        if (!token) {
            continue;
        }
        const expanded = expandIndexToken(token);
        if (!expanded) {
            return null;
        }
        indices.push(...expanded);
    }
    return indices.length === 0
        ? null
        : Array.from(new Set(indices)).sort((a, b) => a - b);
}

function expandIndexToken(token: string): number[] {
    const range = IndexRangeRegex.exec(token);
    if (range) {
        return expandIndexRange(parseInt(range[1]), parseInt(range[2]));
    }
    if (!/^\d+$/.test(token)) {
        return null;
    }
    const index = parseInt(token);
    return index > MaxSelectableIndex ? null : [index];
}

function expandIndexRange(from: number, to: number): number[] {
    if (from > to || to > MaxSelectableIndex) {
        return null;
    }
    const indices = [];
    for (let i = from; i <= to; i++) {
        indices.push(i);
    }
    return indices;
}

function stripMention(input: string): string {
    // messages addressed to the bot arrive as "<@U123> mute", and the mention may be repeated
    return (input ?? "").replace(/<@[^>]+>/g, " ").trim();
}

/*
 Splits the period out of a message - "mute 1,3 for 4h until monday" is a period and a remainder of
 "mute 1,3" - so the callers above only ever match against what is left.
 */
function takePeriod(text: string): { durationMs: number, until: string, remainder: string } {
    return {
        durationMs: parseDuration(text),
        until: parseUntil(text),
        remainder: withoutCourtesy(withoutPeriod(text)).replace(TrailingPunctuationRegex, "").trim()
    };
}

function withoutCourtesy(input: string): string {
    return input
        .replace(CourtesyRegex, " ")
        .replace(/\s+/g, " ")
        // a courtesy word lifted out of "all, please" leaves a separator with nothing on the far
        // side of it, which would otherwise read as a half given answer
        .replace(/\s*,\s*,\s*/g, ", ")
        .replace(/^[\s,;]+|[\s,;]+$/g, "");
}

function withoutPeriod(input: string): string {
    return input
        .replace(UntilRegex, " ")
        .replace(DurationRegex, " ")
        .replace(/\bfor\b/gi, " ")
        .trim();
}

/*
 Extracts a duration such as "for 1h", "90 mins" or "2 days". Returns null when none is present,
 which the caller reads as "use the default" rather than as a failure to understand.
 */
export function parseDuration(input: string): number {
    const match = DurationRegex.exec(input ?? "");
    if (!match) {
        return null;
    }
    const unit = DurationUnits[match[2].toLowerCase()];
    // parsePeriodToMillis reads the clock twice, so trim the sub-second drift between the two
    const millis = parsePeriodToMillis(`${ match[1] }${ unit }`);
    return Math.round(millis / 1000) * 1000;
}

/*
 Resolves "until tomorrow" or "until <weekday>" to a local wall clock moment, using the same start
 of business barky's default expiry uses. Returns null for anything else, which is left for the
 language model to make sense of.
 */
export function parseUntil(input: string, now?: Date): string {
    const match = UntilRegex.exec(input ?? "");
    if (!match) {
        return null;
    }
    const from = now ?? new Date();
    const token = match[1].toLowerCase();
    if (token === "tomorrow") {
        return startOfBusinessOn(addLocalDays(toLocalDateAndTime(from).date, 1));
    }
    const days = parseDaysOfWeek([token]);
    return days.length === 0
        ? null
        : nextStartOfBusinessOnWeekday(days[0], from);
}

/*
 The next occurrence of the named weekday that is still ahead - saying "until Thursday" on a
 Thursday afternoon means the following one.
 */
function nextStartOfBusinessOnWeekday(weekday: number, from: Date): string {
    const today = toLocalDateAndTime(from).date;
    for (let offset = 0; offset <= DaysInWeek; offset++) {
        const date = addLocalDays(today, offset);
        if (localWeekday(date) === weekday && fromLocalDateAndTime(date, BusinessStart) > from) {
            return startOfBusinessOn(date);
        }
    }
    return null;
}

function startOfBusinessOn(date: string): string {
    return `${ date } ${ BusinessStart }`;
}

/*
 Parses a local wall clock moment ("2026-09-21 08:00") into the instant it refers to in the
 configured timezone. Returns null for anything malformed.
 */
export function parseLocalDateTime(input: string): Date {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec((input ?? "").trim());
    if (!match) {
        return null;
    }
    try {
        const result = fromLocalDateAndTime(match[1], match[2]);
        return Number.isNaN(result.getTime()) ? null : result;
    } catch {
        return null;
    }
}
