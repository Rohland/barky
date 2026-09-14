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
export async function startChatOps(
    args: any,
    digest: any,
    now: number = Date.now()): Promise<SlackChatOpsListener> {
    if (_listener) {
        return _listener;
    }
    const channel = findChatOpsChannelConfig(digest);
    if (!channel) {
        return null;
    }
    if (now < _nextAttemptAfter) {
        return null;
    }
    try {
        // reading the configuration is inside the try as well - a malformed period or interval
        // throws, and a typo in an optional key must not be able to stop the watchdog
        const config = new ChatOpsConfig(channel["chat-ops"]);
        if (!config.configured) {
            return null;
        }
        if (!args?.loop) {
            // chat ops needs a process that outlives a single evaluation to hold the socket open
            log("chat ops is configured but only runs under the 'loop' command - skipping");
            return null;
        }
        const service = new ChatOpsService(config, new SlackApi(getEnvVar(channel.token)));
        const listener = new SlackChatOpsListener(config, service);
        await listener.start();
        await service.warmUp();
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
