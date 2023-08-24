import { IUniqueKey, uniqueKey } from "../lib/key";
import { AlertConfiguration, IAlertConfig } from "./alert_configuration";


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
        alertConfig: IAlertConfig) {
        this.resultMsg = Array.isArray(resultMsg) ? resultMsg.join(";") : resultMsg;
        this.timeTaken = timeTaken;
        this.alert = alertConfig ? new AlertConfiguration(alertConfig) : null;
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
        alert: IAlertConfig) {
        super(
            new Date(),
            type,
            "monitor",
            identifier,
            null,
            resultMsg,
            0,
            false,
            alert
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
        alert: IAlertConfig) {
        super(
            new Date(),
            "mysql",
            label,
            identifier,
            JSON.stringify(result),
            resultMsg?.length > 0 ? resultMsg : (success ? "OK" : "FAIL"),
            timeTaken,
            success,
            alert);
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
        alert: IAlertConfig) {
        super(
            new Date(),
            "sumo",
            label,
            identifier,
            JSON.stringify(result),
            resultMsg?.length > 0 ? resultMsg : (success ? "OK" : "FAIL"),
            timeTaken,
            success,
            alert);
    }
}

export class WebResult extends Result {
    constructor(
        date,
        label,
        identifier,
        success,
        result,
        resultMsg,
        timeTaken,
        alert: IAlertConfig) {
        super(
            date,
            "web",
            label,
            identifier,
            result,
            resultMsg,
            timeTaken,
            success,
            alert);
    }
}
