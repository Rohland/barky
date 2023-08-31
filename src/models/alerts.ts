import { Snapshot } from "./snapshot";
import { explodeUniqueKey, IUniqueKey } from "../lib/key";
import { toLocalTimeString } from "../lib/utility";
import { MuteWindow } from "./mute-window";
import { humanizeDuration } from "../lib/time";
import { AlertConfiguration } from "./alert_configuration";

export interface ILastFailureSnapshot {
    date: Date;
    result: string;
    alert: AlertConfiguration;
}

export class AlertState {
    public channel: string;
    public start_date: Date;
    public last_alert_date: Date;
    public affected: Map<string, ILastFailureSnapshot> = new Map<string, ILastFailureSnapshot>();
    public state?: any;
    private _resolved: boolean;
    private _previousSnapshots: Map<string, Snapshot> = new Map<string, Snapshot>();

    constructor(data: any) {
        for(const key in data) {
            if (key.indexOf("date")> -1){
                this[key] = new Date(data[key]);
            } else if (key === "affected") {
                const json = data[key];
                const map = json ? new Map<string, any>(JSON.parse(json)) : new Map<string, any>();
                for (const [key, value] of map) {
                    this.affected.set(key, {
                        date: new Date(value.date),
                        result: value.result,
                        alert: value.alert ? new AlertConfiguration(value.alert) : null
                    });
                }
            } else if (key === "state") {
                this.state = JSON.parse(data[key] ?? "null");
            } else {
                this[key] = data[key];
            }
        }
    }

    public static New(channel: string): AlertState {
        return new AlertState({
            channel,
            start_date: new Date(),
            last_alert_date: null
        });
    }

    public get startTime() {
        return toLocalTimeString(this.start_date);
    }

    public get endTime() {
        return this.isResolved ? toLocalTimeString(new Date()) : null;
    }

    public get durationMinutes() {
            return Math.floor((new Date().valueOf() - this.start_date.valueOf()) / 1000 / 60);
    }

    public get durationHuman() {
        const minutes = this.durationMinutes;
        return humanizeDuration(minutes);
    }

    public get isResolved() {
        return this._resolved;
    }

    public get affectedKeys(): string[] {
        return Array.from(this.affected.keys());
    }

    public resolve() {
        this._resolved = true;
    }

    track(snapshots: Snapshot[]) {
        snapshots.forEach(snapshot => {
            this.affected.set(snapshot.uniqueId, {
                date: snapshot.date,
                result: snapshot.last_result,
                alert: snapshot.alert
            });
        })
    }

    public getResolvedSnapshotList(currentIssueIds: string[]): { key: IUniqueKey, lastSnapshot: ILastFailureSnapshot}[] {
        const all = this.affectedKeys;
        const keys = all.filter(x => !currentIssueIds.includes(x));
        return keys.map(x => {
           return {
               key: explodeUniqueKey(x),
               lastSnapshot: this.affected.get(x)
           }
        });
    }

    removeMuted(muteWindows: MuteWindow[]) {
        const keys = Array.from(this.affected.keys());
        const muted = keys.filter(x => muteWindows.some(y => y.isMuted(x)));
        muted.forEach(x => this.affected.delete(x));
    }

    setPreviousSnapshots(previous: Snapshot[]) {
        this._previousSnapshots = new Map<string, Snapshot>();
        previous.forEach(x => this._previousSnapshots.set(x.uniqueId, x));
    }
}
