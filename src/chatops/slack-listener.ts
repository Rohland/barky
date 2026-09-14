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
        this._client.on("app_mention", async (envelope: ISlackEnvelope) => await this.onEvent(envelope, true));
        this._client.on("message", async (envelope: ISlackEnvelope) => await this.onEvent(envelope, false));
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

    private async onEvent(envelope: ISlackEnvelope, isMention: boolean): Promise<void> {
        // acknowledge first - slack expects one within three seconds and redelivers otherwise
        try {
            await envelope.ack();
        } catch (err) {
            log(`chatops: failed to ack event: ${ err }`, err);
        }
        try {
            const event = envelope.event;
            if (!await this.shouldHandle(event, isMention)) {
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
        } catch (err) {
            log(`chatops: error processing event: ${ err }`, err);
        }
    }

    /*
     Barky only takes part in the threads of its own alert messages, and only when it is spoken to
     there. It is not a general purpose bot listening to the channel - ordinary conversation, in the
     channel or in an alert's thread, is none of its business.
     */
    private async shouldHandle(event: ISlackEvent, isMention: boolean): Promise<boolean> {
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
        const thread = await getChatThread(event.channel, event.thread_ts);
        if (!thread) {
            return false;
        }
        // addressed to barky, or answering a question barky asked this person
        return isMention
            || this.service.hasPendingSelection(event.channel, event.thread_ts, event.user);
    }
}
