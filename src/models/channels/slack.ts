import { Snapshot } from "../snapshot";
import { AlertState } from "../alerts";
import { ChannelConfig, ChannelType } from "./base";
import axios from "axios";
import { pluraliseWithS, toLocalTimeString } from "../../lib/utility";

export class SlackChannelConfig extends ChannelConfig {
    public channel: string;
    public token: string;

    constructor(name: string, config: any) {
        super(name, config);
        this.type = ChannelType.Slack;
        this.channel = config.channel;
        this.token = process.env[config.token];
    }

    public generateMessage(snapshots: Snapshot[], alert: AlertState): string {
        const parts =  [];

        if (alert.isResolved){
            parts.push(`${ this.prefix } ✅ Outage Resolved!`);
        } else {
            parts.push(`${ this.prefix } 🔥 Ongoing Outage!`);
        }

        parts.push(`*Started at:* \`${ alert.startTime }\``);
        if (alert.durationMinutes > 0) {
            parts.push(`*Duration:* \`${ alert.durationHuman }\``);
        }
        parts.push("");
        if (snapshots.length > 0) {
            parts.push(`*🚨 ${ snapshots.length } failing ${ pluraliseWithS("check", snapshots.length)}:*`);
            snapshots.forEach(x => {
                parts.push(`    • ${ x.type }:${ x.label } → ${ x.identifier } (_${ x.last_result }_)`);
            });
            parts.push("");
        }
        const resolved = alert.getResolvedSnapshotList(snapshots.map(x => x.uniqueId));
        if (resolved.length > 0) {
            parts.push(`*☑️ ${ resolved.length } resolved ${ pluraliseWithS("check", resolved.length)}:*`);
            resolved.forEach(x => {
                parts.push(`    • ${ x.type }:${ x.label } → ${ x.identifier }`);
            });
            parts.push("");
        }
        parts.push(`_Last Updated: ${ toLocalTimeString(new Date()) }_`);
        parts.push(this.postfix);
        return parts.join("\n");
    }

    public async sendNewAlert(snapshots: Snapshot[], alert: AlertState): Promise<void> {
        alert.state = await this.postToSlack(
            this.generateMessage(snapshots, alert),
            alert.state);
    }

    public async sendOngoingAlert(snapshots: Snapshot[], alert: AlertState): Promise<void> {
        // send a brand-new message here
        alert.state = await this.postToSlack(
            this.generateMessage(snapshots, alert),
            null);
    }

    public async pingAboutOngoingAlert(
        snapshots: Snapshot[],
        alert: AlertState): Promise<void> {
        await this.postToSlack(
            this.generateMessage(snapshots, alert),
            alert.state);
    }

    public async sendResolvedAlert(alert: AlertState): Promise<void> {
        await this.postToSlack(
            this.generateMessage([], alert),
            alert.state);
        await this.postToSlack(
            `✅ <!channel> Previous outage resolved at ${ alert.endTime }. Duration was ${ alert.durationHuman }.\n_See above for more details about affected services._`,
        );
    }

    async postToSlack(message: string, state?: any): Promise<any> {
        const body = {
            channel: state?.channel ?? this.channel,
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: message
                }
            }],
            ts: state?.ts
        };
        const url = state
        ? "https://slack.com/api/chat.update"
            : "https://slack.com/api/chat.postMessage";
        const config = {
            method: 'post',
            url,
            headers: {
                'Authorization': `Bearer ${ this.token }`,
                'Content-type': 'application/json;charset=utf-8',
                'Accept': '*/*',
            },
            data: JSON.stringify(body)
        };
        try {
            const result = await axios.request(config);
            if (result.data?.error) {
               throw new Error(result.data.error);
            }
            return {
                channel: result.data.channel,
                ts: result.data.ts
            };
        } catch (err) {
            throw new Error(`Error posting to Slack: ${ err.message }`);
        }
    }
}
