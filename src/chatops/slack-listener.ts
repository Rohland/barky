import { Logger, LogLevel, SocketModeClient } from "@slack/socket-mode";
import { ChatOpsConfig } from "./config.js";
import { ChatOpsService } from "./chatops.service.js";
import { getChatThread, tryRecordChatEvent } from "../models/db.js";
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

class ChatOpsLogger implements Logger {
    private level: LogLevel = LogLevel.INFO;

    debug(...msg: any[]) {
        // socket mode debug output is very chatty, and barky's own debug flag governs it
        log(`chatops: ${ msg.join(" ") }`);
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
 */
export class SlackChatOpsListener {

    private _client: SocketModeClient;

    constructor(
        private readonly config: ChatOpsConfig,
        private readonly service: ChatOpsService) {
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
        await this.service.warmUp();
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
        if (!await this.shouldHandle(event)) {
            return;
        }
        // a mention and a channel message can arrive for the same user message as separate
        // events, so the message itself is what gets recorded, not the event
        const handled = await tryRecordChatEvent(`${ event.channel }:${ event.ts }`);
        if (!handled) {
            return;
        }
        await this.service.handleMessage({
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
    private async shouldHandle(event: ISlackEvent): Promise<boolean> {
        if (!event?.ts || !event.user || !event.text) {
            return false;
        }
        // never react to our own alerts, or to edits, joins and other message subtypes
        if (event.bot_id || event.subtype) {
            return false;
        }
        if (!event.thread_ts) {
            return false;
        }
        return !!await getChatThread(event.channel, event.thread_ts);
    }
}
