import { MonitorFailureResult, Result } from "./models/result";
import { initConnection, persistResults } from "./models/db";
import { getChannelConfigs } from "./models/channel";
import { digest } from "./digest/digest";
import { emitResults } from "./result-emitter";
import { evaluate } from "./evaluation";
import { AlertConfiguration } from "./models/alert_configuration";
import { ChannelConfig } from "./models/channels/base";

export async function execute(
    config: any,
    evals: string) {
    const results = await evaluate(config, evals);
    await runDigest(config, results);
}

async function runDigest(
    config,
    results: Result[]) {
    await initConnection(config.fileName);
    configureMonitorLogsWithAlertConfiguration(results, config.digest);
    const channelConfigs = getChannelConfigs(config.digest);
    validateConfiguration(config, channelConfigs, results);
    await emitAndPersistResults(results);
    await digest(channelConfigs, results);
}

export function validateConfiguration(
    config: any,
    channels: ChannelConfig[],
    results: Result[]) {
    if (!config.digest) {
        return;
    }
    const issues = [];
    const types = channels.map(x => x.name);
    results.forEach(x => {
       x.app?.alert?.channels?.forEach(channel => {
           if (!types.includes(channel)) {
               issues.push(new MonitorFailureResult(x.type, x.identifier,`Channel '${ channel }' not found in digest config`));
           }
       });
    });
    issues.forEach(i => results.push(i));
}

export function configureMonitorLogsWithAlertConfiguration(
    results: Result[],
    digestConfig) {
    const monitorAlertConfig = digestConfig?.monitor?.alert;
    if (!monitorAlertConfig){
        return;
    }
    const config = new AlertConfiguration(monitorAlertConfig);
    results.filter(x => x instanceof MonitorFailureResult).forEach(x => {
        x.alert ??= config;
    });
}

export async function emitAndPersistResults(results: Result[]) {
    emitResults(results);
    await persistResults(results);
}
