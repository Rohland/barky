import { spawn } from "child_process";
import * as process from "process";

export interface IShellResult {
    exitCode: number;
    stdout: string;
}

let _envVars = null;

function generateEnvVars() {
    if (_envVars) {
        return _envVars;
    }
    _envVars = {};
    for (const key in process.env) {
        _envVars[key] = process.env[key];
        _envVars[key.replace(/[^a-z0-9_]+/g, "_")] = process.env[key];
    }
    return _envVars;
}

export function resetShellEnvironment() {
    _envVars = null;
}

const TIMEOUT_EXIT_CODE = 110;

export function isShellTimeout(result: IShellResult): boolean {
    return result?.exitCode === TIMEOUT_EXIT_CODE && result?.stdout === "TIMEOUT";
}

export async function execShellScript(
    scriptPath: string,
    timeout: number,
    args: string | string[] = null): Promise<IShellResult> {
    return new Promise((resolve, reject) => {
        try {
            const params = [args ?? []].flat();
            const worker = spawn(scriptPath, params, {
                env: {
                    ...generateEnvVars()
                },
                stdio: ["ignore", "pipe", "pipe"]
            });
            const output = [];
            let processed = false;
            const resolver = (result: IShellResult) => {
                if (!processed) {
                    processed = true;
                    resolve(result);
                }
            };
            const timeoutHandle = setTimeout(() => {
                worker.kill("SIGKILL");
                resolver({
                    exitCode: TIMEOUT_EXIT_CODE,
                    stdout: "TIMEOUT"
                });
            }, timeout);
            worker.on('close', (code) => {
                clearTimeout(timeoutHandle);
                resolver({
                    exitCode: code,
                    stdout: output.join("").trim()
                });
            });
            worker.stdout.on('data', (data) => {
                output.push(data);
            });
            worker.stderr.on('data', (data) => {
                output.push(data);
            });
        } catch(err) {
            reject(err);
        }
    });
}
