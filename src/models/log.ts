import { IUniqueKey, uniqueKey } from "../lib/key";

export class MonitorLog implements IUniqueKey {
    id: number;
    date: Date;
    type: string;
    label: string;
    identifier: string;
    success: boolean;
    result_msg: string;
    constructor(row: any) {
        for(const key of Object.keys(row)) {
            if(key === "date") {
                this[key] = new Date(row[key]);
            } else {
                this[key] = row[key];
            }
        }
    }

    get uniqueId(): string {
        return uniqueKey(this);
    }
}
