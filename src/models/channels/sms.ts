import { Snapshot } from "../snapshot";
import { AlertState } from "../alerts";
import axios from "axios";
import { pluraliseWithS } from "../../lib/utility";
import { ChannelConfig, ChannelType } from "./base";
import FormData from "form-data";

export interface SMSContact {
    name: string;
    mobile: string;
}

export class SMSChannelConfig extends ChannelConfig {
    public contacts: SMSContact[];

    constructor(name: string, config: any) {
        super(name, config);
        this.type = ChannelType.SMS;
        this.contacts = config.contacts;
    }

    public async sendNewAlert(
        snapshots: Snapshot[],
        alert: AlertState): Promise<void> {
        const message = `${ this.prefix } Outage STARTED at ${ alert.startTime }.\n\n${ snapshots.length } health ${ pluraliseWithS("check", snapshots.length) } affected.\n\n${ this.postfix }`.trim();
        await this.sendSMSToAllContacts(message);
    }

    public async sendOngoingAlert(
        snapshots: Snapshot[],
        alert: AlertState): Promise<void> {
        const message = `${ this.prefix } Outage ONGOING for ${ alert.durationMinutes } ${ pluraliseWithS("minute", alert.durationMinutes)} (since ${ alert.startTime }).\n\n${ snapshots.length } health ${ pluraliseWithS("check", snapshots.length) } affected.\n\n${ this.postfix }`.trim();
        await this.sendSMSToAllContacts(message);
    }

    public async sendResolvedAlert(alert: AlertState): Promise<void> {
        const message = `${ this.prefix } Outage RESOLVED at ${ alert.endTime }. Duration was ${ alert.durationMinutes } ${ pluraliseWithS("minute", alert.durationMinutes)}.\n\n${ this.postfix }`.trim();
        await this.sendSMSToAllContacts(message);
    }

    public async pingAboutOngoingAlert(
        _snapshots: Snapshot[],
        _alert: AlertState): Promise<void> {
        // no-op
        return Promise.resolve(undefined);
    }

    private async sendSMSToAllContacts(message: string): Promise<void> {
        try {
            const data = new FormData();
            data.append('user', process.env["clickatell-user"]);
            data.append('password', process.env["clickatell-password"]);
            data.append('api_id', process.env["clickatell-key"]);
            data.append('to', this.contacts.map(x => x.mobile).join(","));
            data.append('text', message);
            const config = {
                method: 'post',
                url: 'https://api.clickatell.com/http/sendmsg',
                headers: {
                    ...data.getHeaders()
                },
                data: data
            };
            const result = await axios.request(config)
            if (result.status !== 200) {
                throw new Error(`Response code ${ result.status }}`);
            } else {
                const response = result.data ?? "";
                if (response.toLowerCase().match(/^ERR:/i)) {
                    throw new Error(`Error: ${ response }`);
                }
            }
        } catch(err) {
            throw new Error(`Failed to send SMS: ${ err.message }`);
        }
    }
}
