import { parsePeriodToMinutes } from "../../lib/period-parser";
import { Snapshot } from "../snapshot";
import { AlertState } from "../alerts";
import { renderTemplate } from "../../lib/renderer";

export enum ChannelType {
    Console="console",
    Slack="slack",
    SMS="sms"
}

export interface IChannelTemplate {
    prefix: string;
    postfix: string;
    summary: string;
}

export abstract class ChannelConfig {
    public name: string;
    public type: ChannelType;
    private template: IChannelTemplate;
    public interval: string;
    public title: string;
    private notificationIntervalMinutes: number;

    protected constructor(name: string, data: any) {
        this.title = data?.title ?? "";
        this.name = name?.toLowerCase();
        this.template = data?.template ?? {};
        this.template.prefix ??= "";
        this.template.postfix ??= "";
        this.template.summary ??= "";
        this.interval = data?.interval ?? "15m";
        this.notificationIntervalMinutes = parsePeriodToMinutes(this.interval);
    }

    public isMatchFor(channelName: string): boolean {
        return channelName?.toLowerCase() === this.name;
    }

    public abstract sendNewAlert(snapshots: Snapshot[], alert: AlertState): Promise<void>;
    public abstract sendOngoingAlert(snapshots: Snapshot[], alert: AlertState): Promise<void>;
    public abstract sendResolvedAlert(alert: AlertState): Promise<void>;
    public abstract pingAboutOngoingAlert(snapshots: Snapshot[], alert: AlertState): Promise<void>;

    canSendAlert(alert: AlertState): boolean {
        if (!alert.last_alert_date) {
            return true;
        }
        return alert.last_alert_date.getTime() + (this.notificationIntervalMinutes * 60 * 1000) < Date.now();
    }

    get prefix(): string {
        return renderTemplate(this.template?.prefix, this);
    }

    get postfix(): string {
        return renderTemplate(this.template?.postfix, this);
    }

    get summary(): string {
        return renderTemplate(this.template?.summary, this);
    }
}
