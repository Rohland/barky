import { IUniqueKey, uniqueKey } from "../lib/key";
import { AlertConfiguration } from "./alert_configuration";
import { IApp } from "./app";

export class Result implements IUniqueKey {
    public readonly resultMsg: string;
    public alert: AlertConfiguration;

    constructor(
        public date: Date,
        public type: string,
        public label: string,
        public identifier: string,
        public result: any,
        resultMsg: string | Array<string>,
        public timeTaken: number,
        public success: boolean,
        public app: IApp) {
        this.resultMsg = Array.isArray(resultMsg) ? resultMsg.join(";") : resultMsg;
        this.timeTaken = timeTaken;
        this.alert = app?.alert ? new AlertConfiguration(app.alert) : null;
    }

    get uniqueId(): string {
        return uniqueKey(this);
    }

    get isDigestable(): boolean {
        return this.alert?.channels?.length > 0;
    }

    toString() {
        return [
            this.date.toISOString(),
            this.type,
            this.label,
            this.identifier,
            this.success ? 1 : 0,
            this.resultMsg,
            this.result,
            this.timeTaken.toFixed(2)
        ].join("|");
    }
}

export class MonitorFailureResult extends Result {
    constructor(
        type,
        identifier,
        resultMsg,
        app: IApp = null) {
        super(
            new Date(),
            type,
            "monitor",
            identifier,
            "FAIL",
            resultMsg,
            0,
            false,
            app
        );
    }
}

export class MySqlResult extends Result {
    constructor(
        label,
        identifier,
        result,
        resultMsg,
        timeTaken,
        success,
        app: IApp) {
        super(
            new Date(),
            "mysql",
            label,
            identifier,
            JSON.stringify(result),
            resultMsg?.length > 0 ? resultMsg : (success ? "OK" : "FAIL"),
            timeTaken,
            success,
            app);
    }
}

export class SumoResult extends Result {
    constructor(
        label,
        identifier,
        result,
        resultMsg,
        timeTaken,
        success,
        app: IApp) {
        super(
            new Date(),
            "sumo",
            label,
            identifier,
            JSON.stringify(result),
            resultMsg?.length > 0 ? resultMsg : (success ? "OK" : "FAIL"),
            timeTaken,
            success,
            app);
    }
}

export class WebResult extends Result {
    constructor(
        date: Date,
        label,
        identifier,
        success,
        result,
        resultMsg,
        timeTaken,
        app: IApp) {
        super(
            date,
            "web",
            label,
            identifier,
            result,
            resultMsg,
            timeTaken,
            success,
            app);
    }
}

export class PingResult extends Result {
    constructor(
        date: Date,
        type: string,
        time: number,
        appCount: number
    ) {
        super(
            date,
            type,
            "monitor",
            "ping",
            appCount,
            `${ appCount} evaluated`,
            time,
            true,
            null
        );
    }
}

export class SkippedResult extends Result {
    constructor(date, type: string, label: string, identifer: string, app: IApp) {
        super(
            date,
            type,
            label,
            identifer,
            1,
            "Skipped",
            0,
            true,
            app
        );
    }
}
