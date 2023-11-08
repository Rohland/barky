import { Result, SkippedResult } from "../models/result";
import { getLogs, getSnapshots, mutateAndPersistSnapshotState } from "../models/db";
import { MonitorLog } from "../models/log";
import { Snapshot } from "../models/snapshot";
import { executeAlerts } from "./alerter";
import { ChannelConfig } from "../models/channels/base";
import { AlertRule, AlertRuleType } from "../models/alert_configuration";
import { DigestConfiguration } from "../models/digest";
import { findMatchingKeyFor } from "../lib/key";
import { emitResults } from "../result-emitter";

export async function digest(
    config: DigestConfiguration,
    results: Result[]) {
    const context = await generateDigest(results);
    if (context.state === DigestState.OK) {
        return;
    }
    await executeAlerts(
        config,
        context);
}

export async function generateDigest(results: Result[]): Promise<DigestContext> {
    const [snapshots, logs] = await Promise.all([getSnapshots(), getLogs()]);
    const resultsToEvaluate = generateResultsToEvaluate(results, snapshots);
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
    const inferred = [];
    snapshots.forEach(snapshot => {
        const matchedResult = findMatchingKeyFor(snapshot, results);
        if (matchedResult) {
            return;
        }
        const ok = generateInferredOKResultFor(snapshot);
        results.push(ok);
        inferred.push(ok);
    });
    emitResults(inferred);
    return results;
}

function generateInferredOKResultFor(snapshot: Snapshot) {
    const inferred = new Result(
        new Date(),
        snapshot.type,
        snapshot.label,
        snapshot.identifier,
        "inferred",
        "OK",
        0,
        true,
        {
            alert: snapshot.alert
        }
    );
    return inferred;
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
        const previousCount = Array.from(this._previousSnapshotLookup.values()).filter(x => x.isDigestable).length;
        const newCount = this.snapshots.filter(x => x.isDigestable).length;
        const wasInOKState = previousCount === 0;
        const hasIssues = newCount > 0;
        if (wasInOKState) {
            if (hasIssues) {
                return DigestState.OutageTriggered;
            } else {
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

    get digestableSnapshots(): Snapshot[] {
        return this._snapshots.filter(x => x.isDigestable);
    }

    public getAlertableSnapshotsForChannel(
        config: DigestConfiguration,
        channel: ChannelConfig) {
        return this.alertableSnapshots(config)
            .filter(x => x.alert?.channels?.some(c => channel.isMatchFor(c)));
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
        if (result instanceof SkippedResult) {
            this.tryFindAndAddExistingSnapshotForSkippedResult(result);
            return;
        }
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

    private tryFindAndAddExistingSnapshotForSkippedResult(result: SkippedResult) {
        const found = findMatchingKeyFor(result, Array.from(this._previousSnapshotLookup.values()));
        if (!found) {
            return;
        }
        this.snapshots.push(found);
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

    public alertableSnapshots(config: DigestConfiguration): Snapshot[] {
        return this.digestableSnapshots
            .filter(x => !config.muteWindows.some(m => m.isMuted(x.uniqueId)));
    }
}

export function evaluateNewResult(
    result: Result,
    context: DigestContext) {
    const previousLogs = context.getLogsFor(result.uniqueId);
    const rule = result.findFirstValidRule();
    if (rule.isNotValidNow) {
        result.clearAlert();
    }
    if (result instanceof SkippedResult) {
        context.addSnapshotForResult(result);
        return;
    }
    if (result.success) {
        evaluateNewSuccessResult(
            result,
            rule,
            previousLogs,
            context);
    } else {
        evaluateNewFailureResult(
            result,
            rule,
            previousLogs,
            context);
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
                result.clearAlert();
            }
            const logCountToClear = rule.getLogCountToClear(previousLogs.length);
            context.deleteLogs(previousLogs.slice(0, logCountToClear));
            result.date = earliestDateFor(previousLogs, result.date);
            context.addSnapshotForResult(result);
            break;
        default:
            throw new Error(`Unhandled rule type: ${ rule.type }`);
    }
}

function earliestDateFor(previousLogs: MonitorLog[], date: Date) {
    if (!previousLogs || previousLogs.length === 0) {
        return date;
    }
    return previousLogs.reduce((prev, curr) => {
        return prev.date < curr.date ? prev : curr;
    }, previousLogs[0]).date;
}


function evaluateNewSuccessResult(
    result: Result,
    rule: AlertRule,
    previousLogs: MonitorLog[],
    context: DigestContext) {
    switch (rule.type) {
        case AlertRuleType.AnyInWindow:
            evaluateWindowForSuccess(result, rule, previousLogs, context);
            break;
        case AlertRuleType.ConsecutiveCount:
            context.deleteLogs(previousLogs);
            break;
        default:
            throw new Error(`Unhandled rule type: ${ rule.type }`);
    }
}

function evaluateWindowForSuccess(
    result: Result,
    rule: AlertRule,
    previousLogs: MonitorLog[],
    context: DigestContext) {
    context.deleteLogs(previousLogs.filter(x => x.date < rule.fromDate));
    const shouldRetainSnapshot = rule.isFailureInWindowGivenLogs(previousLogs);
    if (shouldRetainSnapshot) {
        context.addSnapshotForResult(result);
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
        result.clearAlert();
    }
    context.addSnapshotForResult(result);
}
