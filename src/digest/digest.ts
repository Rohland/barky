import { Result } from "../models/result";
import { getLogs, getSnapshots, mutateAndPersistSnapshotState } from "../models/db";
import { MonitorLog } from "../models/log";
import { Snapshot } from "../models/snapshot";
import { executeAlerts } from "./alerter";
import { ChannelConfig } from "../models/channels/base";
import { AlertRule, AlertRuleType } from "../models/alert_configuration";

export async function digest(
    channelConfigs: ChannelConfig[],
    results: Result[]) {
    const context = await generateDigest(results);
    if (context.state === DigestState.OK) {
        return;
    }
    await executeAlerts(channelConfigs, context);
}

export async function generateDigest(results: Result[]): Promise<DigestContext> {
    const digestableResults = results.filter(x => x.isDigestable);
    const [snapshots, logs] = await Promise.all([getSnapshots(), getLogs()]);
    const resultsToEvaluate = generateResultsToEvaluate(digestableResults, snapshots);
    const context = new DigestContext(
        snapshots,
        logs);
    resultsToEvaluate.forEach(x => evaluateNewResult(x, context));
    await mutateAndPersistSnapshotState(
        context.snapshots,
        context.logIdsToDelete
    );
    return context;
}

export function generateResultsToEvaluate(
    results: Result[],
    snapshots: Snapshot[]): Result[] {
    const resultLookup = new Map(results.map(x => [x.uniqueId, x]));
    snapshots.forEach(snapshot => {
        const matchedResult = resultLookup.get(snapshot.uniqueId);
        if (matchedResult) {
            return;
        }
        results.push(new Result(
            new Date(),
            snapshot.type,
            snapshot.label,
            snapshot.identifier,
            true,
            "OK (inferred)",
            0,
            true,
            {
                alert: snapshot.alert
            }
        ));
    });
    return results;
}

export enum DigestState {
    OK,
    OutageOngoing,
    OutageTriggered,
    OutageResolved
}

export class DigestContext {

    private _snapshots: Snapshot[] = [];
    private _idsToDelete: number[] = [];
    private _previousSnapshotLookup: Map<string, Snapshot>;
    private _logMap: Map<string, MonitorLog[]>;

    constructor(
        previousSnapshots: Snapshot[],
        logs: MonitorLog[]) {
        this._previousSnapshotLookup = new Map(previousSnapshots.map(x => [x.uniqueId, x]));
        this._logMap = this.generateLogLookup(logs);
    }

    public get state(): DigestState {
        const previousCount = this._previousSnapshotLookup.size;
        const newCount = this.snapshots.length;
        const wasInOKState = previousCount === 0;
        const hasIssues = newCount > 0;
        if (wasInOKState) {
            if (hasIssues) {
                return DigestState.OutageTriggered;
            } else{
                return DigestState.OK;
            }
        } else {
            if (hasIssues) {
                return DigestState.OutageOngoing;
            } else {
                return DigestState.OutageResolved;
            }
        }
    }

    get logIdsToDelete(): number[] {
        return this._idsToDelete;
    }

    get snapshots(): Snapshot[] {
        return this._snapshots;
    }

    public getSnapshotsForChannel(channel: ChannelConfig) {
        return this.snapshots.filter(x => x.alert.channels.some(c => channel.isMatchFor(c)));
    }

    public getLastSnapshotFor(uniqueId: string) {
        return this._previousSnapshotLookup.get(uniqueId);
    }

    public deleteLogs(logs: MonitorLog[]) {
        if ((logs ?? []).length === 0) {
            return;
        }
        this._idsToDelete.push(...logs.map(x => x.id));
    }

    public addSnapshotForResult(result: Result) {
        const data = {
            type: result.type,
            label: result.label,
            identifier: result.identifier,
            last_result: result.resultMsg,
            success: result.success,
            date: result.date,
            alert: result.alert,
            alert_config: result.alert?.getConfig()
        };
        const existingSnapshot = this.getLastSnapshotFor(result.uniqueId);
        if (result.success) {
            if (!existingSnapshot) {
                return;
            }
            data.last_result = existingSnapshot.last_result;
            data.success = existingSnapshot.success.valueOf();
            data.date = existingSnapshot.date;
        } else {
            data.date = existingSnapshot?.date ?? data.date;
        }
        this.snapshots.push(new Snapshot(data));
    }

    private generateLogLookup(logs: MonitorLog[]): Map<string, MonitorLog[]> {
        const map = new Map<string, MonitorLog[]>();
        logs.forEach(x => {
            const existing = map.get(x.uniqueId);
            if (existing) {
                existing.push(x);
            } else {
                map.set(x.uniqueId, [x]);
            }
        });
        return map;
    }

    public getLogsFor(uniqueId: string) {
        return this._logMap.get(uniqueId) ?? [];
    }
}

export function evaluateNewResult(
    result: Result,
    context: DigestContext) {
    const previousLogs = context.getLogsFor(result.uniqueId);
    const rule = result.alert.findFirstValidRule();
    if (!rule) {
        context.deleteLogs(previousLogs);
        return;
    }
    if (result.success) {
        evaluateNewSuccessResult(result, rule, previousLogs, context);
    } else {
        evaluateNewFailureResult(result, rule, previousLogs, context);
    }
}

function evaluateNewFailureResult(
    result: Result,
    rule: AlertRule,
    previousLogs: MonitorLog[],
    context: DigestContext) {
    switch (rule.type) {
        case AlertRuleType.AnyInWindow:
            evaluateWindowForFailure(
                result,
                rule,
                previousLogs,
                context);
            break;
        case AlertRuleType.ConsecutiveCount:
            if (!rule.isFailureForConsecutiveCount(previousLogs)) {
                return;
            }
            if (previousLogs.length > rule.count) {
                const logsToDelete = previousLogs.length - rule.count;
                context.deleteLogs(previousLogs.slice(0, logsToDelete));
            }
            context.addSnapshotForResult(result);
            break;
        default:
            throw new Error(`Unhandled rule type: ${ rule.type }`);
    }
}

function evaluateNewSuccessResult(
    result: Result,
    rule: AlertRule,
    previousLogs: MonitorLog[],
    context: DigestContext) {
    switch (rule.type) {
        case AlertRuleType.AnyInWindow:
            evaluateWindowForFailure(
                result,
                rule,
                previousLogs,
                context);
            break;
        case AlertRuleType.ConsecutiveCount:
            context.deleteLogs(previousLogs);
            break;
        default:
            throw new Error(`Unhandled rule type: ${ rule.type }`);
    }
}

function evaluateWindowForFailure(
    result: Result,
    rule: AlertRule,
    previousLogs: MonitorLog[],
    context: DigestContext) {
    context.deleteLogs(previousLogs.filter(x => x.date < rule.fromDate));
    const fail = rule.isFailureInWindowGivenLogs(previousLogs);
    if (!fail) {
        return;
    }
    context.addSnapshotForResult(result);
}
