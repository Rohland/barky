import { singleton } from "./lib/singleton.js";
import { IDigestConfig } from "./models/digest.js";
import { addMuteWindow, addMuteWindows, deleteMuteWindowsByIds, getMuteWindows } from "./models/db.js";
import { IMuteWindowDb } from "./models/mute-window.js";
import { addLocalDays, toLocalDateAndTime } from "./lib/utility.js";

export class Muter {

    private _config: IDigestConfig;

    constructor() {
    }

    public async init(config: IDigestConfig) {
        if (!config) {
            return;
        }
        this._config = config;
        this._config["mute-windows"] ??= [];
        await this.loadDynamicMutes();
    }

    public get muteWindows() {
        return this._config["mute-windows"];
    }

    public async loadDynamicMutes() {
        const windows = await this.getDynamicMutes();
        windows.forEach(window => this.addToConfig(window));
    }

    public async getDynamicMutes(): Promise<IMuteWindowDb[]> {
        return getMuteWindows();
    }

    public addToConfig(window: IMuteWindowDb) {
        const entry = this.splitDateRangeIntoArray(window.from, window.to);
        entry.forEach(item => {
            const muteWindow = {
                startTime: item.startTime,
                endTime: item.endTime,
                match: window.match,
                date: item.date,
                dynamic: true
            };
            this.muteWindows.push(muteWindow);
        });
    }

    public async registerMute(
        match: string,
        from: Date,
        to: Date) {
        await addMuteWindow({
            match,
            from,
            to
        });
    }

    /*
     Registers a set of mutes as one operation, so a failure part way through cannot leave some
     alerts silenced while the caller reports that nothing was changed.
     */
    public async registerMutes(
        matches: string[],
        from: Date,
        to: Date) {
        await addMuteWindows(matches.map(match => ({ match, from, to })));
    }

    public async unmute(matches: string[]) {
        const windows = await this.getDynamicMutes();
        const toDelete = [];
        windows.forEach(window => {
            if (matches.includes(window.match)) {
                toDelete.push(window.id);
            }
        });
        await deleteMuteWindowsByIds(toDelete);
        this._config["mute-windows"] = this.muteWindows.filter(m => !matches.includes(m.match));
    }

    public static getInstance() {
        return singleton(Muter.name, () => new Muter());
    }

    private splitDateRangeIntoArray(from: Date, to: Date): { date: string, startTime: string, endTime: string }[] {
        // dates and times are evaluated in the configured timezone when the window is applied,
        // so they must be captured in that timezone too - not the timezone of the host process
        const start = toLocalDateAndTime(from);
        const end = toLocalDateAndTime(to);
        const result = [];
        for (let date = start.date; date <= end.date; date = addLocalDays(date, 1)) {
            result.push({
                date,
                startTime: date === start.date ? start.time : "00:00",
                endTime: date === end.date ? end.time : "24:00"
            });
        }
        return result;
    }

}
