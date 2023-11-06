import { Snapshot } from "../snapshot";
import { AlertState } from "../alerts";
import { pluraliseWithS } from "../../lib/utility";
import { ChannelConfig, ChannelType } from "./base";

export class ConsoleChannelConfig extends ChannelConfig {
    constructor(name: string, config: any) {
        super(name, config);
        this.type = ChannelType.Console;
    }

    sendNewAlert(snapshots: Snapshot[], alert: AlertState): Promise<void> {
        const message = `${ this.prefix } 🚨Outage started at ${ alert.startTime }. ${ snapshots.length } health ${ pluraliseWithS("check", snapshots.length) } affected. ${ this.postfix }`.trim();
        console.log(message);
        return Promise.resolve();
    }

    sendOngoingAlert(snapshots: Snapshot[], alert: AlertState): Promise<void> {
        const message = `${ this.prefix } 🔥Outage ongoing for ${ alert.durationHuman } (since ${ alert.startTime }). ${ snapshots.length } health ${ pluraliseWithS("check", snapshots.length) } affected. ${ this.postfix }`.trim();
        console.log(message);
        return Promise.resolve();
    }

    sendResolvedAlert(alert: AlertState): Promise<void> {
        const message = `${ this.prefix } ✅ Outage ended at ${ alert.endTime }. Duration was ${ alert.durationHuman }. ${ this.postfix }`.trim();
        console.log(message);
        return Promise.resolve();
    }

    sendMutedAlert(alert: AlertState): Promise<void> {
        const message = `${ this.prefix } 🔕 Alerts muted at ${ alert.endTime }. ${ this.postfix }`.trim();
        console.log(message);
        return Promise.resolve();
    }

    public async pingAboutOngoingAlert(
        _snapshots: Snapshot[],
        _alert: AlertState): Promise<void> {
        // no-op
        return Promise.resolve(undefined);
    }
}
