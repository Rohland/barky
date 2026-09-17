import { Logger, LogLevel, SocketModeClient } from "@slack/socket-mode";
import { ChatOpsConfig } from "./config.js";
import { ChatOpsRouter } from "./router.js";
import { getChatThread, IChatThread, tryRecordChatEvent } from "../models/db.js";
import { log } from "../models/logger.js";

interface ISlackEvent {
    type: string;
    channel: string;
    channel_type?: string;
    user?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
}

interface ISlackEnvelope {
    ack: (response?: any) => Promise<void>;
    event: ISlackEvent;
}

interface ISlackSubscriber {
    on(event: string, handler: (envelope: ISlackEnvelope) => Promise<void>): unknown;
}

/*
 Slack hands each event to ONE of the sockets an app has open rather than repeating it to all of
 them, so a second barky running on the same app token quietly takes a share of the replies meant
 for this one - and drops them, having no record of the threads this one posted. The symptom is
 barky answering some replies and ignoring others at random, with nothing to go on.

 The count is only ever announced in the hello frame, which the socket mode client swallows, so it
 is read off the message it logs on the way past.
 */
const HelloConnectionsRegex = /"type"\s*:\s*"hello"[\s\S]*?"num_connections"\s*:\s*(\d+)/;

export function sharedConnections(logLine: string): number {
    const match = HelloConnectionsRegex.exec(logLine ?? "");
    const connections = match ? parseInt(match[1]) : 0;
    return connections > 1 ? connections : 0;
}

class ChatOpsLogger implements Logger {
    private level: LogLevel = LogLevel.INFO;
    private reportedConnections = 0;

    debug(...msg: any[]) {
        // socket mode debug output is very chatty, and barky's own debug flag governs it
        const line = msg.join(" ");
        this.reportSharedConnections(line);
        log(`chatops: ${ line }`);
    }

    private reportSharedConnections(line: string): void {
        const connections = sharedConnections(line);
        if (!connections || connections === this.reportedConnections) {
            return;
        }
        this.reportedConnections = connections;
        log(`chatops: this slack app has ${ connections } socket connections open, so this is not the only barky listening on it - slack gives each reply to one connection only, and the barky that receives one for a thread it did not post cannot answer it. Give each barky its own slack app`);
    }

    info(...msg: any[]) {
        log(`chatops: ${ msg.join(" ") }`);
    }

    warn(...msg: any[]) {
        log(`chatops: warn: ${ msg.join(" ") }`);
    }

    error(...msg: any[]) {
        log(`chatops: error: ${ msg.join(" ") }`);
    }

    setLevel(level: LogLevel) {
        this.level = level;
    }

    getLevel(): LogLevel {
        return this.level;
    }

    setName(_name: string) {
        // no-op, every line is already prefixed
    }
}

/*
 Receives Slack events over a Socket Mode websocket, so barky needs no inbound network access.

 Slack gives each event to one of the connections its app has open, so this must be the only barky
 running on its app token - see "One slack app per barky" in the README.
 */
export class SlackChatOpsListener {

    private _client: SocketModeClient;

    constructor(
        private readonly config: ChatOpsConfig,
        private readonly router: ChatOpsRouter) {
    }

    public async start(): Promise<void> {
        if (this._client) {
            return;
        }
        this._client = new SocketModeClient({
            appToken: this.config.appToken,
            logger: new ChatOpsLogger()
        });
        this.subscribe(this._client);
        await this._client.start();
        log("chatops: listening for slack events");
    }

    public async warmUp(): Promise<void> {
        // one per bot token the app posts with, so each reports its own scopes
        for (const service of this.router.services) {
            await service.warmUp();
        }
    }

    public async stop(): Promise<void> {
        await this._client?.disconnect();
        this._client = null;
    }

    private subscribe(client: ISlackSubscriber): void {
        client.on("app_mention", async (envelope: ISlackEnvelope) => await this.onMention(envelope));
        // barky never acts on a message that does not name it, but an unacknowledged event is
        // redelivered, so plain channel messages are acknowledged and dropped
        client.on("message", async (envelope: ISlackEnvelope) => await this.acknowledge(envelope));
    }

    private async onMention(envelope: ISlackEnvelope): Promise<void> {
        await this.acknowledge(envelope);
        await this.handle(envelope.event);
    }

    // slack expects an acknowledgement within three seconds and redelivers otherwise, so it comes
    // before any work
    private async acknowledge(envelope: ISlackEnvelope): Promise<void> {
        try {
            await envelope.ack();
        } catch (err) {
            log(`chatops: failed to ack event: ${ err }`, err);
        }
    }

    private async handle(event: ISlackEvent): Promise<void> {
        try {
            await this.dispatch(event);
        } catch (err) {
            log(`chatops: error processing event: ${ err }`, err);
        }
    }

    private async dispatch(event: ISlackEvent): Promise<void> {
        const thread = await this.threadFor(event);
        if (!thread) {
            return;
        }
        // the reply is answered by the channel config that posted the alert it is threaded under,
        // which is the one whose bot token can post in that channel
        const service = this.router.serviceFor(thread);
        if (!service) {
            // the channel that posted the alert no longer answers replies, while the thread it
            // posted lives on for the retention window - acting on it would mute from a channel
            // chat ops has been switched off in, and with a token that may not be able to reply
            log(`chatops: ignoring a reply in '${ thread.channelName }', which no longer has chat ops enabled`);
            return;
        }
        // a mention and a channel message can arrive for the same user message as separate
        // events, so the message itself is what gets recorded, not the event
        const handled = await tryRecordChatEvent(`${ event.channel }:${ event.ts }`);
        if (!handled) {
            return;
        }
        await service.handleMessage({
            channel: event.channel,
            ts: event.ts,
            threadTs: event.thread_ts,
            userId: event.user,
            text: event.text
        });
    }

    /*
     Barky only takes part in the threads of its own alert messages. It is not a general purpose
     bot listening to the channel - ordinary conversation, in the channel or in an alert's thread,
     is none of its business, and people discussing an outage must be able to say "all" or "1" to
     each other without barky acting on it.
     */
    private async threadFor(event: ISlackEvent): Promise<IChatThread> {
        if (!event?.ts || !event.user || !event.text) {
            return null;
        }
        // never react to our own alerts, or to edits, joins and other message subtypes
        if (event.bot_id || event.subtype) {
            return null;
        }
        if (!event.thread_ts) {
            return null;
        }
        const thread = await getChatThread(event.channel, event.thread_ts);
        if (!thread) {
            // either someone else's thread, or one posted by another barky sharing this slack app,
            // whose events slack shares out across every open socket
            log(`chatops: no record of the thread ${ event.channel }:${ event.thread_ts }, so the mention in it is not barky's to answer`);
        }
        return thread;
    }
}
