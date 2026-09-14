import { WebState } from "../web/web.state.js";
import { Muter } from "../muter.js";
import { getChatThread, recordChatOpsAudit } from "../models/db.js";
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

    private readonly selections: SelectionStore;


    constructor(
        private readonly config: ChatOpsConfig,
        private readonly api: SlackApi,
        private readonly alerts: IAlertSource = new WebStateAlertSource(),
        private readonly resolver: IIntentResolver = config.ai.configured
            ? new AiIntentResolver(config.ai)
            : null,
        selections: SelectionStore = null) {
        this.selections = selections ?? new SelectionStore(config.selectionTtlMs);
    }

    public async handleMessage(message: IChatMessage): Promise<void> {
        // replies always land in a thread, so a numbered list has a container of its own and two
        // people can run separate selections in the same channel without colliding
        const threadTs = message.threadTs ?? message.ts;
        this.selections.sweep();
        let reply: string;
        try {
            reply = await this.resolve(message, threadTs);
        } catch (err) {
            log(`chatops: failed handling message in ${ message.channel }: ${ err }`, err);
            reply = messages.renderFailed(this.config.dashboardHint);
        }
        if (!reply) {
            return;
        }
        await this.api.postMessage(message.channel, reply, threadTs);
    }

    /*
     Lets the listener tell an unrelated channel message apart from a reply to a list barky posted,
     so replies need no mention while everything else is left alone.
     */
    public hasPendingSelection(
        channel: string,
        threadTs: string,
        userId: string): boolean {
        // an expired list still counts, so a late reply is answered rather than ignored
        return !!this.selections.peek(channel, threadTs, userId);
    }

    public get pendingSelectionCount(): number {
        return this.selections.size;
    }

    /*
     Resolves the ai model up front so the choice is made and logged at startup rather than on the
     first person to ask barky something. Failure is not fatal - it is retried on demand.
     */
    public async warmUp(): Promise<void> {
        if (!this.resolver?.warmUp) {
            return;
        }
        try {
            await this.resolver.warmUp();
        } catch (err) {
            log(`chatops: could not resolve the ai model at startup, will retry on demand: ${ err }`, err);
        }
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
                return messages.renderHelp(this.config.dashboardHint, !!this.resolver);
        }
    }

    /*
     Anything the local parser cannot read is handed to the AI service, which only ever chooses
     numbers from the list barky supplies. When that service cannot be reached the user is told so
     and pointed at the dashboard - barky never guesses.
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
        let intent: IIntent;
        try {
            intent = await this.resolver.resolve({
                text: message.text,
                pinned: pending?.kind,
                candidates
            });
        } catch (err) {
            if (err instanceof AiUnavailableError) {
                return messages.renderUnavailable(this.config.dashboardHint);
            }
            throw err;
        }
        return await this.applyIntent(intent, message, threadTs, pending, candidates);
    }

    private async applyIntent(
        intent: IIntent,
        message: IChatMessage,
        threadTs: string,
        pending: IPinnedSelection,
        candidates: ISelectionCandidate[]): Promise<string> {
        switch (intent.action) {
            case IntentAction.Mute: {
                const chosen = intent.all
                    ? candidates
                    : intent.numbers.map(x => candidates[x - 1]);
                this.selections.clear(message.channel, threadTs, message.userId);
                return await this.mute(
                    chosen,
                    { durationMs: parseDuration(intent.duration), until: intent.until },
                    message,
                    pending?.scoped ? null : pending?.candidates);
            }
            case IntentAction.Unmute:
                this.selections.clear(message.channel, threadTs, message.userId);
                return await this.unmute(
                    intent.all ? candidates : intent.numbers.map(x => candidates[x - 1]),
                    message);
            case IntentAction.Select:
                if (!pending) {
                    return messages.renderNotUnderstood(this.config.dashboardHint);
                }
                return await this.applySelection(
                    pending,
                    {
                        all: intent.all,
                        indices: intent.numbers,
                        durationMs: parseDuration(intent.duration)
                    },
                    message,
                    intent.until);
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
                return messages.renderHelp(this.config.dashboardHint, !!this.resolver);
            case IntentAction.Reply:
            default:
                return intent.message || messages.renderNotUnderstood(this.config.dashboardHint);
        }
    }

    private async applySelection(
        pending: IPinnedSelection,
        reply: ISelectionReply,
        actor: IChatMessage,
        until?: string): Promise<string> {
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
            ? await this.mute(
                chosen,
                { durationMs: reply.durationMs, until },
                actor,
                pending.scoped ? null : pending.candidates)
            : await this.unmute(chosen, actor);
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
        if (actDirectly) {
            return await this.mute(candidates, { durationMs: command.durationMs }, message);
        }
        const list = messages.renderSelectionListOrTooLong(
            "mute",
            candidates,
            messages.describeInstant(this.defaultMuteUntil()),
            this.config.dashboardHint);
        if (!list.fits) {
            // a list too big to post is unusable - "mute all" needs no list, so it stays available
            return list.text;
        }
        this.selections.pin("mute", message.channel, threadTs, message.userId, candidates, !!scoped);
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
        const list = messages.renderSelectionListOrTooLong(
            "unmute",
            mutes,
            null,
            this.config.dashboardHint);
        if (!list.fits) {
            return list.text;
        }
        this.selections.pin("unmute", message.channel, threadTs, message.userId, mutes);
        return list.text;
    }

    private async mute(
        chosen: ISelectionCandidate[],
        window: IMuteWindowRequest,
        actor: IChatMessage,
        pinned?: ISelectionCandidate[]): Promise<string> {
        if (chosen.length === 0) {
            return messages.renderNothingToDo("mute");
        }
        const until = this.resolveMuteUntil(window);
        const active = await this.getActiveAlerts();
        const activeIds = new Set(active.map(x => x.id));
        // an alert that recovered while the user was typing is still muted - flapping is the most
        // common reason to reach for mute in the first place
        const resolvedSince = chosen.filter(x => !activeIds.has(x.id));
        const firedSince = pinned
            ? active.filter(x => !pinned.some(candidate => candidate.id === x.id))
            : [];
        const from = new Date();
        for (const candidate of chosen) {
            await Muter.getInstance().registerMute(mutePatternFor(candidate.id), from, until);
        }
        log(`chatops: muted ${ chosen.length } alert(s) until ${ until.toISOString() }`);
        await recordChatOpsAudit({
            channel: actor?.channel,
            userId: actor?.userId,
            action: "mute",
            detail: {
                alerts: chosen.map(x => x.id),
                until: until.toISOString(),
                requested: actor?.text
            }
        });
        return messages.renderMuteOutcome(chosen, until, firedSince, resolvedSince);
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
            channel: actor?.channel,
            userId: actor?.userId,
            action: "unmute",
            detail: {
                mutes: chosen.map(x => x.id),
                requested: actor?.text
            }
        });
        return messages.renderUnmuteOutcome(chosen);
    }

    private async status(): Promise<string> {
        return messages.renderStatus(
            await this.getActiveAlerts(),
            await this.getActiveMutes());
    }

    /*
     A requested window is capped at the configured maximum. Barky's own default is deliberately
     exempt - on a Friday it reaches into Monday, which would otherwise trip a shorter cap.
     */
    private resolveMuteUntil(window: IMuteWindowRequest): Date {
        const cap = new Date(Date.now() + this.config.maxMuteMs);
        if (window?.durationMs > 0) {
            const requested = new Date(Date.now() + window.durationMs);
            return requested > cap ? cap : requested;
        }
        const named = window?.until ? parseLocalDateTime(window.until) : null;
        if (named && named.getTime() > Date.now()) {
            return named > cap ? cap : named;
        }
        return this.defaultMuteUntil();
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
