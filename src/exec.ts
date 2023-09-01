import { MonitorFailureResult, Result } from "./models/result";
import { persistResults } from "./models/db";
import { digest } from "./digest/digest";
import { emitResults } from "./result-emitter";
import { evaluate } from "./evaluation";
import { DigestConfiguration } from "./models/digest";
import { log } from "./models/logger";

export async function execute(
    config: any,
    evals: string) {
    const results = await evaluate(config, evals);
    await runDigest(config, results);
}

async function runDigest(
    config: any,
    results: Result[]) {
    const digestConfig = new DigestConfiguration(config.digest);
    configureMonitorLogsWithAlertConfiguration(results, digestConfig);
    digestConfig.trackChannelConfigIssues(results);
    await emitAndPersistResults(results);
    await digest(digestConfig, results);
}

export function configureMonitorLogsWithAlertConfiguration(
    results: Result[],
    digestConfig: DigestConfiguration) {
    if (!digestConfig.configured) {
        return;
    }
    results
        .filter(x => x instanceof MonitorFailureResult)
        .forEach(x => {
            if (!x.alert) {
                return;
            }
            const monitorPolicy = x.alert.exceptionPolicyName;
            if (!monitorPolicy) {
                return;
            }
            x.alert = digestConfig.getAlertPolicy(monitorPolicy);
        });
}

export async function emitAndPersistResults(results: Result[]) {
    emitResults(results);
    try {
        await persistResults(results);
    } catch(err) {
        if (results.every(x => x.isConfigurationFailureResult)) {
            return;
        }
        log(`error persisting results: ${ err }`, err);
        emitResults([MonitorFailureResult.ConfigurationError(err)]);
    }
}
