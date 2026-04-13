import { Snapshot } from "../snapshot.js";
import { AlertState } from "../alerts.js";
import { ChannelConfig, ChannelType } from "./base.js";

export class WebChannelConfig extends ChannelConfig {
    constructor(name: string, config: any) {
        super(name, config);
        this.type = ChannelType.Web ;
    }

    sendNewAlert(_snapshots: Snapshot[], _alert: AlertState): Promise<void> {
        // no-op
        return Promise.resolve();
    }

    sendOngoingAlert(_snapshots: Snapshot[], _alert: AlertState): Promise<void> {
        // no-op
        return Promise.resolve();
    }

    sendResolvedAlert(_alert: AlertState): Promise<void> {
        // no-op
        return Promise.resolve();
    }

    sendMutedAlert(_alert: AlertState): Promise<void> {
        // no-op
        return Promise.resolve();
    }

    public async pingAboutOngoingAlert(
        _snapshots: Snapshot[],
        _alert: AlertState): Promise<void> {
        // no-op
        return Promise.resolve(undefined);
    }
}
