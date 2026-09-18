import { ChatOpsService } from "./chatops.service.js";
import { IChatThread } from "../models/db.js";

/*
 Picks the chat ops service that answers a reply, which is the one whose channel config posted the
 alert the reply is threaded under. That matters where an app is installed in more than one place:
 the bot token that can post in a channel is the one belonging to the install that posted there, and
 replying with any other is rejected by slack after the mute has already been applied.

 A thread naming a channel the app no longer answers in gets no service at all - the channel was
 opted out of chat ops or dropped from the digest, and its recorded threads outlive that by the
 retention window, so acting on one would mute from a channel the operator has switched off.

 Threads recorded before barky tracked which channel posted them name none, and fall back to the
 channel that declared chat ops for the app.
 */
export class ChatOpsRouter {

    constructor(
        private readonly primary: ChatOpsService,
        private readonly byChannelName = new Map<string, ChatOpsService>()) {
    }

    public serviceFor(thread: IChatThread): ChatOpsService {
        const name = thread?.channelName?.toLowerCase();
        if (!name) {
            return this.primary;
        }
        return this.byChannelName.get(name) ?? null;
    }

    public get services(): ChatOpsService[] {
        return Array.from(new Set<ChatOpsService>([this.primary, ...this.byChannelName.values()]));
    }
}
