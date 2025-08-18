#!/usr/bin/env node
import dotenv from 'dotenv'

const envPath = ['.env.local', '.env'];
dotenv.config({ path: envPath, quiet: true });

import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import fs from 'fs';
import path from 'path';
import { MonitorFailureResult } from "./models/result";
import { destroy } from "./models/db";
import { emitAndPersistResults, execute } from "./exec";
import { loop } from "./loop";
import { initLogger, log } from "./models/logger";
import { Argv } from "yargs";
import { initialiseGlobalConfig } from "./config";
import { NestFactory } from "@nestjs/core";
import { AppModule, DebugLogger } from "./web/app.module";
import { NestExpressApplication } from "@nestjs/platform-express";

(async () => {
    const args = await getArgs();
    try {
        const exitCode = await loop(args, async () => await run(args));
        process.exit(exitCode);
    } catch (err) {
        await destroy();
        console.log("fatal error", err);
        process.exit(-1);
    }
})();

let webApp: NestExpressApplication = null;

async function bootstrapWebApp(port: number = null) {
    if (webApp) {
        return;
    }
    webApp = await NestFactory.create(AppModule, { logger: new DebugLogger() });
    webApp.useStaticAssets(path.join(__dirname, './web/views'));
    port ??= 3000;
    log(`starting web app on port ${ port }`);
    await webApp.listen(port);
}

async function run(args: any) {
    initLogger(args);
    try {
        const config = await initialiseGlobalConfig(args);
        await bootstrapWebApp(config.env?.config?.port);
        log(`starting ${ args.eval } evaluators`);
        await execute(
            config,
            args.eval);
        return 0;
    } catch (err) {
        log(err, err);
        // emits a global config error - assume cloud watch monitor is set up for this as a safety net
        await emitAndPersistResults([MonitorFailureResult.ConfigurationError(err)]);
        return -1;
    }
}

async function getArgs() {
    function cmdBuilder(yargs: Argv) {
        yargs
            .positional("rules", {
                type: "string",
                description: "path to the evaluator configuration yaml file",
                required: true
            })
            .option("eval", {
                description: "Comma separated list of evaluators to run - if not provided, all are evaluated",
                type: "string",
            })
            .option("digest", {
                description: "Run the digest step using the configuration file set with this argument",
                type: "string"
            })
            .option("title", {
                description: "When set, is used in notifications using variable {{ title }}",
                type: "string",

            })
            .implies('title', 'digest')
            .option("debug", {
                description: "If set, debug messages are printed to the console",
                type: "boolean"
            });
    }

    const args = await yargs(hideBin(process.argv))
        .usage("$0 <cmd> [options]")
        .command("run <rules> [options]", "run the watchdog", cmdBuilder)
        .command("loop <rules> [options]", "run the watchdog in a loop until terminated", cmdBuilder, configureLoop)
        .command("killall", "kills all running barky processes", killAll)
        .demandCommand()
        .example("$0 run client", "run all evaluators using ./client.yaml")
        .example("$0 run client --eval=mysql", "runs the mysql evaluator only")
        .example("$0 run client --eval=web,mysql", "only runs mysql & web evaluators")
        .example("$0 run client --digest=my-team --title='ACME'", "runs all evaluators and uses my-team config for digest")
        .example("$0 loop client", "runs in a loop (every 30 seconds) until exit")
        .help()
        .argv;
    return args;
}

function killAll() {
    console.log("killing all barky processes");
    const candidates = fs.readdirSync(path.join(path.dirname('')), { withFileTypes: true })
        .filter(x => /^\.barky.*\.lock$/.test(x.name))
        .map(x => ({ file: x, contents: fs.readFileSync(x.name, 'utf8') }))
        .map(data => {
            const fileParts = data.contents.split('#');
            return {
                ...data,
                pid: parseInt(fileParts[0].trim()),
                details: fileParts[1].trim()
            };
        })
        .filter(data => Number.isInteger(data.pid));
    console.log(`found ${ candidates.length } local barky processes`);
    candidates
        .forEach(data => {
            console.log(`killing barky pid ${ data.pid } (${ data.details }) - ${ data.file.name }`);
            try {
                process.kill(data.pid, 'SIGKILL');
            } catch (err) {
                // no-op
            }
            fs.unlinkSync(data.file.name);
        });
    process.exit(0);
}

function configureLoop(yargs: any) {
    yargs.loop = true;
}
