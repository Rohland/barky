import { getAlertState, IAlertState } from "../digest/alerter";
import { uniqueKey } from "../lib/key";
import { Snapshot } from "../models/snapshot";
import { ChannelType } from "../models/channels/base";
import { Muter } from "../muter";
import { IMuteWindowDb, MuteWindow } from "../models/mute-window";
import { sortBy } from "../lib/sort";

export interface IWebStateSummary {
    startTime: Date;
}

export interface IWebAlert {
    id: string;
    type: string;
    label: string;
    identifier: string;
    startTime: Date;
    resolvedTime: Date;
    muted: boolean;
    last_result: string;
    links: { label: string, url: string }[];
    dynamicMutes?: IMuteWindowDb[];
    mutedBy?: MuteWindow[];
    muteRules?: MuteWindow[];
}

export interface IWebState {
    summary: IWebStateSummary;
    active: IWebAlert[];
    muted: IWebAlert[];
    resolved: IWebAlert[];
}

export class WebState {

    private state: IAlertState;
    private activeSnapshots: Snapshot[];
    private muteLookup: Map<string, boolean>;

    constructor() {
    }

    private get noState() {
        return {
            summary: null,
            active: [],
            resolved: [],
            muted: []
        };
    }

    private getAlertState() {
        this.state = getAlertState();
        if (!this.state.context) {
            return;
        }
        const channelConfig = this.state.config.getChannelConfig(ChannelType.Web);
        this.activeSnapshots = this.state.context.getAlertableSnapshotsForChannel(this.state.config, channelConfig);
        this.muteLookup = new Map(this.activeSnapshots.map(x => [x.uniqueId, x.muted]));
    }

    private get activeAlerts() {
        return [...this.state.newAlerts, ...this.state.existingAlerts];
    }

    public async fetch(): Promise<IWebState> {
        this.getAlertState();
        if (!this.state?.context) {
            return this.noState;
        }
        const active = this.getActive();
        const resolvedCandidates = this.getResolved();
        const muted = this.getMuted(resolvedCandidates);
        const resolved = this.resolvedWithoutMuted(resolvedCandidates, muted);
        const all = [...active, ...muted, ...resolved];
        const oldestAlert = this.getOldestAlert(active, all);
        await this.decorateWithMuteRules(all);
        return {
            summary: oldestAlert
                ? {
                    startTime: oldestAlert.startTime
                }
                : null,
            active: sortBy(active, "startTime"),
            muted: sortBy(muted, "startTime"),
            resolved: sortBy(resolved, "startTime")
        };
    }

    private getOldestAlert(active: IWebAlert[], all: IWebAlert[]) {
        const oldestAlert = active.length > 0 && all.length > 0
            ? all.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0]
            : null;
        return oldestAlert;
    }

    private getMuted(resolvedSnapshots: IWebAlert[]): IWebAlert[] {
        const mutedSet = new Set();
        let muted = this
            .state
            .context
            .digestableSnapshots
            .filter(x => x.muted)
            .map(x => {
                if (mutedSet.has(x.uniqueId)) {
                    return null;
                }
                mutedSet.add(x.uniqueId);
                this.muteLookup.set(x.uniqueId, true);
                return {
                    id: x.uniqueId,
                    type: x.type,
                    label: x.label,
                    identifier: x.identifier,
                    startTime: x.date,
                    resolvedTime: null,
                    muted: true,
                    last_result: x.last_result,
                    links: x.alert?.links,
                    mutedBy: x.mutedBy,
                    muteRules: x.muteRules
                }
            });
        return [
            ...muted.filter(x => !!x),
            ...resolvedSnapshots.filter(x => x.muted)];
    }

    private getResolved(): IWebAlert[] {
        const resolvedOrMuted = this.activeAlerts.flatMap(x => x.getResolvedOrMutedSnapshotList(this.activeSnapshots.map(x => x.uniqueId)));
        const resolvedSet = new Set();
        const resolvedSnapshots = resolvedOrMuted.map(x => {
            const snapshot = x.lastSnapshot;
            const id = uniqueKey(x.key);
            if (resolvedSet.has(id)) {
                return null;
            }
            resolvedSet.add(id);
            return {
                id,
                type: x.key.type,
                label: x.key.label,
                identifier: x.key.identifier,
                startTime: snapshot.date,
                resolvedTime: snapshot.resolvedDate,
                last_result: snapshot.result,
                muted: this.muteLookup.get(id) ?? false,
                links: snapshot.alert?.links
            }
        }).filter(x => x);
        return resolvedSnapshots;
    }

    private getActive(): IWebAlert[] {
        const activeSet = new Set();
        const active = this.activeSnapshots.map(x => {
            if (activeSet.has(x.identifier)) {
                return null;
            }
            activeSet.add(x.identifier);
            return {
                id: x.uniqueId,
                type: x.type,
                label: x.label,
                identifier: x.identifier,
                startTime: x.date,
                resolvedTime: null,
                muted: false,
                last_result: x.last_result,
                links: x.alert?.links
            }
        });
        return active.filter(x => !!x);
    }

    private resolvedWithoutMuted(resolved: IWebAlert[], muted: IWebAlert[]) {
        const mutedKeys = new Set(muted.map(x => x.id));
        return resolved.filter(x => !x.muted && !mutedKeys.has(x.id));
    }

    private async decorateWithMuteRules(all: IWebAlert[]) {
        const windows = await Muter.getInstance().getDynamicMutes();
        all.forEach(x => {
            x.dynamicMutes = windows.filter(w => MuteWindow.isMatchForIdentifier(x.id, w.match));
        });
    }
}
