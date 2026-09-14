import { Snapshot } from "../snapshot.js";
import { AlertState } from "../alerts.js";
import { ChannelConfig, ChannelType } from "./base.js";
import { pluraliseWithS, toLocalTimeString } from "../../lib/utility.js";
import { AlertConfiguration } from "../alert_configuration.js";
import * as os from "os";
import { getEnvVar } from "../../lib/env.js";
import { SlackApi, SlackMaxMessageLength } from "./slack-api.js";
import { recordChatThread } from "../db.js";

export class SlackChannelConfig extends ChannelConfig {
    public channel: string;
    public token: string;
    public workspace: string;
    public chatOpsEnabled: boolean;
    private _api: SlackApi;

    constructor(name: string, config: any) {
        super(name, config);
        this.type = ChannelType.Slack;
        this.channel = config.channel;
        this.token = getEnvVar(config.token);
        this.workspace = config.workspace;
        this.chatOpsEnabled = !!config["chat-ops"]?.enabled;
    }

    public get api(): SlackApi {
        return this._api ??= new SlackApi(this.token);
    }

    public generateMessage(
        snapshots: Snapshot[],
        alert: AlertState): string {
        const msg = this._generateFull(snapshots, alert);
        if (msg.length <= SlackMaxMessageLength) {
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
        await this.trackThreadFor(alert.state, snapshots);
    }

    /*
     Notes which alerts this message is reporting, so chat ops can resolve a reply in its thread
     back to them ("mute this"). Refreshed on every update, so the thread always reflects what the
     message currently says.
     */
    private async trackThreadFor(state: any, snapshots: Snapshot[]) {
        if (!state?.ts || !this.chatOpsEnabled) {
            return;
        }
        await recordChatThread({
            channel: state.channel ?? this.channel,
            threadTs: state.ts.toString(),
            alertIds: snapshots.map(x => x.uniqueId)
        });
    }

    public async sendOngoingAlert(
        snapshots: Snapshot[],
        alert: AlertState): Promise<void> {
        const timestamp = alert.state?.ts?.toString()?.replace('.', '');
        const channel = alert.state?.channel;
        const link = this.workspace && channel
            ? `<https://${ this.workspace }.slack.com/archives/${ channel }/p${ timestamp }|See above ☝️>`
            : "See above ☝️";
        const problems = pluraliseWithS("problem", snapshots.length);
        // this message is replaced on every interval, so replies to it would be lost - with chat
        // ops running there is somewhere useful to point people instead
        const replyHint = this.chatOpsEnabled
            ? "_reply in the thread above to mute_"
            : "_please do not reply to this msg_";
        const msg = `🔥 <!channel> Alert ongoing: \`${ snapshots.length } ${ problems }\` for \`${ alert.durationHuman }\`. ${ link } \n${ replyHint }`;
        await Promise.all([
            this.pingAboutOngoingAlert(snapshots, alert),
            this.replaceLastMessageAboutOngoingAlert(
                msg,
                alert)
        ]);
    }

    public async replaceLastMessageAboutOngoingAlert(msg: string, alert: AlertState) {
        const result = await this.postToSlack(
            msg,
            null);
        if (alert?.state?.ongoing) {
            const { channel, ts } = alert.state.ongoing;
            await this.deleteMessage(channel, ts);
        }
        if (alert?.state) {
            alert.state.ongoing = result;
        }
    }

    public async deleteMessage(channel: string, ts: number) {
        await this.api.deleteMessage(channel, ts);
    }

    public async pingAboutOngoingAlert(
        snapshots: Snapshot[],
        alert: AlertState): Promise<void> {
        await this.postToSlack(
            this.generateMessage(snapshots, alert),
            alert.state);
        await this.trackThreadFor(alert.state, snapshots);
    }

    public async sendResolvedAlert(alert: AlertState): Promise<void> {
        // intentionally not run in parallel with the other calls, as it seems sometimes slack has a wobbly
        // and doesn't update the message - experimenting with updating the message first, then reacting and replying
        await this.postToSlack(
            this.generateMessage([], alert),
            alert.state);
        await Promise.all([
            this.postToSlack(
                `✅ <!channel> Previous outage resolved at ${ alert.endTime }. Duration was ${ alert.durationHuman }.\n_See above for more details about affected services._`,
                alert.state,
                true
            ),
            this.reactToSlackMessage(alert.state, "white_check_mark"),
            this.deleteOngoingAlert(alert)
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
            this.reactToSlackMessage(alert.state, "no_bell"),
            this.deleteOngoingAlert(alert)
        ]);
    }

    private async deleteOngoingAlert(alert: AlertState) {
        if (!alert.state?.ongoing) {
            return;
        }
        const { channel, ts } = alert.state.ongoing;
        await this.deleteMessage(channel, ts);
    }

    async postToSlack(
        message: string,
        state?: { channel: string, ts: number },
        reply: boolean = false): Promise<any> {
        const channel = state?.channel ?? this.channel;
        const isReply = reply && !!state?.ts;
        if (isReply) {
            return await this.api.postMessage(channel, message, state.ts);
        }
        if (state) {
            return await this.api.updateMessage(channel, state.ts, message);
        }
        return await this.api.postMessage(channel, message);
    }

    private async reactToSlackMessage(state: any, reaction: string) {
        if (!state) {
            return;
        }
        await this.api.addReaction(
            state?.channel ?? this.channel,
            state.ts,
            reaction);
    }
}
