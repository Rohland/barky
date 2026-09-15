import { WebState } from "../web/web.state.js";
import { Muter } from "../muter.js";
import { getChatThread, IChatOpsAuditEntry, recordChatOpsAudit } from "../models/db.js";
import { SlackApi } from "../models/channels/slack-api.js";
import { IPinnedSelection, ISelectionCandidate, SelectionStore } from "./selection.js";
import { ChatOpsConfig } from "./config.js";
import { CommandType, ICommand, ISelectionReply, parseCommand, parseDuration, parseLocalDateTime, parseSelectionReply } from "./parser.js";
import { AiUnavailableError, IIntent, IIntentResolver, IntentAction } from "./ai/types.js";
import { AiIntentResolver } from "./ai/resolver.js";
import { nextBusinessHoursStart } from "../lib/time.js";
import { mutePatternFor } from "../lib/key.js";
import { log } from "../models/logger.js";
import * as messages from "./messages.js";

export interface IChatMessage {
    channel: string;
    ts: string;
    threadTs?: string;
    userId: string;
    text: string;
}

export interface IAlertSource {
    getActiveAlerts(): Promise<ISelectionCandidate[]>;
}

export interface IMuteWindowRequest {
    durationMs?: number;
    until?: string;
}

export interface IChatOpsDependencies {
    alerts?: IAlertSource;
    resolver?: IIntentResolver;
    selections?: SelectionStore;
}

interface IInterpretation {
    message: IChatMessage;
    threadTs: string;
    pending: IPinnedSelection;
    candidates: ISelectionCandidate[];
}

interface IMuteRequest {
    chosen: ISelectionCandidate[];
    window: IMuteWindowRequest;
    actor: IChatMessage;
    // the list the user was looking at, so alerts that fired after it was drawn can be reported as
    // deliberately not muted
    pinnedList?: ISelectionCandidate[];
}

// without these the app can post alerts but will never be told about a reply, which otherwise
// looks exactly like barky ignoring people. Either history scope satisfies the second - a private
// channel reports groups:history instead.
const RequiredScopes = ["chat:write", "app_mentions:read"];
const RequiredHistoryScopes = ["channels:history", "groups:history"];
// chat ops works without these, just less well
const DegradedWithoutScopes: Record<string, string> = {
    "reactions:write": "no acknowledgement reaction while barky is thinking",
    "users:read": "the chat ops log names people by slack id rather than display name"
};

function toCandidate(alert: { id: string, last_result: string }): ISelectionCandidate {
    return {
        id: alert.id,
        title: alert.id,
        detail: alert.last_result
    };
}

/*
 The alerts chat ops acts on are exactly those the dashboard shows, so the two can never disagree
 about what is currently broken.
 */
export class WebStateAlertSource implements IAlertSource {
    public async getActiveAlerts(): Promise<ISelectionCandidate[]> {
        const state = await new WebState().fetch();
        return state.active.map(toCandidate);
    }
}

export class ChatOpsService {

    private readonly alerts: IAlertSource;
    private readonly resolver: IIntentResolver;
    private readonly selections: SelectionStore;

    constructor(
        private readonly config: ChatOpsConfig,
        private readonly api: SlackApi,
        dependencies: IChatOpsDependencies = {}) {
        this.alerts = dependencies.alerts ?? new WebStateAlertSource();
        this.resolver = dependencies.resolver
            ?? (config.ai.configured ? new AiIntentResolver(config.ai) : null);
        this.selections = dependencies.selections ?? new SelectionStore(config.selectionTtlMs);
    }

    public async handleMessage(message: IChatMessage): Promise<void> {
        // replies always land in a thread, so a numbered list has a container of its own and two
        // people can run separate selections in the same channel without colliding
        const threadTs = message.threadTs ?? message.ts;
        this.selections.sweep();
        const reply = await this.replyFor(message, threadTs);
        if (!reply) {
            return;
        }
        await this.api.postMessage(
            message.channel,
            messages.clampToSlackLimit(reply, this.config.dashboardHint),
            threadTs);
    }

    public get pendingSelectionCount(): number {
        return this.selections.size;
    }

    /*
     Resolves the ai model up front so the choice is made and logged at startup rather than on the
     first person to ask barky something. Failure is not fatal - it is retried on demand.
     */
    public async warmUp(): Promise<void> {
        await this.verifyScopes();
        if (!this.resolver?.warmUp) {
            return;
        }
        try {
            await this.resolver.warmUp();
        } catch (err) {
            log(`chatops: could not resolve the ai model at startup, will retry on demand: ${ err }`, err);
        }
    }

    /*
     An app set up only to post alerts has no scope to read replies, and slack simply never
     delivers the events - barky looks like it is ignoring people, with nothing to go on. Checked at
     startup so there is at least something in the log saying why.
     */
    public async verifyScopes(): Promise<string[]> {
        const granted = await this.api.getGrantedScopes();
        if (!granted) {
            return [];
        }
        const missing = this.reportScopesBlockingReplies(granted);
        this.reportScopesDegradingChatOps(granted);
        return missing;
    }

    private reportScopesBlockingReplies(granted: string[]): string[] {
        const missing = RequiredScopes.filter(x => !granted.includes(x));
        if (!RequiredHistoryScopes.some(x => granted.includes(x))) {
            missing.push(RequiredHistoryScopes.join(" or "));
        }
        if (missing.length > 0) {
            log(`chatops: the slack app is missing the ${ missing.join(", ") } scope(s), so it can post alerts but will never receive replies - add them under OAuth & Permissions and reinstall the app`);
        }
        return missing;
    }

    private reportScopesDegradingChatOps(granted: string[]): void {
        Object.keys(DegradedWithoutScopes)
            .filter(x => !granted.includes(x))
            .forEach(x => log(`chatops: the slack app has no ${ x } scope - ${ DegradedWithoutScopes[x] }`));
    }

    private async replyFor(message: IChatMessage, threadTs: string): Promise<string> {
        try {
            return await this.resolve(message, threadTs);
        } catch (err) {
            return this.explain(err, message);
        }
    }

    /*
     Barky never guesses. When the AI service cannot be reached the user is told exactly that and
     pointed at the dashboard, which is a different answer to barky having broken.
     */
    private explain(err: any, message: IChatMessage): string {
        if (err instanceof AiUnavailableError) {
            return messages.renderUnavailable(this.config.dashboardHint);
        }
        log(`chatops: failed handling message in ${ message.channel }: ${ err }`, err);
        return messages.renderFailed(this.config.dashboardHint);
    }

    private async resolve(message: IChatMessage, threadTs: string): Promise<string> {
        const found = this.selections.peek(message.channel, threadTs, message.userId);
        if (found) {
            // a reply to a pinned list is read against that list first, so "all" means the items
            // the user was shown rather than everything currently alerting
            const selection = parseSelectionReply(message.text, found.selection.kind);
            if (selection) {
                if (found.expired) {
                    this.selections.clear(message.channel, threadTs, message.userId);
                    return messages.renderExpired(found.selection.kind);
                }
                return await this.applySelection(found.selection, selection, message);
            }
        }
        const pending = found?.expired ? null : found?.selection;
        const command = parseCommand(message.text);
        if (!command) {
            return await this.interpret(message, threadTs, pending);
        }
        switch (command.type) {
            case CommandType.Mute:
                return await this.requestMute(command, message, threadTs);
            case CommandType.Unmute:
                return await this.requestUnmute(command, message, threadTs);
            case CommandType.Status:
                return await this.status();
            case CommandType.Cancel:
                this.selections.clear(message.channel, threadTs, message.userId);
                return messages.renderCancelled();
            case CommandType.Help:
            default:
                return this.help();
        }
    }

    /*
     Anything the local parser cannot read is handed to the AI service, which only ever chooses
     numbers from the list barky supplies.
     */
    private async interpret(
        message: IChatMessage,
        threadTs: string,
        pending: IPinnedSelection): Promise<string> {
        if (!this.resolver) {
            return messages.renderNotUnderstood(this.config.dashboardHint);
        }
        // a reply in an alert's thread is interpreted against that alert, not everything active
        const candidates = pending
            ? pending.candidates
            : (await this.getThreadAlerts(message, threadTs)) ?? await this.getActiveAlerts();
        // an interpreted reply takes a moment, so show that it landed
        await this.api.addReaction(message.channel, message.ts, "eyes");
        const intent = await this.resolver.resolve({
            text: message.text,
            pinned: pending?.kind,
            candidates
        });
        return await this.applyIntent(intent, { message, threadTs, pending, candidates });
    }

    private async applyIntent(intent: IIntent, interpretation: IInterpretation): Promise<string> {
        const { message, threadTs, pending, candidates } = interpretation;
        const chosen = () => intent.all ? candidates : intent.numbers.map(x => candidates[x - 1]);
        switch (intent.action) {
            case IntentAction.Mute:
                this.selections.clear(message.channel, threadTs, message.userId);
                return await this.mute({
                    chosen: chosen(),
                    window: { durationMs: parseDuration(intent.duration), until: intent.until },
                    actor: message,
                    pinnedList: pending?.scoped ? null : pending?.candidates
                });
            case IntentAction.Unmute:
                this.selections.clear(message.channel, threadTs, message.userId);
                return await this.unmute(chosen(), message);
            case IntentAction.Select:
                if (!pending) {
                    return messages.renderNotUnderstood(this.config.dashboardHint);
                }
                return await this.applySelection(
                    pending,
                    {
                        all: intent.all,
                        indices: intent.numbers,
                        durationMs: parseDuration(intent.duration),
                        until: intent.until
                    },
                    message);
            case IntentAction.RequestMuteList:
                return await this.requestMute({ type: CommandType.Mute, all: false }, message, threadTs);
            case IntentAction.RequestUnmuteList:
                return await this.requestUnmute({ type: CommandType.Unmute, all: false }, message, threadTs);
            case IntentAction.Status:
                return await this.status();
            case IntentAction.Cancel:
                this.selections.clear(message.channel, threadTs, message.userId);
                return messages.renderCancelled();
            case IntentAction.Help:
                return this.help();
            case IntentAction.Reply:
            default:
                return intent.message || messages.renderNotUnderstood(this.config.dashboardHint);
        }
    }

    private async applySelection(
        pending: IPinnedSelection,
        reply: ISelectionReply,
        actor: IChatMessage): Promise<string> {
        if (!reply.all) {
            const outOfRange = reply.indices.filter(x => x < 1 || x > pending.candidates.length);
            if (outOfRange.length > 0) {
                return messages.renderOutOfRange(outOfRange, pending.candidates.length);
            }
        }
        const chosen = reply.all
            ? pending.candidates
            : reply.indices.map(x => pending.candidates[x - 1]);
        this.selections.clear(pending.channel, pending.threadTs, pending.userId);
        return pending.kind === "mute"
            ? await this.mute({
                chosen,
                window: {
                    durationMs: reply.durationMs ?? pending.durationMs,
                    until: reply.until ?? pending.until
                },
                actor,
                pinnedList: pending.scoped ? null : pending.candidates
            })
            : await this.unmute(chosen, actor);
    }

    private async requestMute(
        command: ICommand,
        message: IChatMessage,
        threadTs: string): Promise<string> {
        const scoped = await this.getThreadAlerts(message, threadTs);
        const candidates = scoped ?? await this.getActiveAlerts();
        if (candidates.length === 0) {
            return scoped
                ? messages.renderThreadCleared()
                : messages.renderNothingToDo("mute");
        }
        // inside a thread the target is already unambiguous when there is one alert, or when the
        // user said "this" or "all"
        const actDirectly = command.all
            || (!!scoped && (command.scopedToThread || candidates.length === 1));
        const requestedWindow = { durationMs: command.durationMs, until: command.until };
        if (actDirectly) {
            return await this.mute({ chosen: candidates, window: requestedWindow, actor: message });
        }
        const list = messages.renderSelectionListOrTooLong({
            kind: "mute",
            candidates,
            dashboardHint: this.config.dashboardHint,
            expiry: this.describeMuteExpiry(requestedWindow)
        });
        if (!list.fits) {
            // a list too big to post is unusable - "mute all" needs no list, so it stays available
            return list.text;
        }
        // a period given with the original request survives the detour through the list, so
        // "mute for 1 hour" followed by "all" still means an hour
        this.selections.pin({
            kind: "mute",
            channel: message.channel,
            threadTs,
            userId: message.userId,
            candidates,
            scoped: !!scoped,
            ...requestedWindow
        });
        return list.text;
    }

    private async requestUnmute(
        command: ICommand,
        message: IChatMessage,
        threadTs: string): Promise<string> {
        const mutes = await this.getActiveMutes();
        if (mutes.length === 0) {
            return messages.renderNothingToDo("unmute");
        }
        if (command.all) {
            return await this.unmute(mutes, message);
        }
        const list = messages.renderSelectionListOrTooLong({
            kind: "unmute",
            candidates: mutes,
            dashboardHint: this.config.dashboardHint
        });
        if (!list.fits) {
            return list.text;
        }
        this.selections.pin({
            kind: "unmute",
            channel: message.channel,
            threadTs,
            userId: message.userId,
            candidates: mutes
        });
        return list.text;
    }

    /*
     A reply inside an alert's own thread already says which alerts are meant, so the candidates are
     narrowed to the ones that message was reporting. Returns null when this is not a thread barky
     posted an alert into, and an empty list when everything in it has since cleared.
     */
    private async getThreadAlerts(
        message: IChatMessage,
        threadTs: string): Promise<ISelectionCandidate[]> {
        if (!message.threadTs) {
            return null;
        }
        const thread = await getChatThread(message.channel, threadTs);
        if (!thread) {
            return null;
        }
        const ids = new Set(thread.alertIds);
        const active = await this.getActiveAlerts();
        return active.filter(x => ids.has(x.id));
    }

    private async mute(request: IMuteRequest): Promise<string> {
        const { chosen, actor, pinnedList } = request;
        if (chosen.length === 0) {
            return messages.renderNothingToDo("mute");
        }
        const { until, ignored } = this.resolveMuteUntil(request.window);
        const active = await this.getActiveAlerts();
        const activeIds = new Set(active.map(x => x.id));
        // an alert that recovered while the user was typing is still muted - flapping is the most
        // common reason to reach for mute in the first place
        const resolvedSince = chosen.filter(x => !activeIds.has(x.id));
        const firedSince = pinnedList
            ? active.filter(x => !pinnedList.some(candidate => candidate.id === x.id))
            : [];
        await Muter.getInstance().registerMutes(
            chosen.map(x => mutePatternFor(x.id)),
            new Date(),
            until);
        log(`chatops: muted ${ chosen.length } alert(s) until ${ until.toISOString() }`);
        await recordChatOpsAudit({
            ...await this.identify(actor),
            action: "mute",
            detail: {
                alerts: chosen.map(x => x.id),
                until: until.toISOString(),
                requested: actor?.text
            }
        });
        return messages.renderMuteOutcome({ muted: chosen, until, firedSince, resolvedSince, ignoredUntil: ignored });
    }

    private async unmute(
        chosen: ISelectionCandidate[],
        actor: IChatMessage): Promise<string> {
        if (chosen.length === 0) {
            return messages.renderNothingToDo("unmute");
        }
        await Muter.getInstance().unmute(chosen.map(x => x.id));
        log(`chatops: lifted ${ chosen.length } mute(s)`);
        await recordChatOpsAudit({
            ...await this.identify(actor),
            action: "unmute",
            detail: {
                mutes: chosen.map(x => x.id),
                requested: actor?.text
            }
        });
        return messages.renderUnmuteOutcome(chosen);
    }

    private async identify(actor: IChatMessage): Promise<Pick<IChatOpsAuditEntry, "channel" | "userId" | "userName">> {
        return {
            channel: actor?.channel,
            userId: actor?.userId,
            userName: await this.api.getUserName(actor?.userId)
        };
    }

    private async status(): Promise<string> {
        return messages.renderStatus(
            await this.getActiveAlerts(),
            await this.getActiveMutes());
    }

    private help(): string {
        return this.resolver
            ? messages.renderHelpWithInterpretation(this.config.dashboardHint)
            : messages.renderHelp(this.config.dashboardHint);
    }

    private describeMuteExpiry(requested: IMuteWindowRequest): messages.IMuteExpiry {
        return {
            description: messages.describeInstant(this.resolveMuteUntil(requested).until),
            wasRequested: requested.durationMs > 0 || !!requested.until
        };
    }

    /*
     A requested window is capped at the configured maximum. Barky's own default is deliberately
     exempt - on a Friday it reaches into Monday, which would otherwise trip a shorter cap.
     */
    private resolveMuteUntil(window: IMuteWindowRequest): { until: Date, ignored?: string } {
        const cap = new Date(Date.now() + this.config.maxMuteMs);
        if (window?.durationMs > 0) {
            const requested = new Date(Date.now() + window.durationMs);
            return { until: requested > cap ? cap : requested };
        }
        if (window?.until) {
            const named = parseLocalDateTime(window.until);
            if (named && named.getTime() > Date.now()) {
                return { until: named > cap ? cap : named };
            }
            // an expiry was asked for and cannot be honoured - muting for the default instead is
            // safe, but saying nothing would hide a substantially different outcome
            return { until: this.defaultMuteUntil(), ignored: window.until };
        }
        return { until: this.defaultMuteUntil() };
    }

    private defaultMuteUntil(): Date {
        return nextBusinessHoursStart();
    }

    private async getActiveAlerts(): Promise<ISelectionCandidate[]> {
        return await this.alerts.getActiveAlerts();
    }

    private async getActiveMutes(): Promise<ISelectionCandidate[]> {
        const windows = await Muter.getInstance().getDynamicMutes();
        return windows.map(x => ({
            id: x.match,
            title: messages.describeMutePattern(x.match),
            detail: x.to ? `until ${ messages.describeInstant(x.to) }` : null
        }));
    }
}
