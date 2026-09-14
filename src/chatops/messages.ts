import { pluraliseWithS, toLocalDateAndTime } from "../lib/utility.js";
import { ISelectionCandidate, SelectionKind } from "./selection.js";
import { SlackMaxMessageLength } from "../models/channels/slack-api.js";

const WeekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function addDays(date: string, days: number): string {
    const cursor = new Date(`${ date }T12:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + days);
    return cursor.toISOString().substring(0, 10);
}

/*
 Describes an instant the way someone reading it in Slack would say it - "18:30 today",
 "08:00 tomorrow", "08:00 on Monday". Always in the configured timezone.
 */
export function describeInstant(date: Date, now?: Date): string {
    const today = toLocalDateAndTime(now ?? new Date());
    const target = toLocalDateAndTime(date);
    if (target.date === today.date) {
        return `${ target.time } today`;
    }
    if (target.date === addDays(today.date, 1)) {
        return `${ target.time } tomorrow`;
    }
    const weekday = WeekdayNames[new Date(`${ target.date }T12:00:00Z`).getUTCDay()];
    const isWithinTheWeek = target.date <= addDays(today.date, 6);
    return isWithinTheWeek
        ? `${ target.time } on ${ weekday }`
        : `${ target.time } on ${ weekday } ${ target.date }`;
}

function renderCandidate(candidate: ISelectionCandidate, index: number): string {
    const detail = candidate.detail ? ` — _${ candidate.detail }_` : "";
    return `\`${ index + 1 }.\` ${ candidate.title }${ detail }`;
}

export function renderSelectionList(
    kind: SelectionKind,
    candidates: ISelectionCandidate[],
    defaultUntil: string): string {
    const noun = kind === "mute" ? "active alert" : "active mute";
    const parts = [
        `*${ candidates.length } ${ pluraliseWithS(noun, candidates.length) }* — reply with numbers (\`1,3\`), \`all\`, or \`cancel\`.`
    ];
    if (kind === "mute") {
        parts.push(`Add a period to override the default of *${ defaultUntil }* — for example \`1,3 for 4h\`.`);
    }
    parts.push("");
    parts.push(...candidates.map(renderCandidate));
    return parts.join("\n");
}

export function renderListTooLong(
    count: number,
    kind: SelectionKind,
    dashboardHint: string): string {
    const noun = kind === "mute"
        ? pluraliseWithS("active alert", count)
        : `${ pluraliseWithS("mute", count) } in force`;
    return [
        `There are *${ count }* ${ noun }, which is more than will fit in a single Slack message.`,
        `Please use ${ dashboardHint } to pick them out, or reply \`${ kind } all\` if you really do want every one of them.`
    ].join("\n");
}

/*
 Renders the numbered list, or the fallback where it would not fit. The cut off is the size of the
 message slack will actually accept rather than a fixed number of rows, so a handful of alerts with
 very long identifiers is caught while many short ones are not.
 */
/*
 A last line of defence for every outgoing message. Lists are sized before they are built, but a
 status reply or the outcome of muting a large set can also run long, and slack rejecting the post
 after the mutes have been applied would leave the user with no confirmation at all.
 */
export function clampToSlackLimit(text: string, dashboardHint: string): string {
    if ((text ?? "").length <= SlackMaxMessageLength) {
        return text;
    }
    const suffix = `\n\n_…truncated — see ${ dashboardHint } for the rest._`;
    const cut = text.substring(0, SlackMaxMessageLength - suffix.length);
    const lastLineBreak = cut.lastIndexOf("\n");
    return (lastLineBreak > 0 ? cut.substring(0, lastLineBreak) : cut) + suffix;
}

export function renderSelectionListOrTooLong(
    kind: SelectionKind,
    candidates: ISelectionCandidate[],
    defaultUntil: string,
    dashboardHint: string): { text: string, fits: boolean } {
    const text = renderSelectionList(kind, candidates, defaultUntil);
    if (text.length <= SlackMaxMessageLength) {
        return { text, fits: true };
    }
    return {
        text: renderListTooLong(candidates.length, kind, dashboardHint),
        fits: false
    };
}

export function renderThreadCleared(): string {
    return "✅ Everything this alert was reporting has already cleared or been muted — nothing to do.";
}

export function renderNothingToDo(kind: SelectionKind): string {
    return kind === "mute"
        ? "✅ Nothing to mute — there are no active alerts right now."
        : "There are no active mutes to lift.";
}

export function renderMuteOutcome(
    muted: ISelectionCandidate[],
    until: Date,
    firedSinceList: ISelectionCandidate[],
    resolvedSinceList: ISelectionCandidate[],
    ignoredUntil?: string): string {
    const parts = [
        `🔕 Muted until *${ describeInstant(until) }*:`,
        ...muted.map(x => `    • ${ x.title }`)
    ];
    if (ignoredUntil) {
        parts.push("");
        parts.push(`⚠️ I couldn't make sense of *${ ignoredUntil }* as an expiry, so I used the default instead. Say \`unmute\` and try again with something like \`for 4h\` if that is not what you wanted.`);
    }
    if (resolvedSinceList.length > 0) {
        // muting a flapping alert is the common case, so these are muted rather than skipped
        parts.push("");
        parts.push(`_${ resolvedSinceList.length } of those had already resolved, and ${ resolvedSinceList.length === 1 ? "was" : "were" } muted anyway so ${ resolvedSinceList.length === 1 ? "it stays" : "they stay" } quiet if ${ resolvedSinceList.length === 1 ? "it comes" : "they come" } back._`);
    }
    if (firedSinceList.length > 0) {
        parts.push("");
        parts.push(`⚠️ ${ firedSinceList.length } ${ pluraliseWithS("alert", firedSinceList.length) } fired after that list was drawn and ${ firedSinceList.length === 1 ? "was" : "were" } *not* muted:`);
        parts.push(...firedSinceList.map(x => `    • ${ x.title }`));
    }
    return parts.join("\n");
}

export function renderUnmuteOutcome(unmuted: ISelectionCandidate[]): string {
    return [
        `🔔 Lifted ${ unmuted.length } ${ pluraliseWithS("mute", unmuted.length) }:`,
        ...unmuted.map(x => `    • ${ x.title }`)
    ].join("\n");
}

/*
 Mute patterns are stored as anchored, escaped regular expressions - shown back to a human they
 should read like the alert id they target.
 */
export function describeMutePattern(match: string): string {
    return (match ?? "")
        .replace(/^\^/, "")
        .replace(/\$$/, "")
        .replace(/\\(.)/g, "$1");
}

export function renderStatus(
    active: ISelectionCandidate[],
    muted: ISelectionCandidate[]): string {
    if (active.length === 0 && muted.length === 0) {
        return "✅ All clear — nothing is alerting and nothing is muted.";
    }
    const parts = [];
    if (active.length === 0) {
        parts.push("✅ Nothing is alerting right now.");
    } else {
        parts.push(`🚨 *${ active.length } active ${ pluraliseWithS("alert", active.length) }:*`);
        parts.push(...active.map(x => `    • ${ x.title }${ x.detail ? ` — _${ x.detail }_` : "" }`));
    }
    if (muted.length > 0) {
        parts.push("");
        parts.push(`🔕 *${ muted.length } ${ pluraliseWithS("mute", muted.length) } in force:*`);
        parts.push(...muted.map(x => `    • ${ x.title }${ x.detail ? ` ${ x.detail }` : "" }`));
    }
    return parts.join("\n");
}

export function renderNotUnderstood(dashboardHint: string): string {
    return [
        "I didn't understand that. Try `mute`, `unmute`, `status` or `help`.",
        `For anything more involved, use ${ dashboardHint }.`
    ].join("\n");
}

export function renderFailed(dashboardHint: string): string {
    return `⚠️ Something went wrong handling that — nothing was changed. Please use ${ dashboardHint }.`;
}

export function renderExpired(kind: SelectionKind): string {
    return `That list has expired, so I won't act on those numbers. Say \`${ kind }\` again for a fresh one.`;
}

export function renderOutOfRange(indices: number[], max: number): string {
    return `There ${ indices.length === 1 ? "is" : "are" } no ${ pluraliseWithS("item", indices.length) } numbered ${ indices.join(", ") } on that list — it only goes up to ${ max }.`;
}

export function renderCancelled(): string {
    return "👍 Cancelled, nothing was changed.";
}

export function renderUnavailable(dashboardHint: string): string {
    return [
        "⚠️ I can't reach the AI service right now, so I can't interpret that.",
        `Please use ${ dashboardHint }, or reply with plain numbers (\`1,3\`) or \`all\` if I've given you a list.`
    ].join("\n");
}

export function renderHelp(dashboardHint: string, canInterpret: boolean = false): string {
    const parts = [
        "*Here's what I understand:*",
        "    • `mute` — I'll list the active alerts and you reply with numbers",
        "    • `mute all` — mute everything currently alerting",
        "    • `unmute` — I'll list the active mutes and you reply with numbers",
        "    • `status` — what's currently broken",
        "",
        "Reply `mute` or `mute this` inside an alert's own thread and I'll act on just that alert.",
        "When replying to a list: `1`, `1,3`, `2 and 4`, `1-3`, or `all`.",
        "Mutes run until the next business day unless you say otherwise — `1,3 for 4h`.",
        ""
    ];
    if (canInterpret) {
        parts.push("You can also just say what you want in your own words — \"mute the database one for an hour\".");
        parts.push("");
    }
    parts.push(`For anything more involved, use ${ dashboardHint }.`);
    return parts.join("\n");
}
