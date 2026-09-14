import { ChatOpsConfig } from "./config.js";
import { ChatOpsService } from "./chatops.service.js";
import { SlackChatOpsListener } from "./slack-listener.js";
import { SlackApi } from "../models/channels/slack-api.js";
import { getEnvVar } from "../lib/env.js";
import { log } from "../models/logger.js";

const RetryAfterFailureMs = 5 * 60 * 1000;

let _listener: SlackChatOpsListener = null;
let _nextAttemptAfter = 0;

export function findChatOpsChannelConfig(digest: any) {
    const channels = digest?.channels ?? {};
    return Object.keys(channels)
        .map(name => channels[name])
        .find(channel => channel?.type?.toLowerCase() === "slack" && channel["chat-ops"]?.enabled === true);
}

/*
 Starts the chat ops listener if it is configured, and never throws - a slack outage or a bad token
 must not stop barky from monitoring. A failed connection is retried on a later pass rather than
 once every loop, so a permanently bad token cannot flood the log.
 */
export type ListenerFactory = (config: ChatOpsConfig, channel: any) => SlackChatOpsListener;

function buildListener(config: ChatOpsConfig, channel: any): SlackChatOpsListener {
    const service = new ChatOpsService(config, new SlackApi(getEnvVar(channel.token)));
    return new SlackChatOpsListener(config, service);
}

export async function startChatOps(
    args: any,
    digest: any,
    now: number = Date.now(),
    createListener: ListenerFactory = buildListener): Promise<SlackChatOpsListener> {
    // the configuration is reloaded on every pass, so a channel that has had chat ops removed or
    // switched off must take the listener down with it rather than leaving the socket live until
    // the process restarts
    const channel = findChatOpsChannelConfig(digest);
    if (!channel) {
        await stopChatOps();
        return null;
    }
    if (_listener) {
        return _listener;
    }
    if (now < _nextAttemptAfter) {
        return null;
    }
    try {
        // reading the configuration is inside the try as well - a malformed period or interval
        // throws, and a typo in an optional key must not be able to stop the watchdog
        const config = new ChatOpsConfig(channel["chat-ops"]);
        if (!config.configured) {
            await stopChatOps();
            return null;
        }
        if (!args?.loop) {
            // chat ops needs a process that outlives a single evaluation to hold the socket open
            log("chat ops is configured but only runs under the 'loop' command - skipping");
            return null;
        }
        const listener = createListener(config, channel);
        await listener.start();
        await listener.warmUp();
        _listener = listener;
        _nextAttemptAfter = 0;
        return _listener;
    } catch (err) {
        _nextAttemptAfter = now + RetryAfterFailureMs;
        log(`chat ops failed to start, retrying in ${ RetryAfterFailureMs / 60000 } minutes: ${ err }`, err);
        return null;
    }
}

export async function stopChatOps() {
    try {
        await _listener?.stop();
    } catch {
        // no-op
    }
    _listener = null;
    _nextAttemptAfter = 0;
}
