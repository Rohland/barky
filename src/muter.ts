import { singleton } from "./lib/singleton";
import { IDigestConfig } from "./models/digest";
import { addMuteWindow, deleteMuteWindowsByIds, getMuteWindows } from "./models/db";
import { IMuteWindowDb } from "./models/mute-window";

export class Muter {

    private _config: IDigestConfig;

    constructor() {
    }

    public async init(config: IDigestConfig) {
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

    public async registerMute(match: string, from: Date, to: Date) {
        await addMuteWindow({
            match,
            from,
            to
        });
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
    }

    public static getInstance() {
        return singleton(Muter.name, () => new Muter());
    }

    private splitDateRangeIntoArray(from: Date, to: Date): { date: string, startTime: string, endTime: string }[] {
        const formatDate = (dateObj: Date) => {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${ year }-${ month }-${ day }`;
        };

        const formatTime = (dateObj: Date) => {
            const hours = String(dateObj.getHours()).padStart(2, '0');
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            return `${ hours }:${ minutes }`;
        };

        const startDateStr = formatDate(from);
        const endDateStr = formatDate(to);

        let currentDate = new Date(from.getFullYear(), from.getMonth(), from.getDate());
        const lastDate = new Date(to.getFullYear(), to.getMonth(), to.getDate());
        const result = [];
        while (currentDate <= lastDate) {
            const currentDateStr = formatDate(currentDate);
            let startTime = "00:00";
            let endTime = "24:00";

            // For the first day, use the actual start time
            const isFirstDateInRange = currentDateStr === startDateStr;
            if (isFirstDateInRange) {
                startTime = formatTime(from);
            }
            const isLastDateInRange = currentDateStr === endDateStr;
            if (isLastDateInRange) {
                endTime = formatTime(to);
            }

            result.push({ date: currentDateStr, startTime, endTime });
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return result;
    }

}
