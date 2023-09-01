import { IUniqueKey, uniqueKey } from "../lib/key";
import { AlertConfiguration } from "./alert_configuration";

export interface ISnapshot {
    id?: number;
    type: string;
    label: string;
    identifier: string;
    last_result: string;
    success: boolean;
    date: Date;
    alert_config: any;
}

export class Snapshot implements IUniqueKey {
    public readonly id?: number;
    public readonly type: string;
    public readonly label: string;
    public readonly identifier: string;
    public readonly last_result: string;
    public readonly success: Boolean;
    public readonly date: Date;
    public alert_config: any;
    public alert: AlertConfiguration;

    constructor(snapshot: ISnapshot) {
        for (const key of Object.keys(snapshot)) {
            if (key === "date") {
                this[key] = new Date(snapshot[key]);
            } else if (key === "success"){
                this[key] = !!snapshot[key];
            } else {
                this[key] = snapshot[key];
            }
        }
        if (!this.alert) {
            this.alert = this.alert_config
                ? new AlertConfiguration(this.alert_config)
                : null;
        }
    }

    get uniqueId(): string {
        return uniqueKey(this);
    }

    get isDigestable(): boolean {
        return this.alert?.channels?.length > 0;
    }
}
