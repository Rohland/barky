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
}

export abstract class ChannelConfig {
    public name: string;
    public type: ChannelType;
    private template: IChannelTemplate;
    public notification_interval: string;
    public title: string;
    private notification_window_minutes: number;

    protected constructor(name: string, data: any) {
        this.title = data?.title ?? "";
        this.name = name?.toLowerCase();
        this.template = data.template ?? {};
        this.template.prefix ??= "";
        this.template.postfix ??= "";
        this.notification_interval = data.notification_interval ?? "15m";
        this.notification_window_minutes = parsePeriodToMinutes(this.notification_interval);
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
        return alert.last_alert_date.getTime() + (this.notification_window_minutes * 60 * 1000) < Date.now();
    }

    get prefix(): string {
        return renderTemplate(this.template?.prefix, this);
    }

    get postfix(): string {
        return renderTemplate(this.template?.postfix, this);
    }


}
