import { WebState } from "../web/web.state.js";
import { Muter } from "../muter.js";
import { getChatThread, IChatOpsAuditEntry, recordChatOpsAudit } from "../models/db.js";
import { SlackApi } from "../models/channels/slack-api.js";
import { IPinnedSelection, ISelectionCandidate, SelectionStore } from "./selection.js";
import { ChatOpsConfig } from "./config.js";
import { CommandType, ICommand, ISelectionReply, parseCommand, parseDuration, parseLocalDateTime, parseSelectionReply } from "./parser.js";
import { AiUnavailableError, IIntent, IIntentResolver, IntentAction } from "./ai/types.js";
import { AiIntentResolver } from "./ai/resolver.js";
import { IDefinitionSource } from "./definitions.js";
import { GitPermalinkSource, IPermalinkSource } from "./permalink.js";
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
    // set where the mention is in the thread of a follow-up ping, which only points at the thread
    // of the alert itself
    pointsTo?: { url?: string };
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
    definitions?: IDefinitionSource;
    permalinks?: IPermalinkSource;
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
    pinned?: IPinnedSelection;
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
    // absent where barky has no rules configuration to read, which is the only state in which it
    // cannot answer for how a check is declared
    private readonly definitions: IDefinitionSource;
    private readonly permalinks: IPermalinkSource;

    constructor(
        private readonly config: ChatOpsConfig,
        private readonly api: SlackApi,
        dependencies: IChatOpsDependencies = {}) {
        this.alerts = dependencies.alerts ?? new WebStateAlertSource();
        this.resolver = dependencies.resolver
            ?? (config.ai.configured ? new AiIntentResolver(config.ai) : null);
        this.selections = dependencies.selections ?? new SelectionStore(config.selectionTtlMs);
        this.definitions = dependencies.definitions ?? null;
        this.permalinks = dependencies.permalinks ?? new GitPermalinkSource();
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
        if (message.pointsTo) {
            // said in the thread of a message barky replaces on every check, so anything it did
            // here - and anything it said about it - would be deleted underneath the person who
            // asked. They are answered, and pointed at the thread that lasts
            return messages.renderReplyInAlertThread(message.pointsTo.url);
        }
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
            if (!pending && parseSelectionReply(message.text)) {
                // an answer to a list barky no longer has - it did not survive whatever restarted
                return messages.renderNoListWaiting();
            }
            return await this.interpret(message, threadTs, pending);
        }
        switch (command.type) {
            case CommandType.Mute:
                return await this.requestMute(command, message, threadTs);
            case CommandType.Unmute:
                return await this.requestUnmute(command, message, threadTs);
            case CommandType.Define:
                return await this.requestDefine(message, threadTs);
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
            return this.notUnderstood(pending);
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
                    pinned: pending
                });
            case IntentAction.Unmute:
                this.selections.clear(message.channel, threadTs, message.userId);
                return await this.unmute(chosen(), message);
            case IntentAction.Define: {
                const targets = chosen();
                const refusal = this.tooManyToDefine(targets);
                if (refusal) {
                    return refusal;
                }
                this.selections.clear(message.channel, threadTs, message.userId);
                return await this.define(targets, message);
            }
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
                // "silence the noisy ones for 4h" names a period but not the alerts, so the list
                // is shown carrying the period the user already gave rather than losing it. "all"
                // is deliberately not carried - a list is being offered precisely because it is
                // not yet clear what was meant, so nothing is muted without a reply
                return await this.requestMute(
                    {
                        type: CommandType.Mute,
                        all: false,
                        durationMs: parseDuration(intent.duration),
                        until: intent.until
                    },
                    message,
                    threadTs);
            case IntentAction.RequestUnmuteList:
                return await this.requestUnmute({ type: CommandType.Unmute, all: false }, message, threadTs);
            case IntentAction.RequestDefineList:
                return await this.requestDefine(message, threadTs);
            case IntentAction.Status:
                return await this.status();
            case IntentAction.Cancel:
                this.selections.clear(message.channel, threadTs, message.userId);
                return messages.renderCancelled();
            case IntentAction.Help:
                return this.help();
            case IntentAction.Reply:
            default:
                return intent.message || this.notUnderstood(pending);
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
        const refusal = pending.kind === "define" ? this.tooManyToDefine(chosen) : null;
        if (refusal) {
            return refusal;
        }
        this.selections.clear(pending.channel, pending.threadTs, pending.userId);
        if (pending.kind === "define") {
            return await this.define(chosen, actor);
        }
        return pending.kind === "mute"
            ? await this.mute({
                chosen,
                window: {
                    durationMs: reply.durationMs ?? pending.durationMs,
                    until: reply.until ?? pending.until
                },
                actor,
                pinned: pending
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

    private async requestDefine(
        message: IChatMessage,
        threadTs: string): Promise<string> {
        if (!this.definitions) {
            return messages.renderDefineUnavailable(this.config.dashboardHint);
        }
        const scoped = await this.getThreadAlerts(message, threadTs);
        const candidates = scoped ?? await this.getActiveAlerts();
        if (candidates.length === 0) {
            return scoped
                ? messages.renderThreadCleared()
                : messages.renderNothingToDefine();
        }
        // one alert is unambiguous however it was asked for, and anything more needs the list -
        // only one definition is shown at a time, so "all" cannot be honoured as asked
        if (candidates.length === 1) {
            return await this.define(candidates, message);
        }
        const list = messages.renderSelectionListOrTooLong({
            kind: "define",
            candidates,
            dashboardHint: this.config.dashboardHint
        });
        if (!list.fits) {
            return list.text;
        }
        this.selections.pin({
            kind: "define",
            channel: message.channel,
            threadTs,
            userId: message.userId,
            candidates,
            scoped: !!scoped
        });
        return list.text;
    }

    /*
     More than one definition asked for at once, which barky does not do. Nothing is acted on, so
     callers check this before clearing anything: the numbered list stays pinned for a reply naming
     one of them.
     */
    private tooManyToDefine(chosen: ISelectionCandidate[]): string {
        return chosen.length > messages.MaxDefinitions
            ? messages.renderTooManyToDefine(chosen.length, this.config.dashboardHint)
            : null;
    }

    private async define(
        chosen: ISelectionCandidate[],
        actor: IChatMessage): Promise<string> {
        if (!this.definitions) {
            return messages.renderDefineUnavailable(this.config.dashboardHint);
        }
        if (chosen.length === 0) {
            return messages.renderNothingToDefine();
        }
        const refusal = this.tooManyToDefine(chosen);
        if (refusal) {
            return refusal;
        }
        const described = await this.describeDefinition(chosen[0]);
        // nothing changed, but who asked what barky is checking is worth having alongside the
        // mutes in the same log
        await recordChatOpsAudit({
            ...await this.identify(actor),
            action: "define",
            detail: {
                alerts: chosen.map(x => x.id),
                requested: actor?.text
            }
        });
        return described;
    }

    private async describeDefinition(candidate: ISelectionCandidate): Promise<string> {
        try {
            return await this.readDefinition(candidate);
        } catch (err) {
            // a config file edited mid-read, or yaml that no longer parses, is worth saying out
            // loud - the generic failure message would send someone looking for a slack problem
            log(`chatops: could not read the configuration for ${ candidate.id }: ${ err }`, err);
            return messages.renderDefinitionUnreadable(candidate.id);
        }
    }

    /*
     One alert's configuration. Looking up a github link costs a couple of git calls, so it is only
     done for a block that will not fit in the message.
     */
    private async readDefinition(candidate: ISelectionCandidate): Promise<string> {
        const definition = this.definitions.find(candidate.id);
        if (!definition) {
            return messages.renderDefinitionNotFound(candidate.id, this.config.dashboardHint);
        }
        const permalink = messages.definitionFitsSlack(definition)
            ? null
            : await this.permalinks?.forDefinition(definition);
        return messages.renderDefinition({ ...definition, permalink });
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
        return await this.narrowToThread(await this.getActiveAlerts(), message.channel, threadTs);
    }

    private async narrowToThread(
        active: ISelectionCandidate[],
        channel: string,
        threadTs: string): Promise<ISelectionCandidate[]> {
        const thread = await getChatThread(channel, threadTs);
        if (!thread) {
            return null;
        }
        const ids = new Set(thread.alertIds);
        return active.filter(x => ids.has(x.id));
    }

    /*
     "all" means the alerts the user was shown, so anything that started firing while they were
     reading is deliberately left alone - and said so, rather than quietly slipping past the mute.
     Drift is measured against the same set the list was drawn from: a list drawn inside an alert's
     thread was never a list of everything, so alerts elsewhere are not drift against it.
     */
    private async alertsFiredSince(
        pinned: IPinnedSelection,
        active: ISelectionCandidate[]): Promise<ISelectionCandidate[]> {
        if (!pinned) {
            return [];
        }
        const universe = pinned.scoped
            ? (await this.narrowToThread(active, pinned.channel, pinned.threadTs)) ?? []
            : active;
        return universe.filter(x => !pinned.candidates.some(candidate => candidate.id === x.id));
    }

    private async mute(request: IMuteRequest): Promise<string> {
        const { chosen, actor } = request;
        if (chosen.length === 0) {
            return messages.renderNothingToDo("mute");
        }
        const { until, ignored } = this.resolveMuteUntil(request.window);
        const active = await this.getActiveAlerts();
        const activeIds = new Set(active.map(x => x.id));
        // an alert that recovered while the user was typing is still muted - flapping is the most
        // common reason to reach for mute in the first place
        const resolvedSince = chosen.filter(x => !activeIds.has(x.id));
        const firedSince = await this.alertsFiredSince(request.pinned, active);
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

    private notUnderstood(pending: IPinnedSelection): string {
        return pending
            ? messages.renderNotUnderstoodWithList(pending.kind)
            : messages.renderNotUnderstood(this.config.dashboardHint);
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
