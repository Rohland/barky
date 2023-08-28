import { Snapshot } from "./snapshot";
import { explodeUniqueKey } from "../lib/key";
import { toLocalTimeString } from "../lib/utility";
import { MuteWindow } from "./mute-window";

export class AlertState {
    public channel: string;
    public start_date: Date;
    public last_alert_date: Date;
    public affectedUniqueIds: Set<string> = new Set();
    public state?: any;
    private _resolved: boolean;

    constructor(data: any) {
        for(const key in data) {
            if (key.indexOf("date")> -1){
                this[key] = new Date(data[key]);
            } else if (key === "affected") {
                const json = data[key];
                const ids = json ? JSON.parse(data[key]) : [];
                ids.forEach(x => this.affectedUniqueIds.add(x));
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

    public get isResolved() {
        return this._resolved;
    }

    public resolve() {
        this._resolved = true;
    }

    track(snapshots: Snapshot[]) {
        snapshots.forEach(x => this.affectedUniqueIds.add(x.uniqueId));
    }

    public get affectedSnapshotsList(): {type: string, label: string, identifier: string}[] {
        const items = Array.from(this.affectedUniqueIds);
        return items.map(explodeUniqueKey);
    }

    public getResolvedSnapshotList(uniqueIds: string[]) {
        const all = Array.from(this.affectedUniqueIds);
        return all.filter(x => !uniqueIds.includes(x)).map(explodeUniqueKey);
    }

    removeMuted(muteWindows: MuteWindow[]) {
        const affected = Array.from(this.affectedUniqueIds);
        const remaining = affected.filter(x => !muteWindows.some(y => y.isMuted(x)));
        this.affectedUniqueIds = new Set(remaining);
    }
}
