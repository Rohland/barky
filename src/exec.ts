import { MonitorFailureResult, Result } from "./models/result.js";
import { persistResults } from "./models/db.js";
import { digest } from "./digest/digest.js";
import { emitResults } from "./result-emitter.js";
import { evaluate } from "./evaluation.js";
import { DigestConfiguration } from "./models/digest.js";
import { log } from "./models/logger.js";

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
    try {
        emitResults(results);
        await persistResults(results);
    } catch(err) {
        if (results.every(x => x.isConfigurationFailureResult)) {
            return;
        }
        log(`error persisting results: ${ err }`, err);
        try {
            emitResults([MonitorFailureResult.ConfigurationError(err)]);
        } catch {
            console.error("error emitting logs", err);
        }
    }
}
