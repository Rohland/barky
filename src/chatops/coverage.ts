import { ChatOpsConfig } from "./config.js";
import { getEnvVar } from "../lib/env.js";

/*
 A slack channel chat ops answers in, together with the settings and the bot token governing it.
 */
export interface IChatOpsChannel {
    // the digest channel config name, which is what a recorded thread is tagged with
    name: string;
    // the slack channel as configured, for the log only - slack events carry ids, not names
    slackChannel: string;
    botToken: string;
    config: ChatOpsConfig;
    // this channel declared chat ops itself, rather than being covered by another that did
    declared: boolean;
}

/*
 One slack app, and every channel it answers in. An app level token authorises a single socket, so
 there is exactly one connection per app however many channels it covers.
 */
export interface IChatOpsApp {
    appToken: string;
    channels: IChatOpsChannel[];
}

export interface IChatOpsCoverage {
    apps: IChatOpsApp[];
    // configuration barky could not act on, for the log - a chat ops block that cannot be used is
    // otherwise indistinguishable from one that is working
    issues: string[];
}

interface ISlackChannel {
    name: string;
    raw: any;
}

interface IChannelProblem {
    channel: string;
    message: string;
}

/*
 A channel that declared chat ops. Exactly one of the two is set: the channel barky can act on, or
 the reason it cannot.
 */
interface IDeclaration {
    channel: IChatOpsChannel;
    problem: IChannelProblem;
}

/*
 Works out which slack channels chat ops covers.

 A channel declares chat ops with `chat-ops: enabled: true`. Every other slack channel posting with
 the same bot token is covered by it, because that is the same slack app: it already receives those
 events and can already post there, so a reply arriving from one of them is one barky can answer.
 Without this, adding a second channel to an existing alerting setup leaves barky silently ignoring
 every reply in it. A channel opts out with `chat-ops: enabled: false`.
 */
export function resolveChatOpsCoverage(digest: any): IChatOpsCoverage {
    const slack = slackChannelsIn(digest);
    const declarations = slack
        .filter(x => x.raw?.["chat-ops"]?.enabled === true)
        .map(x => toDeclaration(x));
    const declared = declarations.map(x => x.channel).filter(x => !!x);
    const covered = slack
        .filter(x => !declared.some(d => d.name === x.name))
        .map(x => toCoveredChannel(x, declared))
        .filter(x => !!x);
    const channels = [...declared, ...covered];
    return {
        apps: groupIntoApps(channels),
        // a channel whose own chat ops block barky could not read, but which another channel's app
        // covers anyway, is working - reporting it would send someone looking for a fault
        issues: declarations
            .map(x => x.problem)
            .filter(x => !!x && !channels.some(channel => channel.name === x.channel))
            .map(x => x.message)
    };
}

function toDeclaration(channel: ISlackChannel): IDeclaration {
    try {
        return readDeclaration(channel);
    } catch (err) {
        // a malformed period or interval in one channel must not take chat ops down everywhere
        return problemWith(channel, `has chat ops settings barky could not read: ${ err }`);
    }
}

function readDeclaration(channel: ISlackChannel): IDeclaration {
    const config = new ChatOpsConfig(channel.raw["chat-ops"]);
    if (!config.configured) {
        return problemWith(channel, "enables chat ops but has no app-token, so it cannot listen");
    }
    const botToken = getEnvVar(channel.raw.token);
    if (!botToken) {
        return problemWith(channel, "enables chat ops but has no bot token, so it cannot reply");
    }
    return {
        channel: {
            name: channel.name,
            slackChannel: channel.raw.channel,
            botToken,
            config,
            declared: true
        },
        problem: null
    };
}

function problemWith(channel: ISlackChannel, message: string): IDeclaration {
    return {
        channel: null,
        problem: { channel: channel.name, message: `channel '${ channel.name }' ${ message }` }
    };
}

function toCoveredChannel(channel: ISlackChannel, declared: IChatOpsChannel[]): IChatOpsChannel {
    if (channel.raw?.["chat-ops"]?.enabled === false) {
        return null;
    }
    const botToken = getEnvVar(channel.raw?.token);
    const owner = botToken
        ? declared.find(x => x.botToken === botToken)
        : null;
    if (!owner) {
        return null;
    }
    return {
        name: channel.name,
        slackChannel: channel.raw.channel,
        botToken,
        config: owner.config,
        declared: false
    };
}

function groupIntoApps(channels: IChatOpsChannel[]): IChatOpsApp[] {
    const apps = new Map<string, IChatOpsApp>();
    channels.forEach(channel => {
        const app = apps.get(channel.config.appToken)
            ?? { appToken: channel.config.appToken, channels: [] };
        app.channels.push(channel);
        apps.set(app.appToken, app);
    });
    // the channel that declared chat ops leads its app, so it is the one a reply barky cannot place
    // falls back to
    return Array.from(apps.values())
        .map(app => ({ ...app, channels: [...app.channels].sort(byDeclaredFirst) }));
}

function byDeclaredFirst(a: IChatOpsChannel, b: IChatOpsChannel): number {
    return Number(b.declared) - Number(a.declared);
}

function slackChannelsIn(digest: any): ISlackChannel[] {
    const channels = digest?.channels ?? {};
    return Object.keys(channels)
        .map(name => ({ name: name?.toLowerCase(), raw: channels[name] }))
        .filter(x => x.raw?.type?.toLowerCase() === "slack");
}

export function describeCoverage(app: IChatOpsApp): string {
    return app.channels
        .map(x => `${ x.name }${ x.slackChannel ? ` (${ x.slackChannel })` : "" }`)
        .join(", ");
}
