import { DigestContext } from "./digest";
import { getAlerts, persistAlerts } from "../models/db";
import { AlertState } from "../models/alerts";
import { flatten } from "../lib/utility";
import { Snapshot } from "../models/snapshot";
import { DigestConfiguration } from "../models/digest";

export async function executeAlerts(
    config: DigestConfiguration,
    context: DigestContext) {
    const alertsFromLastRound = await getAlerts();
    setPreviousSnapshotContextForAlerts(alertsFromLastRound, context);
    const distinctChannels = getChannelsAffected(context.digestableSnapshots);
    const newAlerts = detectNewAlerts(alertsFromLastRound, distinctChannels);
    const existingAlerts = detectExistingAlerts(alertsFromLastRound, distinctChannels);
    const resolvedAlerts = detectResolvedAlerts(alertsFromLastRound, distinctChannels);
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

async function sendNewAlerts(
    newAlerts: AlertState[],
    config: DigestConfiguration,
    context: DigestContext) {
    await Promise.all(newAlerts.map(async alert => {
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
    }));
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
    await Promise.all(alerts.map(async alert => {
        const channel = config.getChannelConfig(alert.channel);
        if (!channel) {
            return;
        }
        const snapshots = context.getAlertableSnapshotsForChannel(config, channel);
        if (snapshots.length === 0) {
            // only way we can get here is if the channels alerts are muted
            alert.setMuted();
            await sendMutedAlert(config, alert);
            return;
        }
        if (channel.canSendAlert(alert)) {
            await channel.sendOngoingAlert(snapshots, alert);
            alert.last_alert_date = new Date();
        } else {
            await channel.pingAboutOngoingAlert(snapshots, alert);
        }
        alert.track(snapshots);
    }));
}

async function sendResolvedAlerts(
    alerts: AlertState[],
    config: DigestConfiguration) {
    await Promise.all(alerts.map(async alert => {
        alert.removeMuted(config.muteWindows);
        alert.resolve();
        if (alert.size === 0) {
            if (alert.isMuted) {
                await sendMutedAlert(config, alert);
            }
            return;
        }
        const channel = config.getChannelConfig(alert.channel);
        if (!channel) {
            return;
        }
        await channel.sendResolvedAlert(alert);
    }));
}

async function sendMutedAlert(config: DigestConfiguration, alert: AlertState) {
    const channel = config.getChannelConfig(alert.channel);
    if (!channel) {
        return;
    }
    await channel.sendMutedAlert(alert);
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
