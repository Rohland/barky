import { DigestContext } from "./digest.js";
import { getAlerts, persistAlerts } from "../models/db.js";
import { AlertState } from "../models/alerts.js";
import { flatten } from "../lib/utility.js";
import { Snapshot } from "../models/snapshot.js";
import { DigestConfiguration } from "../models/digest.js";
import { warn } from "../models/logger.js";
import { describeError } from "../lib/error.js";



export async function executeAlerts(
    config: DigestConfiguration,
    context: DigestContext) {
    const alertsFromLastRound = await getAlerts();
    setPreviousSnapshotContextForAlerts(alertsFromLastRound, context);
    const distinctChannels = getChannelsAffected(context.digestableSnapshots);
    const newAlerts = detectNewAlerts(alertsFromLastRound, distinctChannels);
    const existingAlerts = detectExistingAlerts(alertsFromLastRound, distinctChannels);
    const resolvedAlerts = detectResolvedAlerts(alertsFromLastRound, distinctChannels);
    tagResolvedSnapshots(context, config, [...newAlerts, ...existingAlerts, ...resolvedAlerts]);
    await triggerAlerts(
        config,
        context,
        newAlerts,
        existingAlerts,
        resolvedAlerts);
    await persistAlerts([
        ...newAlerts,
        ...existingAlerts.filter(x => !x.isResolved)]);
}

function tagResolvedSnapshots(
    context: DigestContext,
    config: DigestConfiguration,
    alertStates: AlertState[]) {
    const snapshots = context.alertableSnapshots(config).map(x => x.uniqueId);
    alertStates.forEach((alertState: AlertState) => {
       alertState.checkAndSetSnapshotsAsResolved(snapshots);
    });
}

/*
 One channel failing must not take the others with it, and must not take barky down with either.

 Before this, a slack refusal anywhere below rejected the whole digest: the run stopped short of
 persisting the alert state, and the process exited - so a restart re-alerted everything as new and
 met the same refusal again. Now the alerts that can be sent are sent, what changed is persisted,
 and the failure is reported for the next pass to try again.
 */
async function sendEach<T>(
    items: T[],
    describe: (item: T) => string,
    send: (item: T) => Promise<void>): Promise<void> {
    const outcomes = await Promise.allSettled(items.map(send));
    outcomes.forEach((outcome, index) => {
        if (outcome.status === "rejected") {
            // said out loud: an alert that did not reach its channel is the one thing an operator
            // has to hear about, and barky is the only thing that knows
            warn(
                `barky could not alert '${ describe(items[index]) }': ${ describeError(outcome.reason) }`,
                outcome.reason);
        }
    });
}

async function sendNewAlerts(
    newAlerts: AlertState[],
    config: DigestConfiguration,
    context: DigestContext) {
    await sendEach(newAlerts, x => x.channel, async alert => {
        const channel = config.getChannelConfig(alert.channel);
        if (!channel) {
            return;
        }
        const snapshots = context.getAlertableSnapshotsForChannel(config, channel);
        if (snapshots.length === 0) {
            return;
        }
        alert.start_date = earliestDateFor(snapshots);
        await channel.sendNewAlert(
            snapshots,
            alert);
        alert.last_alert_date = new Date();
        alert.track(snapshots);
    });
}

function earliestDateFor(snapshots: Snapshot[]): Date {
    if (!snapshots || snapshots.length === 0) {
        return new Date();
    }
    return snapshots.reduce((prev, curr) => {
        return prev.date < curr.date ? prev : curr;
    }, snapshots[0]).date;
}

async function sendOngoingAlerts(
    alerts: AlertState[],
    config: DigestConfiguration,
    context: DigestContext) {
    await sendEach(alerts, x => x.channel, async alert => {
        const channel = config.getChannelConfig(alert.channel);
        if (!channel) {
            return;
        }
        const snapshots = context.getAlertableSnapshotsForChannel(config, channel);
        if (snapshots.length === 0) {
            await sendMutedOrResolvedAlert(context, config, alert);
            return;
        }
        if (channel.canSendAlert(alert)) {
            await channel.sendOngoingAlert(snapshots, alert);
            alert.last_alert_date = new Date();
        } else {
            await channel.pingAboutOngoingAlert(snapshots, alert);
        }
        alert.track(snapshots);
    });
}

async function sendResolvedAlerts(
    alerts: AlertState[],
    config: DigestConfiguration) {
    await sendEach(alerts, x => x.channel, async alert => {
        alert.resolve();
        if (alert.size === 0) {
            return;
        }
        const channel = config.getChannelConfig(alert.channel);
        if (!channel) {
            return;
        }
        await channel.sendResolvedAlert(alert);
    });
}

async function sendMutedOrResolvedAlert(
    context: DigestContext,
    config: DigestConfiguration,
    alert: AlertState) {
    const channel = config.getChannelConfig(alert.channel);
    if (!channel) {
        return;
    }
    const currentButMutedIssues = context.digestableSnapshots.filter(x => x.muted);
    const resolved = alert.getResolvedOrMutedSnapshotList(currentButMutedIssues.map(x => x.uniqueId));
    if (resolved.length === 0) {
        alert.setMuted();
        await channel.sendMutedAlert(alert);
        return;
    }
    await sendResolvedAlerts([alert], config);
}

let _newAlerts: AlertState[] = [];
let _existingAlerts: AlertState[] = [];
let _resolvedAlerts: AlertState[] = [];
let _context: DigestContext = null;
let _config: DigestConfiguration = null;

export interface IAlertState {
    newAlerts: AlertState[],
    existingAlerts: AlertState[],
    resolvedAlerts: AlertState[],
    context: DigestContext,
    config: DigestConfiguration
}

export function getAlertState(): IAlertState {
    return {
        newAlerts: _newAlerts,
        existingAlerts: _existingAlerts,
        resolvedAlerts: _resolvedAlerts,
        context: _context,
        config: _config
    };
}

async function triggerAlerts(
    config: DigestConfiguration,
    context: DigestContext,
    newAlerts: AlertState[],
    existingAlerts: AlertState[],
    resolvedAlerts: AlertState[]) {
    await sendNewAlerts(newAlerts, config, context);
    await sendOngoingAlerts(existingAlerts, config, context);
    await sendResolvedAlerts(resolvedAlerts, config);
    _newAlerts = newAlerts;
    _existingAlerts = existingAlerts;
    _resolvedAlerts = resolvedAlerts;
    _context = context;
    _config = config;
}

function getChannelsAffected(snapshots: Snapshot[]): string [] {
    const channels: string [] =  flatten(snapshots.map(x => x.alert?.channels));
    return Array.from(new Map(channels.map(x => [x, true])).keys());
}

function detectNewAlerts(
    alerts: AlertState[],
    channels: string[]) {
    const missing = channels.filter(x => !alerts.some(y => y.channel === x));
    return missing.map(x => AlertState.New(x));
}

function detectExistingAlerts(
    alerts: AlertState[],
    channels: string[]) {
    const matched = alerts.filter(x => channels.some(y => y === x.channel));
    return matched;
}

function detectResolvedAlerts(
    alerts: AlertState[],
    channels: string[]) {
    const missing = alerts.filter(x => !channels.some(y => y === x.channel));
    return missing;
}

function setPreviousSnapshotContextForAlerts(alerts: AlertState[], context: DigestContext) {
    alerts.forEach(alert => {
        const previous = Array
            .from(alert.affectedKeys)
            .map(x => context.getLastSnapshotFor(x))
            .filter(x => !!x);
        alert.setPreviousSnapshots(previous);
    });
}
