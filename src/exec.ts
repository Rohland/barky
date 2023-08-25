import { MonitorFailureResult, Result } from "./models/result";
import { initConnection, persistResults } from "./models/db";
import { getChannelConfigs } from "./models/channel";
import { digest } from "./digest/digest";
import { emitResults } from "./result-emitter";
import { evaluate } from "./evaluation";
import { AlertConfiguration } from "./models/alert_configuration";

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
    await emitAndPersistResults(results);
    const channelConfigs = getChannelConfigs(config.digest);
    await digest(channelConfigs, results);
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
