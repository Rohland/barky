import { Snapshot } from "../snapshot";
import { AlertState } from "../alerts";
import { ChannelConfig, ChannelType } from "./base";
import axios from "axios";
import { pluraliseWithS, toLocalTimeString, tryExecuteTimes } from "../../lib/utility";
import { AlertConfiguration } from "../alert_configuration";
import * as os from "os";

export class SlackChannelConfig extends ChannelConfig {
    public channel: string;
    public token: string;
    public workspace: string;

    constructor(name: string, config: any) {
        super(name, config);
        this.type = ChannelType.Slack;
        this.channel = config.channel;
        this.token = process.env[config.token];
        this.workspace = config.workspace;
    }

    public generateMessage(
        snapshots: Snapshot[],
        alert: AlertState): string {
        const msg = this._generateFull(snapshots, alert);
        if (msg.length <= 3000) {
            return msg;
        }
        return this._generateSummary(snapshots, alert);
    }

    private _generateSummary(
        snapshots: Snapshot[],
        alert: AlertState) {
        const parts = this._generateHeader(alert);
        if (snapshots.length > 0) {
            parts.push(`*🚨 ${ snapshots.length } failing ${ pluraliseWithS("check", snapshots.length) }:*`);
            const types = snapshots.reduce((acc: Map<string, number>, x) => {
                const count = acc.get(x.type) ?? 0;
                acc.set(x.type, count + 1);
                return acc;
            }, new Map<string, number>());
            Array.from(types.keys()).forEach(type => {
                const count = types.get(type);
                parts.push(`    • ${ count } failing ${ type } ${ pluraliseWithS("check", count) }`);
            });
            parts.push("");
        }
        const resolvedOrMuted = alert.getResolvedOrMutedSnapshotList(snapshots.map(x => x.uniqueId));
        if (resolvedOrMuted.length > 0) {
            parts.push(`*☑️ ${ resolvedOrMuted.length } resolved ${ pluraliseWithS("check", resolvedOrMuted.length) }:*`);
            const types = resolvedOrMuted.reduce((acc: Map<string, number>, x) => {
                const count = acc.get(x.key.type) ?? 0;
                acc.set(x.key.type, count + 1);
                return acc;
            }, new Map<string, number>());
            Array.from(types.keys()).forEach(type => {
                const count = types.get(type);
                parts.push(`    • ${ count } resolved ${ type } ${ pluraliseWithS("check", count) }`);
            });
            parts.push("");
        }
        if (this.summary) {
            parts.push(this.summary);
            parts.push("");
        }
        this.tagWithLastUpdated(parts);
        parts.push(this.postfix);
        return parts.join("\n");
    }


    private tagWithLastUpdated(parts: any[]) {
        parts.push(`_Last Updated: *${ toLocalTimeString(new Date()) }* by ${ os.hostname() }_`);
    }

    private _generateHeader(alert: AlertState) {
        const parts = [];
        if (alert.isResolved) {
            parts.push(`${ this.prefix } ✅ Outage Resolved!`);
        } else if (alert.isMuted) {
            parts.push(`${ this.prefix } 🔕 Outage Muted!`);
        } else {
            parts.push(`${ this.prefix } 🔥 Ongoing Outage!`);
        }

        parts.push(`*Started at:* \`${ alert.startTime }\``);
        if (alert.durationMinutes > 0) {
            parts.push(`*Duration:* \`${ alert.durationHuman }\``);
        }
        parts.push("");
        return parts;
    }

    private _generateFull(
        snapshots: Snapshot[],
        alert: AlertState) {
        const parts = this._generateHeader(alert);
        if (snapshots.length > 0) {
            parts.push(`*🚨 ${ snapshots.length } failing ${ pluraliseWithS("check", snapshots.length) }:*`);
            snapshots.forEach(x => {
                parts.push(`    • ${ x.type }:${ x.label } → *${ x.identifier }* \`${ x.last_result }\` ${ this.generateLinks(x) }`);
            });
            parts.push("");
        }
        const resolvedOrMuted = alert.getResolvedOrMutedSnapshotList(snapshots.map(x => x.uniqueId));
        if (resolvedOrMuted.length > 0) {
            parts.push(`*☑️ ${ resolvedOrMuted.length } resolved/muted ${ pluraliseWithS("check", resolvedOrMuted.length) }:*`);
            resolvedOrMuted.forEach(x => {
                const time = x.lastSnapshot?.resolvedDate ? toLocalTimeString(x.lastSnapshot.resolvedDate, { noSeconds: true }) : null;
                const timeString = time ? `resolved at ${ time }, ` : "";
                const lastResult = x.lastSnapshot ? `(${ timeString } last failure: _${ x.lastSnapshot.result }_)` : "";
                parts.push(`    • ${ x.key.type }:${ x.key.label } → *${ x.key.identifier }* ${ lastResult } ${ this.generateLinks(x.lastSnapshot) }`);
            });
            parts.push("");
        }
        this.tagWithLastUpdated(parts);
        parts.push(this.postfix);
        return parts.join("\n");
    }

    private generateLinks(info: { alert?: AlertConfiguration }): string {
        const links = info?.alert?.links;
        if (!links || links.length === 0) {
            return "";
        }
        return "📙 " + links.map(x => `<${ x.url }|${ x.label }>`).join(" | ");
    }

    public async sendNewAlert(snapshots: Snapshot[], alert: AlertState): Promise<void> {
        alert.state = await this.postToSlack(
            this.generateMessage(snapshots, alert),
            alert.state);
    }

    public async sendOngoingAlert(
        snapshots: Snapshot[],
        alert: AlertState): Promise<void> {
        const timestamp = alert.state?.ts?.toString()?.replace('.', '');
        const channel = alert.state?.channel;
        const link = this.workspace && channel
            ? `<https://${ this.workspace }.slack.com/archives/${ channel }/p${ timestamp }|See above ☝️>`
            : "See above ☝️";
        const msg = `🔥 <!channel> Woof! Alert ongoing: \`${ snapshots.length } problems\` for \`${ alert.durationHuman }\`. ${ link }`;
        await this.postToSlack(
            msg,
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
        await Promise.all([
            this.postToSlack(
                this.generateMessage([], alert),
                alert.state),
            this.postToSlack(
                `✅ <!channel> Previous outage resolved at ${ alert.endTime }. Duration was ${ alert.durationHuman }.\n_See above for more details about affected services._`,
                alert.state,
                true
            ),
            this.reactToSlackMessage(alert.state, "white_check_mark")
        ]);
    }

    async sendMutedAlert(alert: AlertState): Promise<void> {
        await Promise.all([
            this.postToSlack(
                this.generateMessage([], alert),
                alert.state),
            this.postToSlack(
                `🔕 <!channel> Affected alerts were muted at ${ alert.endTime }.\n_See above for more details about affected services._`,
                alert.state,
                true
            ),
            this.reactToSlackMessage(alert.state, "no_bell")
        ]);
    }

    async postToSlack(
        message: string,
        state?: any,
        reply: boolean = false): Promise<any> {
        return await tryExecuteTimes(
            `posting to slack`,
            3,
            async () => {
                const body = {
                    channel: state?.channel ?? this.channel,
                    text: message,
                    unfurl_links: false
                };
                const postMessageUrl = "https://slack.com/api/chat.postMessage";
                const updateMessageUrl = "https://slack.com/api/chat.update";
                let url = postMessageUrl;
                if (reply && state?.ts) {
                    body["thread_ts"] = state.ts;
                } else {
                    body["ts"] = state?.ts;
                    if (state) {
                        url = updateMessageUrl;
                    }
                }
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
                const result = await axios.request(config);
                if (result.data?.error) {
                    throw new Error(result.data.error);
                }
                return {
                    channel: result.data.channel,
                    ts: result.data.ts
                };
            });
    }

    private async reactToSlackMessage(state: any, reaction: string) {
        if (!state) {
            return;
        }
        return await tryExecuteTimes(
            `reacting to slack message with ${ reaction }`,
            3,
            async () => {
                const body = {
                    name: reaction,
                    channel: state?.channel ?? this.channel,
                    timestamp: state.ts
                };
                const config = {
                    method: 'post',
                    url: "https://slack.com/api/reactions.add",
                    headers: {
                        'Authorization': `Bearer ${ this.token }`,
                        'Content-type': 'application/json;charset=utf-8',
                        'Accept': '*/*',
                    },
                    data: JSON.stringify(body)
                };
                await axios.request(config);
            },
            false);

    }
}
