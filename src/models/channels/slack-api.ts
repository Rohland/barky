import axios from "axios";
import { tryExecuteTimes } from "../../lib/utility.js";
import { describeError } from "../../lib/error.js";
import { log } from "../logger.js";

export type SlackTimestamp = string | number;

export interface ISlackMessageRef {
    channel: string;
    ts: SlackTimestamp;
}

const SlackApiBaseUrl = "https://slack.com/api";
const RequestTimeoutMs = 5000;

// slack refuses message updates beyond this, so anything barky composes has to fit
export const SlackMaxMessageLength = 3000;

/*
 Slack answers 200 with an error code in the body rather than a failure status, so the code is
 carried here for the retry and the debug log to read - and stated in the message, which is the
 only part of it that reaches an operator who is not running with --debug.
 */
export class SlackApiError extends Error {
    constructor(public readonly slackError: string) {
        super(`slack rejected the request: ${ slackError }`);
        this.name = "SlackApiError";
    }
}

/*
 Refusals retrying cannot change. Most are configuration or state barky cannot fix by asking again
 a moment later - the message is gone, the channel is not one it is in, the token is not valid, the
 text is too long - so the attempt is reported once rather than three times half a second apart.
 */
const PermanentSlackErrors = new Set([
    "message_not_found",
    "cant_update_message",
    "cant_delete_message",
    "channel_not_found",
    "not_in_channel",
    "is_archived",
    "invalid_auth",
    "account_inactive",
    "token_revoked",
    "token_expired",
    "no_permission",
    "missing_scope",
    "not_allowed_token_type",
    "restricted_action",
    "ekm_access_denied",
    "msg_too_long",
    "no_text",
    "invalid_arguments",
    "invalid_blocks"
]);

/*
 The code slack refused a request with, from anywhere in an error's cause chain - barky wraps the
 failure as it passes back through the retry, so the code is no longer on the error being handled.
 */
export function slackErrorCodeOf(err: any, depth: number = 0): string {
    if (!err || depth > 10) {
        return null;
    }
    return err.slackError ?? slackErrorCodeOf(err.cause, depth + 1);
}

export function isPermanentSlackError(err: any): boolean {
    return PermanentSlackErrors.has(slackErrorCodeOf(err));
}

/*
 Slack has no record of the message barky is updating - someone deleted it, or it is older than the
 workspace retains. The reference barky is holding is dead, whatever it does next.
 */
export function isMissingSlackMessage(err: any): boolean {
    return slackErrorCodeOf(err) === "message_not_found";
}

/*
 A thin wrapper over the Slack web API, holding the auth, retry and error handling shared by the
 alerting channel and chat ops.
 */
export class SlackApi {

    private readonly _userNames = new Map<string, string>();

    constructor(private readonly token: string) {
    }

    /*
     Resolves a slack user id to something a human recognises. Cached, since the same few people act
     repeatedly.
     */
    public async getUserName(userId: string): Promise<string> {
        if (!userId) {
            return null;
        }
        if (this._userNames.has(userId)) {
            return this._userNames.get(userId);
        }
        const name = await this.lookUpUserName(userId);
        if (name) {
            this._userNames.set(userId, name);
        }
        return name;
    }

    /*
     Returns the scopes the token was actually granted, or null when they cannot be determined.
     */
    public async getGrantedScopes(): Promise<string[]> {
        try {
            return await this.requestGrantedScopes();
        } catch {
            // no answer means the scopes are unknown, not that any are missing - the caller stays
            // quiet rather than warning about scopes that may well be there
            return null;
        }
    }

    public async postMessage(
        channel: string,
        text: string,
        threadTs?: SlackTimestamp): Promise<ISlackMessageRef> {
        const body: any = {
            channel,
            text,
            unfurl_links: false
        };
        if (threadTs) {
            body.thread_ts = threadTs;
        }
        return await this.send("chat.postMessage", body);
    }

    public async updateMessage(
        channel: string,
        ts: SlackTimestamp,
        text: string): Promise<ISlackMessageRef> {
        return await this.send(
            "chat.update",
            {
                channel,
                ts,
                text,
                unfurl_links: false
            });
    }

    public async deleteMessage(channel: string, ts: SlackTimestamp): Promise<void> {
        try {
            await this.request("chat.delete", { channel, ts });
        } catch (err) {
            // barky deletes its own superseded alerts - one that will not go is left where it is
            // rather than failing the alert that replaces it
            log(`slack would not delete the message ${ channel }:${ ts }: ${ describeError(err) }`, err);
        }
    }

    public async addReaction(
        channel: string,
        ts: SlackTimestamp,
        reaction: string): Promise<void> {
        await tryExecuteTimes(
            `reacting to slack message with ${ reaction }`,
            3,
            async () => {
                await this.request(
                    "reactions.add",
                    {
                        name: reaction,
                        channel,
                        timestamp: ts
                    });
            },
            false);
    }

    private async lookUpUserName(userId: string): Promise<string> {
        try {
            return await this.requestUserName(userId);
        } catch {
            // the lookup needs users:read, which is optional - the caller falls back to the id
            return null;
        }
    }

    private async requestUserName(userId: string): Promise<string> {
        const result = await axios.request({
            method: "get",
            url: `${ SlackApiBaseUrl }/users.info`,
            timeout: RequestTimeoutMs,
            params: { user: userId },
            headers: this.authorizationHeader()
        });
        return result.data?.ok ? displayNameOf(result.data.user) : null;
    }

    // slack reports the granted scopes in a response header rather than the body
    private async requestGrantedScopes(): Promise<string[]> {
        const result = await axios.request({
            method: "post",
            url: `${ SlackApiBaseUrl }/auth.test`,
            timeout: RequestTimeoutMs,
            headers: {
                ...this.authorizationHeader(),
                "Content-type": "application/json;charset=utf-8"
            },
            data: "{}"
        });
        if (!result.data?.ok) {
            return null;
        }
        return (result.headers?.["x-oauth-scopes"] ?? "")
            .split(",")
            .map(x => x.trim())
            .filter(x => !!x);
    }

    private async send(method: string, body: any): Promise<ISlackMessageRef> {
        return await tryExecuteTimes(
            // named, because "posting to slack" on its own leaves an operator with no idea which
            // call to which channel it was that would not go
            `posting to slack (${ method } to ${ body?.channel })`,
            3,
            async () => {
                const result = await this.request(method, body);
                if (result?.error) {
                    throw new SlackApiError(result.error);
                }
                return {
                    channel: result.channel,
                    ts: result.ts
                };
            },
            true,
            500,
            isPermanentSlackError);
    }

    private async request(method: string, body: any): Promise<any> {
        const result = await axios.request({
            method: "post",
            url: `${ SlackApiBaseUrl }/${ method }`,
            timeout: RequestTimeoutMs,
            headers: {
                ...this.authorizationHeader(),
                "Content-type": "application/json;charset=utf-8",
                "Accept": "*/*"
            },
            data: JSON.stringify(body)
        });
        return result.data;
    }

    private authorizationHeader(): Record<string, string> {
        return { "Authorization": `Bearer ${ this.token }` };
    }
}

// slack populates whichever of these the workspace and the person have filled in
function displayNameOf(user: any): string {
    return user?.profile?.display_name
        || user?.profile?.real_name
        || user?.real_name
        || user?.name
        || null;
}
