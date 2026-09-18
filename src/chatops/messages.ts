import { addLocalDays, localWeekdayName, pluraliseWithS, toLocalDateAndTime } from "../lib/utility.js";
import { ISelectionCandidate, SelectionKind } from "./selection.js";
import { SlackMaxMessageLength } from "../models/channels/slack-api.js";

/*
 When barky has to ask which alerts are meant, the period already asked for must not silently
 disappear, so the list says which expiry the answer will get.
 */
export interface IMuteExpiry {
    description: string;
    wasRequested: boolean;
}

export interface ISelectionListRequest {
    kind: SelectionKind;
    candidates: ISelectionCandidate[];
    dashboardHint: string;
    expiry?: IMuteExpiry;
}

/*
 One check's configuration, as it will be posted. The yaml is the verbatim block from the file, and
 everything else is what barky has to say about it.
 */
export interface IDefinitionMessage {
    alertId: string;
    // the config key declaring it, which differs from the alert's own name where vary-by is used
    key: string;
    displayPath: string;
    yaml: string;
    firstLine: number;
    variation?: string;
    monitorFor?: string;
    redacted: number;
    // a github link to the block, where one could be built - only used when the block is truncated
    permalink?: string;
}

export interface IMuteOutcome {
    muted: ISelectionCandidate[];
    until: Date;
    firedSince: ISelectionCandidate[];
    resolvedSince: ISelectionCandidate[];
    ignoredUntil?: string;
}

// slack has no language hints on a code block - a fence with one renders the language as the first
// line of the block
const CodeFence = "```";

/*
 One definition per reply. A block of yaml is most of a slack message on its own, and two of them
 in a thread bury the conversation they were asked in.
 */
export const MaxDefinitions = 1;

const HelpLines = [
    "*Here's what I understand:*",
    "    • `mute` — I'll list the active alerts and you reply with numbers",
    "    • `mute all` — mute everything currently alerting",
    "    • `unmute` — I'll list the active mutes and you reply with numbers",
    "    • `define` (or `config`) — I'll list the active alerts and you reply with one number to see how that check is configured",
    "    • `status` — what's currently broken",
    "",
    "Mention me inside an alert's own thread and I'll act on just that alert — including when",
    "answering a list, so I never act on people talking to each other.",
    "When answering a list: `1`, `1,3`, `2 and 4`, `1-3`, or `all` — a `define` list takes one number.",
    "Mutes run until the next business day unless you say otherwise — `for 4h`, `for 90 mins`,",
    "`until tomorrow`, `until Monday`.",
    ""
];

const InterpretationHelpLines = [
    "You can also just say what you want in your own words — \"mute the database one for an hour\".",
    ""
];

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
    // room for the closing fence below, which is added after the cut is made
    const reserved = suffix.length + CodeFence.length + 1;
    const cut = text.substring(0, SlackMaxMessageLength - reserved);
    const lastLineBreak = cut.lastIndexOf("\n");
    const kept = lastLineBreak > 0 ? cut.substring(0, lastLineBreak) : cut;
    return closeAnyOpenFence(kept) + suffix;
}

/*
 Cutting a message short inside a code block leaves its fence unclosed, and slack then renders
 everything after it - the footer, and every later message in the thread - as code.
 */
function closeAnyOpenFence(text: string): string {
    const fences = (text.match(/```/g) ?? []).length;
    return fences % 2 === 0
        ? text
        : `${ text }\n${ CodeFence }`;
}

/*
 Renders the numbered list, or the fallback where it would not fit. The cut off is the size of the
 message slack will actually accept rather than a fixed number of rows, so a handful of alerts with
 very long identifiers is caught while many short ones are not.
 */
export function renderSelectionListOrTooLong(request: ISelectionListRequest): { text: string, fits: boolean } {
    const text = renderSelectionList(request);
    if (text.length <= SlackMaxMessageLength) {
        return { text, fits: true };
    }
    return {
        text: renderListTooLong(request.candidates.length, request.kind, request.dashboardHint),
        fits: false
    };
}

export function renderListTooLong(
    count: number,
    kind: SelectionKind,
    dashboardHint: string): string {
    const noun = kind === "unmute"
        ? `${ pluraliseWithS("mute", count) } in force`
        : pluraliseWithS("active alert", count);
    // "define all" is capped, so offering it here would be offering something barky would refuse
    const advice = kind === "define"
        ? `Please use ${ dashboardHint } to find out more about alerts.`
        : `Please use ${ dashboardHint } to pick them out, or reply \`${ kind } all\` if you really do want every one of them.`;
    return [
        `There are *${ count }* ${ noun }, which is more than will fit in a single Slack message.`,
        advice
    ].join("\n");
}

export function renderMuteOutcome(outcome: IMuteOutcome): string {
    const parts = [
        `🔕 Muting until *${ describeInstant(outcome.until) }*:`,
        ...outcome.muted.map(x => `    • ${ x.title }`),
        "",
        "_Takes effect on the next evaluation._"
    ];
    if (outcome.ignoredUntil) {
        parts.push("", renderIgnoredExpiry(outcome.ignoredUntil));
    }
    if (outcome.resolvedSince.length > 0) {
        parts.push("", renderResolvedSince(outcome.resolvedSince.length));
    }
    if (outcome.firedSince.length > 0) {
        parts.push("", ...renderFiredSince(outcome.firedSince));
    }
    return parts.join("\n");
}

export function renderUnmuteOutcome(unmuted: ISelectionCandidate[]): string {
    return [
        `🔔 Lifting ${ unmuted.length } ${ pluraliseWithS("mute", unmuted.length) }:`,
        ...unmuted.map(x => `    • ${ x.title }`),
        "",
        "_Takes effect on the next evaluation._"
    ].join("\n");
}

/*
 Whether the whole block fits in one slack message. Asked before rendering, so barky only reaches
 for git to build a link when the answer is going to need one.
 */
export function definitionFitsSlack(definition: IDefinitionMessage): boolean {
    const lines = definition.yaml.split("\n");
    return composeDefinition(definition, lines, 0).length <= SlackMaxMessageLength;
}

/*
 One check's configuration, trimmed to what slack will accept. A block too long to post is cut at a
 line boundary and says so, pointing at the rest of it on github where a link could be built.
 */
export function renderDefinition(definition: IDefinitionMessage): string {
    const lines = definition.yaml.split("\n");
    const whole = composeDefinition(definition, lines, 0);
    if (whole.length <= SlackMaxMessageLength) {
        return whole;
    }
    return composeDefinition(definition, takeLinesFitting(definition, lines), lines.length);
}

export function renderNothingToDo(kind: SelectionKind): string {
    if (kind === "define") {
        return renderNothingToDefine();
    }
    return kind === "mute"
        ? "✅ Nothing to mute — there are no active alerts right now."
        : "There are no active mutes to lift.";
}

export function renderNothingToDefine(): string {
    return "✅ Nothing is alerting right now, and I draw the list from what's currently broken.";
}

export function renderDefinitionNotFound(alertId: string, dashboardHint: string): string {
    return [
        `I can't find \`${ alertId }\` in the rules I'm running — it may have been renamed or removed since it last fired.`,
        `Use ${ dashboardHint } to see what it last reported.`
    ].join("\n");
}

export function renderDefinitionUnreadable(alertId: string): string {
    // deliberately not "I found it but" - when reading the rules threw, barky does not know
    // whether the check is there at all
    return `⚠️ I couldn't read the configuration for \`${ alertId }\` — the rules file may have changed while I was looking. Nothing else was affected.`;
}

export function renderDefineUnavailable(dashboardHint: string): string {
    return `I can't read the rules file from here, so I can't show you how that's configured. Use ${ dashboardHint }.`;
}

export function renderTooManyToDefine(count: number, dashboardHint: string): string {
    return [
        `That's *${ count }* alerts, and I show one definition at a time so the thread stays readable.`,
        `Reply with a single number, or use ${ dashboardHint }.`
    ].join("\n");
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

export function renderThreadCleared(): string {
    return "✅ Everything this alert was reporting has already cleared or been muted — nothing to do.";
}

export function renderNotUnderstood(dashboardHint: string): string {
    return [
        "I didn't understand that. Try `mute`, `unmute`, `define`, `status` or `help`.",
        `For anything more involved, use ${ dashboardHint }.`
    ].join("\n");
}

/*
 A list is on screen and the answer to it did not read as one. Telling someone to try `mute` when
 they are already halfway through muting reads as barky having lost the thread, so the numbered list
 they are looking at is what they are pointed back at.
 */
export function renderNotUnderstoodWithList(kind: SelectionKind): string {
    // a define list takes one number, so pointing at "1,3" or "all" here would be pointing at the
    // two answers it goes on to refuse
    const answers = kind === "define"
        ? "reply with one number from the list (`2`), or `cancel`"
        : "reply with the numbers from the list (`1,3`), `all`, or `cancel`";
    return [
        `I didn't catch which of those you meant — ${ answers }.`,
        `Say \`${ kind }\` again if you want a fresh list.`
    ].join("\n");
}

/*
 A bare "all" or "1,3" with nothing pinned is an answer to a list barky hasn't got: someone else's,
 or one lost to a restart, since the lists live in memory. Being told "I didn't understand that"
 when what you typed is exactly what was asked for is a baffling place to be left.
 */
export function renderNoListWaiting(): string {
    return [
        "That looks like an answer to a numbered list, but I haven't got one waiting for you — lists are per person, and they don't survive a restart.",
        "Say `mute`, `unmute` or `define` and I'll give you one."
    ].join("\n");
}

/*
 A mention in the thread of the follow-up ping barky posts while an alert is ongoing. That message
 is deleted and reposted every time barky checks, so it points at the alert's own thread rather
 than acting here - and says why, since being redirected for no visible reason is worse than being
 ignored for one.
 */
export function renderReplyInAlertThread(url: string): string {
    const where = url
        ? `<${ url }|the alert's own thread>`
        : "the alert's own thread above";
    return [
        "👆 I repost this message every time I check, so anything either of us says here goes with it.",
        `Mention me in ${ where } instead and I'll pick it up — \`mute\`, \`define\` and the rest all work there.`
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

export function renderHelp(dashboardHint: string): string {
    return renderHelpFor([], dashboardHint);
}

export function renderHelpWithInterpretation(dashboardHint: string): string {
    return renderHelpFor(InterpretationHelpLines, dashboardHint);
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
    if (target.date === addLocalDays(today.date, 1)) {
        return `${ target.time } tomorrow`;
    }
    const weekday = localWeekdayName(target.date);
    const isWithinTheWeek = target.date <= addLocalDays(today.date, 6);
    return isWithinTheWeek
        ? `${ target.time } on ${ weekday }`
        : `${ target.time } on ${ weekday } ${ target.date }`;
}

function composeDefinition(
    definition: IDefinitionMessage,
    lines: string[],
    truncatedFrom: number): string {
    return [
        ...renderDefinitionHead(definition),
        CodeFence,
        ...lines,
        CodeFence,
        ...renderDefinitionNotes(definition, lines.length, truncatedFrom)
    ].join("\n");
}

/*
 As many lines of the block as will fit. The overhead around it is measured with the block already
 declared truncated, so it is never less than what is finally sent - bar the note's own count,
 which reads "0 of N" while measuring and "37 of N" when sent. Those few characters are given back
 by measuring the composed message for real, rather than by reasoning about how wide a number is.
 */
function takeLinesFitting(definition: IDefinitionMessage, lines: string[]): string[] {
    let room = SlackMaxMessageLength - composeDefinition(definition, [], lines.length).length;
    const kept = [];
    for (const line of lines) {
        room -= line.length + 1;
        if (room < 0) {
            break;
        }
        kept.push(line);
    }
    while (kept.length > 0 && composeDefinition(definition, kept, lines.length).length > SlackMaxMessageLength) {
        kept.pop();
    }
    return kept;
}

function renderDefinitionHead(definition: IDefinitionMessage): string[] {
    const head = [`📄 \`${ definition.alertId }\` — defined in \`${ definition.displayPath }\``];
    if (definition.monitorFor) {
        // the monitor row reports the check failing to run at all, so what declares it is the check
        head.push(`That id is the monitor for the \`${ definition.monitorFor }\` check, so this is what the check itself declares:`);
    }
    return head;
}

function renderDefinitionNotes(
    definition: IDefinitionMessage,
    kept: number,
    truncatedFrom: number): string[] {
    const notes = [];
    if (definition.variation) {
        notes.push(`_This alert is the \`${ definition.variation }\` variation of \`${ definition.key }\`._`);
    }
    if (definition.redacted > 0) {
        notes.push(`🔒 _${ definition.redacted } ${ pluraliseWithS("value", definition.redacted) } redacted before posting._`);
    }
    if (truncatedFrom > kept) {
        notes.push(renderDefinitionTruncated(definition, kept, truncatedFrom));
    }
    return notes.length > 0
        ? ["", ...notes]
        : [];
}

function renderDefinitionTruncated(
    definition: IDefinitionMessage,
    kept: number,
    total: number): string {
    const rest = definition.permalink
        ? `<${ definition.permalink }|see all ${ total } lines on github>`
        : `the rest is in \`${ definition.displayPath }\` from line ${ definition.firstLine }`;
    return `_…${ kept } of ${ total } lines — ${ rest }._`;
}

function renderSelectionList(request: ISelectionListRequest): string {
    const parts = [renderSelectionPrompt(request)];
    if (request.expiry) {
        parts.push(renderExpiryGuidance(request.expiry));
    }
    parts.push("");
    parts.push(...request.candidates.map(renderCandidate));
    return parts.join("\n");
}

/*
 A definition is asked for one at a time - "all" would be a wall of yaml, and the cap means it could
 not be honoured as asked anyway - so that list asks for a number rather than offering "all".
 */
function renderSelectionPrompt(request: ISelectionListRequest): string {
    const count = request.candidates.length;
    const noun = pluraliseWithS(nounFor(request.kind), count);
    return request.kind === "define"
        ? `*${ count } ${ noun }* — mention me with the number you want the configuration for (\`2\`), or \`cancel\`.`
        : `*${ count } ${ noun }* — mention me with your answer: numbers (\`1,3\`), \`all\`, or \`cancel\`.`;
}

function nounFor(kind: SelectionKind): string {
    return kind === "unmute" ? "active mute" : "active alert";
}

function renderExpiryGuidance(expiry: IMuteExpiry): string {
    return expiry.wasRequested
        ? `I'll mute until *${ expiry.description }* as you asked — say a different period to change that, for example \`1,3 for 4h\`.`
        : `Add a period to override the default of *${ expiry.description }* — for example \`1,3 for 4h\`.`;
}

function renderCandidate(candidate: ISelectionCandidate, index: number): string {
    const detail = candidate.detail ? ` — _${ candidate.detail }_` : "";
    return `\`${ index + 1 }.\` ${ candidate.title }${ detail }`;
}

function renderIgnoredExpiry(ignoredUntil: string): string {
    return `⚠️ I couldn't make sense of *${ ignoredUntil }* as an expiry, so I used the default instead. Say \`unmute\` and try again with something like \`for 4h\` if that is not what you wanted.`;
}

// muting a flapping alert is the common case, so these are muted rather than skipped
function renderResolvedSince(count: number): string {
    return count === 1
        ? "_1 of those had already resolved, and was muted anyway so it stays quiet if it comes back._"
        : `_${ count } of those had already resolved, and were muted anyway so they stay quiet if they come back._`;
}

function renderFiredSince(firedSince: ISelectionCandidate[]): string[] {
    const verb = firedSince.length === 1 ? "was" : "were";
    return [
        `⚠️ ${ firedSince.length } ${ pluraliseWithS("alert", firedSince.length) } fired after that list was drawn and ${ verb } *not* muted:`,
        ...firedSince.map(x => `    • ${ x.title }`)
    ];
}

function renderHelpFor(extraLines: string[], dashboardHint: string): string {
    return [
        ...HelpLines,
        ...extraLines,
        `For anything more involved, use ${ dashboardHint }.`
    ].join("\n");
}
