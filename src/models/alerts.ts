import { Snapshot } from "./snapshot";
import { explodeUniqueKey, IUniqueKey } from "../lib/key";
import { toLocalTimeString } from "../lib/utility";
import { MuteWindow } from "./mute-window";
import { humanizeDuration } from "../lib/time";
import { AlertConfiguration } from "./alert_configuration";

export interface ILastFailureSnapshot {
    resolvedDate?: Date;
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
    private _wasMuted: boolean;

    constructor(data: any) {
        for (const key in data) {
            if (key.indexOf("date") > -1) {
                this[key] = new Date(data[key]);
            } else if (key === "affected") {
                const json = data[key];
                const map = json ? new Map<string, any>(JSON.parse(json)) : new Map<string, any>();
                for (const [key, value] of map) {
                    this.affected.set(key, {
                        resolvedDate: value.resolvedDate ? new Date(value.resolvedDate) : value.resolvedDate,
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
        return this.isResolved || this.isMuted ? toLocalTimeString(new Date()) : null;
    }

    public get durationMinutes() {
        return (new Date().valueOf() - this.start_date.valueOf()) / 1000 / 60;
    }

    public get durationHuman() {
        const minutes = this.durationMinutes;
        return humanizeDuration(minutes);
    }

    public get isResolved() {
        return this._resolved;
    }

    public get isMuted() {
        return this._wasMuted;
    }

    public get size() {
        return this.affected.size;
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

    public getResolvedOrMutedSnapshotList(currentIssueIds: string[]): {
        key: IUniqueKey,
        lastSnapshot: ILastFailureSnapshot
    }[] {
        const all = this.affectedKeys;
        const keys = all.filter(x => !currentIssueIds.includes(x));
        return keys.map(x => {
            const lastSnapshot = this.affected.get(x);
            if (lastSnapshot) {
                lastSnapshot.resolvedDate ||= new Date();
            }
            return {
                key: explodeUniqueKey(x),
                lastSnapshot: lastSnapshot
            }
        });
    }

    removeMuted(muteWindows: MuteWindow[]) {
        const keys = Array.from(this.affected.keys());
        const muted = keys.filter(x => muteWindows.some(y => y.isMuted(x)));
        muted.forEach(x => this.affected.delete(x));
        const hadAlerts = keys.length > 0;
        const noAlertsNow = this.affected.size === 0;
        this._wasMuted = hadAlerts && noAlertsNow;
    }

    setPreviousSnapshots(previous: Snapshot[]) {
        this._previousSnapshots = new Map<string, Snapshot>();
        previous.forEach(x => this._previousSnapshots.set(x.uniqueId, x));
    }

    setMuted() {
        this._wasMuted = true;
    }
}
