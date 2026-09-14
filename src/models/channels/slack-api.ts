import axios from "axios";
import { tryExecuteTimes } from "../../lib/utility.js";

export type SlackTimestamp = string | number;

export interface ISlackMessageRef {
    channel: string;
    ts: SlackTimestamp;
}

const SlackApiBaseUrl = "https://slack.com/api";
const RequestTimeoutMs = 5000;

/*
 A thin wrapper over the Slack web API, holding the auth, retry and error handling shared by the
 alerting channel and chat ops.
 */
export class SlackApi {

    constructor(private readonly token: string) {
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
        } catch {
            // no-op
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

    private async send(method: string, body: any): Promise<ISlackMessageRef> {
        return await tryExecuteTimes(
            `posting to slack`,
            3,
            async () => {
                const result = await this.request(method, body);
                if (result?.error) {
                    throw new Error(result.error);
                }
                return {
                    channel: result.channel,
                    ts: result.ts
                };
            });
    }

    private async request(method: string, body: any): Promise<any> {
        const result = await axios.request({
            method: 'post',
            url: `${ SlackApiBaseUrl }/${ method }`,
            timeout: RequestTimeoutMs,
            headers: {
                'Authorization': `Bearer ${ this.token }`,
                'Content-type': 'application/json;charset=utf-8',
                'Accept': '*/*',
            },
            data: JSON.stringify(body)
        });
        return result.data;
    }
}
