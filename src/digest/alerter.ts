import { DigestContext } from "./digest";
import { getAlerts, persistAlerts } from "../models/db";
import { AlertState } from "../models/alerts";
import { flatten } from "../lib/utility";
import { Snapshot } from "../models/snapshot";
import { ChannelConfig } from "../models/channels/base";
import { log } from "../models/logger";

export async function executeAlerts(
    channelConfigs: ChannelConfig[],
    context: DigestContext) {
    const alerts = await getAlerts();
    const distinctChannels = getChannelsAffected(context.snapshots);
    const newAlerts = detectNewAlerts(alerts, distinctChannels);
    const existingAlerts = detectExistingAlerts(alerts, distinctChannels);
    const resolvedAlerts = detectResolvedAlerts(alerts, distinctChannels);
    await triggerAlerts(
        new Map(channelConfigs.map(x => [x.name, x])),
        context,
        newAlerts,
        existingAlerts,
        resolvedAlerts);
    await persistAlerts([...newAlerts, ...existingAlerts.filter(x => !x.isResolved)]);
}

async function sendNewAlerts(
    newAlerts: AlertState[],
    channelLookup: Map<string, ChannelConfig>,
    context: DigestContext) {
    await Promise.all(newAlerts.map(async alert => {
        const channel = channelLookup.get(alert.channel);
        if (!channel) {
            log(`Channel ${alert.channel} not found in digest configuration`);
            return;
        }
        const snapshots = context.getSnapshotsForChannel(channel);
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
    channelLookup: Map<string, ChannelConfig>,
    context: DigestContext) {
    await Promise.all(alerts.map(async alert => {
        const channel = channelLookup.get(alert.channel);
        if (!channel) {
            log(`Channel ${alert.channel} not found in digest configuration`);
            return;
        }
        const snapshots = context.getSnapshotsForChannel(channel);
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
    channelLookup: Map<string, ChannelConfig>) {
    await Promise.all(alerts.map(async alert => {
        alert.resolve();
        const channel = channelLookup.get(alert.channel);
        if (!channel) {
            log(`Channel ${alert.channel} not found in digest configuration`);
            return;
        }
        await channel.sendResolvedAlert(alert);
    }));
}

async function triggerAlerts(
    channelLookup: Map<string, ChannelConfig>,
    context: DigestContext,
    newAlerts: AlertState[],
    existingAlerts: AlertState[],
    resolvedAlerts: AlertState[]) {
    await sendNewAlerts(newAlerts, channelLookup, context);
    await sendOngoingAlerts(existingAlerts, channelLookup, context);
    await sendResolvedAlerts(resolvedAlerts, channelLookup);
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

