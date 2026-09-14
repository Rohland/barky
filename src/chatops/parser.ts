import { parsePeriodToMillis } from "../lib/period-parser.js";
import { fromLocalDateAndTime } from "../lib/utility.js";
import { SelectionKind } from "./selection.js";

export enum CommandType {
    Mute = "mute",
    Unmute = "unmute",
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
}

export interface ISelectionReply {
    all: boolean;
    indices: number[];
    durationMs?: number;
}

const DurationUnits = {
    s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
    m: "m", min: "m", mins: "m", minute: "m", minutes: "m",
    h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
    d: "d", day: "d", days: "d"
};

const DurationRegex = new RegExp(
    `(?:^|\\s|\\bfor\\s+)(\\d+)\\s*(${ Object.keys(DurationUnits).join("|") })\\b`,
    "i");

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

function stripMention(input: string): string {
    // messages addressed to the bot arrive as "<@U123> mute", and the mention may be repeated
    return (input ?? "").replace(/<@[^>]+>/g, " ").trim();
}

function withoutDuration(input: string): string {
    return input.replace(DurationRegex, " ").replace(/\bfor\b/gi, " ").trim();
}

/*
 Parses the commands barky understands without help from a language model. Returns null for
 anything else, which is escalated for interpretation.
 */
export function parseCommand(input: string): ICommand {
    const text = stripMention(input).toLowerCase();
    if (!text) {
        return null;
    }
    const durationMs = parseDuration(text);
    const remainder = withoutDuration(text).replace(/(?<=.)[.!?]+$/, "").trim();
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
            return { type: CommandType.Mute, all: false, durationMs };
        case "mute this":
        case "mute these":
        case "mute this one":
        case "mute it":
            return { type: CommandType.Mute, all: false, scopedToThread: true, durationMs };
        case "mute all":
        case "mute everything":
            return { type: CommandType.Mute, all: true, durationMs };
        case "unmute":
            return { type: CommandType.Unmute, all: false };
        case "unmute all":
        case "unmute everything":
            return { type: CommandType.Unmute, all: true };
        default:
            return null;
    }
}

/*
 Parses a reply to a numbered list: "1", "1,3", "2 and 4", "1-3", "all", optionally carrying a
 duration. Returns null when the reply needs interpreting instead.

 When the reply names a verb, it must be the one the pinned list is for - "mute 1" answering an
 unmute list is a request to silence something, not to un-silence it, so it is not a selection.
 */
export function parseSelectionReply(input: string, kind?: SelectionKind): ISelectionReply {
    const text = stripMention(input).toLowerCase();
    if (!text) {
        return null;
    }
    const durationMs = parseDuration(text);
    let remainder = withoutDuration(text)
        .replace(/(?<=.)[.!?]+$/, "")
        .trim();
    const verb = /^(mute|unmute)\s+/.exec(remainder);
    if (verb) {
        if (kind && verb[1] !== kind) {
            return null;
        }
        remainder = remainder.substring(verb[0].length).trim();
    }
    if (/^(all|all of them|everything|both)$/.test(remainder)) {
        return { all: true, indices: [], durationMs };
    }
    // normalise the separators people actually type before looking for numbers
    remainder = remainder.replace(/\band\b|&|\+/g, ",");
    if (!/^[\d\s,\-–]+$/.test(remainder)) {
        return null;
    }
    const indices = [];
    for (const part of remainder.split(",")) {
        const token = part.trim();
        if (!token) {
            continue;
        }
        const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(token);
        if (range) {
            const from = parseInt(range[1]);
            const to = parseInt(range[2]);
            if (from > to) {
                return null;
            }
            for (let i = from; i <= to; i++) {
                indices.push(i);
            }
            continue;
        }
        if (!/^\d+$/.test(token)) {
            return null;
        }
        indices.push(parseInt(token));
    }
    if (indices.length === 0) {
        return null;
    }
    return {
        all: false,
        indices: Array.from(new Set(indices)).sort((a, b) => a - b),
        durationMs
    };
}
