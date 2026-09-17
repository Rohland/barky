import { ChatOpsService } from "./chatops.service.js";
import { SlackChatOpsListener } from "./slack-listener.js";
import { ChatOpsRouter } from "./router.js";
import { describeCoverage, IChatOpsApp, IChatOpsChannel, resolveChatOpsCoverage } from "./coverage.js";
import { ChatOpsConfig } from "./config.js";
import { AiIntentResolver } from "./ai/resolver.js";
import { IIntentResolver } from "./ai/types.js";
import { ConfigDefinitionSource, RulesProvider } from "./definitions.js";
import { GitPermalinkSource } from "./permalink.js";
import { SlackApi } from "../models/channels/slack-api.js";
import { log } from "../models/logger.js";

const RetryAfterFailureMs = 5 * 60 * 1000;

interface IRunningListener {
    listener: SlackChatOpsListener;
    // what it was built to cover, so a channel added or a token rotated while barky is looping is
    // picked up rather than waiting for a restart
    covering: string;
}

// one socket per slack app, however many channels it answers in - an app level token authorises a
// single connection, and slack spreads events across any others rather than repeating them
const _running = new Map<string, IRunningListener>();
const _nextAttemptAfter = new Map<string, number>();
/*
 How the running listeners reach the evaluator rules, which is where the yaml declaring a check
 lives. Held here rather than captured per listener because barky reloads the configuration on
 every pass: a listener built on the first pass would otherwise answer out of that pass's copy for
 as long as the process ran.
 */
let _rules: RulesProvider = null;
let _reportedIssues: string = null;
let _reportedNotLooping = false;

export type ListenerFactory = (app: IChatOpsApp) => SlackChatOpsListener;

export interface IStartChatOpsOptions {
    now?: number;
    createListener?: ListenerFactory;
    // reads the current evaluator rules, so barky can say how a check is declared
    rules?: RulesProvider;
}

/*
 Starts a chat ops listener for every slack app the digest configures it on, and never throws - a
 slack outage or a bad token must not stop barky from monitoring. A failed connection is retried on
 a later pass rather than once every loop, so a permanently bad token cannot flood the log, and one
 app failing does not hold up the others.
 */
export async function startChatOps(
    args: any,
    digest: any,
    options: IStartChatOpsOptions = {}): Promise<SlackChatOpsListener[]> {
    const now = options.now ?? Date.now();
    const createListener = options.createListener ?? buildListener;
    _rules = options.rules ?? _rules;
    // the configuration is reloaded on every pass, so a channel that has had chat ops removed or
    // switched off must take its listener down with it rather than leaving the socket live until
    // the process restarts
    const coverage = resolveChatOpsCoverage(digest);
    reportIssues(coverage.issues);
    await stopListenersNotIn(coverage.apps);
    if (coverage.apps.length === 0) {
        return [];
    }
    if (!args?.loop) {
        // chat ops needs a process that outlives a single evaluation to hold the socket open
        reportNotLooping();
        return [];
    }
    for (const app of coverage.apps) {
        await startApp(app, now, createListener);
    }
    return Array.from(_running.values()).map(x => x.listener);
}

export async function stopChatOps() {
    for (const appToken of Array.from(_running.keys())) {
        await stopListener(appToken);
    }
    _running.clear();
    _nextAttemptAfter.clear();
    _rules = null;
    _reportedIssues = null;
    _reportedNotLooping = false;
}

/*
 Every channel an app covers gets a service, keyed by the bot token it posts with and the settings
 governing it, so a reply is answered by the install that can actually post in that channel, under
 the settings that channel declared. A channel covered by another shares its config, and so shares
 its service, and with it the numbered lists someone has pending.
 */
export function buildListener(app: IChatOpsApp): SlackChatOpsListener {
    const serviceFor = sharedServices();
    const byChannelName = new Map<string, ChatOpsService>();
    app.channels.forEach(channel => byChannelName.set(channel.name, serviceFor(channel)));
    const [primaryChannel] = app.channels;
    return new SlackChatOpsListener(
        primaryChannel.config,
        new ChatOpsRouter(byChannelName.get(primaryChannel.name), byChannelName));
}

async function stopListenersNotIn(apps: IChatOpsApp[]): Promise<void> {
    const wanted = new Set(apps.map(x => x.appToken));
    for (const appToken of Array.from(_running.keys())) {
        if (!wanted.has(appToken)) {
            await stopListener(appToken);
        }
    }
    Array.from(_nextAttemptAfter.keys())
        .filter(x => !wanted.has(x))
        .forEach(x => _nextAttemptAfter.delete(x));
}

async function startApp(app: IChatOpsApp, now: number, createListener: ListenerFactory): Promise<void> {
    try {
        await attemptStart(app, now, createListener);
    } catch (err) {
        _nextAttemptAfter.set(app.appToken, now + RetryAfterFailureMs);
        log(`chat ops failed to start for ${ describeCoverage(app) }, retrying in ${ RetryAfterFailureMs / 60000 } minutes: ${ err }`, err);
    }
}

async function attemptStart(app: IChatOpsApp, now: number, createListener: ListenerFactory): Promise<void> {
    await stopListenerNoLongerCovering(app);
    if (_running.has(app.appToken) || now < (_nextAttemptAfter.get(app.appToken) ?? 0)) {
        return;
    }
    const listener = createListener(app);
    await listener.start();
    // the socket is live and already delivering events from here, so it is tracked before anything
    // else runs - a failure in between would otherwise leave a connection nothing holds a reference
    // to, still handling mentions, with the next pass adding a second one
    _running.set(app.appToken, { listener, covering: coveringSignature(app) });
    _nextAttemptAfter.delete(app.appToken);
    log(`chat ops is listening for ${ describeCoverage(app) }`);
    await warmUp(listener);
}

async function stopListenerNoLongerCovering(app: IChatOpsApp): Promise<void> {
    const running = _running.get(app.appToken);
    if (!running || running.covering === coveringSignature(app)) {
        return;
    }
    // the channels this app answers in, or the token it answers with, are not the ones the running
    // listener was built around - it would reply to the new ones with the wrong token
    log(`chat ops is reconnecting for ${ describeCoverage(app) }, which is not what it was covering`);
    await stopListener(app.appToken);
}

/*
 Warming up resolves the ai model and reports missing scopes, both of which only make the log more
 useful - a failure there is not a reason to take a working listener down.
 */
async function warmUp(listener: SlackChatOpsListener): Promise<void> {
    try {
        await listener.warmUp();
    } catch (err) {
        log(`chat ops started but could not warm up: ${ err }`, err);
    }
}

/*
 Only what a reply depends on: which channels the app covers and the token each is answered with.
 The rest of the chat ops settings are read at startup, the same as they always were, so editing a
 dashboard url does not drop the numbered lists people have pending.
 */
function coveringSignature(app: IChatOpsApp): string {
    return app.channels.map(x => `${ x.name }:${ x.botToken }`).join(",");
}

async function stopListener(appToken: string): Promise<void> {
    await tryStopListener(appToken);
    _running.delete(appToken);
    _nextAttemptAfter.delete(appToken);
}

async function tryStopListener(appToken: string): Promise<void> {
    try {
        await _running.get(appToken)?.listener.stop();
    } catch {
        // a socket that will not close cleanly is already gone as far as barky is concerned, and
        // the reference is dropped by the caller either way
    }
}

/*
 Configuration barky cannot act on is reported once rather than on every pass, since the loop reads
 the digest again every time and a typo would otherwise fill the log.
 */
function reportIssues(issues: string[]): void {
    const reported = issues.join("\n");
    if (reported === _reportedIssues) {
        return;
    }
    _reportedIssues = reported;
    issues.forEach(x => log(`chat ops: ${ x }`));
}

function reportNotLooping(): void {
    if (_reportedNotLooping) {
        return;
    }
    _reportedNotLooping = true;
    log("chat ops is configured but only runs under the 'loop' command - skipping");
}

function sharedServices(): (channel: IChatOpsChannel) => ChatOpsService {
    const resolverFor = sharedResolvers();
    const byConfig = new Map<ChatOpsConfig, Map<string, ChatOpsService>>();
    // both read only and hold nothing per channel, so every service shares the one of each
    const definitions = new ConfigDefinitionSource(() => _rules?.() ?? null);
    const permalinks = new GitPermalinkSource();
    return channel => {
        const byBotToken = byConfig.get(channel.config) ?? new Map<string, ChatOpsService>();
        byConfig.set(channel.config, byBotToken);
        const service = byBotToken.get(channel.botToken) ?? new ChatOpsService(
            channel.config,
            new SlackApi(channel.botToken),
            {
                resolver: resolverFor(channel.config),
                definitions,
                permalinks
            });
        byBotToken.set(channel.botToken, service);
        return service;
    };
}

/*
 One resolver per ai setup rather than per service, because the call budget it holds is a ceiling
 on what barky spends in an hour - with one each, an app answering in two installs would quietly
 be allowed twice what the configuration asks for. Channels configured against different services
 or with different ceilings are asking for a budget each, so they get one.
 */
function sharedResolvers(): (config: ChatOpsConfig) => IIntentResolver {
    const byAi = new Map<string, IIntentResolver>();
    return config => {
        if (!config.ai.configured) {
            return null;
        }
        const resolver = byAi.get(config.ai.signature) ?? new AiIntentResolver(config.ai);
        byAi.set(config.ai.signature, resolver);
        return resolver;
    };
}
