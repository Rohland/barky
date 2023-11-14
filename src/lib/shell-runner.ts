import { exec } from "child_process";

export interface IShellResult {
    exitCode: number;
    stdout: string;
}

export async function execShellScript(
    scriptPath: string,
    timeout: number,
    args: string | string[] = null): Promise<IShellResult> {
    return new Promise((resolve, reject) => {
        try {
            const params = [args ?? []].flat();
            const worker = exec(
                `bash ${ scriptPath } ${ params.map(x => `'${ x }'`).join(" ") }`,
                {
                    env: {
                        ...(process.env)
                    },
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
                    exitCode: 110,
                    stdout: "TIMEOUT"
                });
            }, timeout);
            worker.on('exit', (code) => {
                clearTimeout(timeoutHandle);
                resolver({
                    exitCode: code,
                    stdout: output.join("\n").trim()
                });
                return;
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
